/**
 * Build @google/genai SDK `contents` from LangGraph state messages.
 * Pure transform extracted from generator.ts — correctly maps all multimodal
 * parts (text, image, pdf, video/YouTube) to SDK format.
 *
 * `forceTextOnly` (set by the retry loop on a multimodal 500) drops media parts.
 * Returns the multimodal/document flags the caller uses to gate Google Search,
 * token budget, and the 500-retry path.
 */
export const buildSdkContents = (
    messages: any[],
    forceTextOnly: boolean,
): { sdkContents: any[]; hasMultimodalContent: boolean; hasDocumentContent: boolean } => {
    const sdkContents: any[] = [];
    let hasMultimodalContent = false; // track if any non-text parts exist
    let hasDocumentContent = false;  // track if PDF/doc (not pure image)

    for (const msg of messages) {
        if (msg._getType() === 'human') {
            const contentVal = msg.content;
            if (Array.isArray(contentVal)) {
                const parts: any[] = [];
                for (const part of contentVal as any[]) {
                    if (part.type === 'text') {
                        parts.push({ text: part.text || '' });
                    } else if (part.type === 'image_url' && part.image_url?.url) {
                        if (forceTextOnly) continue; // skip media on retry
                        const url: string = part.image_url.url;
                        if (url.startsWith('data:')) {
                            // base64 inline data URI (e.g. data:image/jpeg;base64,...)
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
                            // Public URL: pass directly as fileData (Gemini SDK supports public URLs natively)
                            // Fetching and re-encoding to base64 is unnecessary and adds 2~5s latency
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
                        if (forceTextOnly) continue; // skip media on retry
                        // Native fileData (YouTube video URI or PDF) - supported natively by SDK
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
