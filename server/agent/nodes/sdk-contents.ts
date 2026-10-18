/**
 * LangGraph state 메시지로 @google/genai SDK `contents` 를 만든다.
 * 순수 변환 — 모든 멀티모달 파트(텍스트·이미지·PDF·영상/YouTube)를
 * SDK 형식으로 매핑한다.
 *
 * `forceTextOnly`(멀티모달 500 재시도 때 설정)면 미디어 파트를 뺀다.
 * 호출부가 Google Search 게이트·토큰 상한·500 재시도에 쓰는
 * 멀티모달/문서 플래그를 돌려준다.
 */
export const buildSdkContents = (
    messages: any[],
    forceTextOnly: boolean,
): { sdkContents: any[]; hasMultimodalContent: boolean; hasDocumentContent: boolean } => {
    const sdkContents: any[] = [];
    let hasMultimodalContent = false; // 텍스트 아닌 파트가 있는지
    let hasDocumentContent = false;  // PDF/문서인지 (순수 이미지 아님)

    for (const msg of messages) {
        if (msg._getType() === 'human') {
            const contentVal = msg.content;
            if (Array.isArray(contentVal)) {
                const parts: any[] = [];
                for (const part of contentVal as any[]) {
                    if (part.type === 'text') {
                        parts.push({ text: part.text || '' });
                    } else if (part.type === 'image_url' && part.image_url?.url) {
                        if (forceTextOnly) continue; // 재시도에선 미디어 건너뜀
                        const url: string = part.image_url.url;
                        if (url.startsWith('data:')) {
                            // base64 인라인 data URI (예: data:image/jpeg;base64,...)
                            let b64data = url;
                            let mimeType = 'application/octet-stream';
                            if (url.includes('base64,')) {
                                const partsArray = url.split('base64,');
                                b64data = partsArray[1];
                                mimeType = url.split(':')[1].split(';')[0];
                            }
                            parts.push({ inlineData: { mimeType, data: b64data } });
                            hasMultimodalContent = true;
                            if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) hasDocumentContent = true;
                        } else if (url.startsWith('http')) {
                            // 공개 URL: fileData 로 그대로 넘긴다 (Gemini SDK 가 공개 URL 을 기본 지원)
                            // 받아서 base64 로 다시 인코딩하면 불필요하게 2~5s 가 더 든다
                            const urlLower = url.toLowerCase();
                            const mimeTypeHint = urlLower.includes('.png') ? 'image/png'
                                : urlLower.includes('.webp') ? 'image/webp'
                                : urlLower.includes('.gif') ? 'image/gif'
                                : urlLower.includes('.pdf') || urlLower.includes('/pdf/') || urlLower.includes('chat-docs') ? 'application/pdf'
                                : 'image/jpeg';
                            parts.push({ fileData: { fileUri: url, mimeType: mimeTypeHint } });
                            hasMultimodalContent = true;
                            if (mimeTypeHint === 'application/pdf') hasDocumentContent = true;
                        }
                    } else if (part.fileData?.fileUri) {
                        if (forceTextOnly) continue; // 재시도에선 미디어 건너뜀
                        // 기본 fileData (YouTube 영상 URI 또는 PDF) — SDK 기본 지원
                        parts.push({ fileData: { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType } });
                        hasMultimodalContent = true;
                        if (part.fileData.mimeType === 'application/pdf') hasDocumentContent = true;
                    }
                }
                if (parts.length === 0) parts.push({ text: '' });
                sdkContents.push({ role: 'user', parts });
            } else {
                sdkContents.push({ role: 'user', parts: [{ text: String(contentVal) }] });
            }
        } else if (msg._getType() === 'ai') {
            sdkContents.push({ role: 'model', parts: [{ text: String(msg.content) }] });
        }
    }

    return { sdkContents, hasMultimodalContent, hasDocumentContent };
};
