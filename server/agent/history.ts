import { HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * 클라이언트 히스토리(JSON) → LangChain 메시지 변환.
 *
 * route.ts 에서 분리(move-only). 분리 이유: 이 매핑에 **역할 표기 불일치 버그**가 있었는데
 * (클라는 Role.MODEL='model' 을 보내는데 서버는 'assistant' 만 AIMessage 로 봐서, 과거 봇 답변이
 * 전부 HumanMessage 로 들어갔다) 테스트 하니스가 LangChain 메시지를 직접 만들어 이 경로를
 * 우회하는 바람에 잡히지 않았다. 순수 함수로 빼서 하니스·스크립트가 같은 코드를 지나가게 한다.
 *
 * 규칙:
 *  - 빈 메시지·system 역할 제외 후 최근 `limit` 개만 사용(클라이언트도 같은 수로 잘라 보낸다).
 *  - 봇 역할 표기는 'assistant'(DB) 와 'model'(클라 Role.MODEL) 둘 다 허용.
 *  - 최근 `mediaWindow` 턴 밖의 첨부는 미디어로 싣지 않고 `[Attached File: …]` 텍스트로 강등.
 */
export const SUPPORTED_ATTACHMENT_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf'];

export interface ClientHistoryMessage {
    role: string;
    content?: string;
    attachment?: any;
    attachments?: any[];
}

export const buildHistoryMessages = (
    history: ClientHistoryMessage[],
    opts: { limit?: number; mediaWindow?: number } = {},
): any[] => {
    const limit = opts.limit ?? 10;
    const mediaWindow = opts.mediaWindow ?? 3;

    return (history || [])
        .filter((msg: any) => msg.content && (msg.content.trim() !== '' || (msg.attachments && msg.attachments.length > 0)) && msg.role !== 'system')
        .slice(-limit)
        .map((msg: any, index: number, array: any[]) => {
            // 클라이언트는 Role.MODEL='model'을 보내고(types.ts), DB 로딩도 'assistant'→Role.MODEL로
            // 매핑한다(useChatSessions.ts). 'assistant'만 보던 탓에 과거 봇 답변이 전부 HumanMessage로
            // 들어가, 라우터의 직전응답 주입·날씨/영화 카드 후속 판정·search-gate의 prevSearched가
            // 모두 무효였다. 두 표기를 모두 받는다(DB 표기 'assistant' 하위호환 유지).
            if (msg.role === 'assistant' || msg.role === 'model') return new AIMessage(msg.content);
            const isRecent = index >= array.length - mediaWindow;
            const msgAttachments = msg.attachments || (msg.attachment ? [msg.attachment] : []);
            const parts: any[] = [{ type: 'text', text: msg.content || '' }];
            for (const att of msgAttachments) {
                if (att.data && att.mimeType) {
                    const isSupported = SUPPORTED_ATTACHMENT_MIME_PREFIXES.some(t => att.mimeType.startsWith(t));
                    if (!isSupported) continue;
                    if (!isRecent) { parts[0].text += `\n[Attached File: ${att.fileName || att.mimeType}]`; continue; }
                    const isPublicUrl = att.data.startsWith('http');
                    if (isPublicUrl) {
                        // 영상/오디오/PDF는 실제 mimeType 단 fileData로(image_url 래핑 시 image/jpeg 오추론).
                        if (att.mimeType.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: att.data } });
                        else parts.push({ fileData: { fileUri: att.data, mimeType: att.mimeType } });
                    } else {
                        const b64 = att.data.includes(',') ? att.data.split(',')[1] : att.data;
                        parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${b64}` } });
                    }
                }
            }
            return new HumanMessage({ content: parts });
        });
};
