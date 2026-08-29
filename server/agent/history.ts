import { HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * 🔴 이전 턴 답변의 인용 마커(`[1](https://…)`)를 모델에 되돌려 주지 않는다.
 *
 * 마커는 **서버가 groundingSupports 로 심은 표시**지 모델이 쓴 문장이 아니다(gemini-citations.ts).
 * 그걸 그대로 히스토리에 넣으면 후속 턴 모델이 "URL 을 본문에 박는 포맷"으로 학습해, 자기
 * 검색 결과 URL 을 맨 괄호로 써 넣는다 — 그 위에 서버 마커가 또 얹혀 화면에 생 URL 이 노출된다
 * (2026-08-24 세션 6bd6817b 실측: 첫 턴 중복 0, 후속 턴 마커 14개 전부 중복).
 *
 * 숫자 라벨만 지운다 — `[약품정보](url)`·YouTube 타임스탬프 `[[01:23](url&t=83)]` 는 남는다.
 */
const CITATION_LINK = /\s?\[\d+(?:,\s*\d+)*\]\(https?:\/\/[^\s)]+\)/g;
export const stripCitationLinksForHistory = (text: string): string => text.replace(CITATION_LINK, '');

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
    groundingSources?: any[];
}

/**
 * 직전 턴에 **실제로** 웹 검색이 일어났는지 (기획 PLAN_SEARCH_POLICY_260815 §3, Step 6).
 *
 * 기존 `prevSearched`는 직전 사용자 발화에 `classifySearchNeed`를 다시 돌린 **근사**였다.
 * 그런데 검색은 룰로만 켜지지 않는다 — `medical_qa`는 tier로 강제 ON이고, 카드 계열도 마찬가지다.
 * 그래서 `"인공타액제 알려줘"`(rule=gray) 다음 턴에는 실제로 검색이 있었는데도 근사가 `false`를
 * 반환해 **멀티턴 가드가 아예 서지 못했다**(DEV_260815_DEPLOY_CHECK).
 *
 * 여기서는 추측하지 않고 증거를 본다. `groundingSources`는 이미 왕복하는 값이다:
 *   generator → SSE `sources` → 클라이언트 Message.groundingSources → 다음 요청 history
 *   (DB 복원 세션도 `useChatSessions`가 `grounding_sources`를 같은 필드로 되살린다)
 *
 * @returns `undefined`면 판단 불가 — 호출부가 기존 근사로 폴백한다(구버전 클라·빈 히스토리).
 */
export const deriveLastTurnSearched = (history: ClientHistoryMessage[]): boolean | undefined => {
    const lastBotMsg = (history || [])
        .filter((m: any) => m?.role === 'assistant' || m?.role === 'model')
        .at(-1);
    if (!lastBotMsg) return undefined;
    return Array.isArray(lastBotMsg.groundingSources) && lastBotMsg.groundingSources.length > 0;
};

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
            if (msg.role === 'assistant' || msg.role === 'model') return new AIMessage(stripCitationLinksForHistory(msg.content || ''));
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
