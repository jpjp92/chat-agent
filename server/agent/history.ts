import { HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * 이전 턴 답변의 인용 마커(`[1](https://…)`)를 모델에 되돌려 주지 않는다.
 *
 * 마커는 **서버가 groundingSupports 로 심은 표시**지 모델이 쓴 문장이 아니다(gemini-citations.ts).
 * 히스토리에 넣으면 후속 턴 모델이 "URL 을 본문에 박는 포맷"을 흉내 내고, 그 위에 서버 마커가
 * 또 얹혀 화면에 생 URL 이 노출된다 → DEV_260824
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
const SUPPORTED_ATTACHMENT_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf'];

interface ClientHistoryMessage {
    role: string;
    content?: string;
    attachment?: any;
    attachments?: any[];
    groundingSources?: any[];
}

/**
 * 직전 턴에 **실제로** 웹 검색이 일어났는지 (PLAN_SEARCH_POLICY_260815 §3, Step 6).
 *
 * 직전 발화에 규칙을 다시 돌리는 근사는 틀린다 — 검색은 규칙으로만 켜지지 않는다(`medical_qa` 는
 * tier 로 강제 ON, 카드 계열도 마찬가지). 그래서 추측하지 않고 증거를 본다.
 * `groundingSources` 는 이미 왕복하는 값이다:
 *   generator → SSE `sources` → 클라이언트 Message.groundingSources → 다음 요청 history
 *   (DB 복원 세션도 `useChatSessions`가 `grounding_sources`를 같은 필드로 되살린다)
 *
 * @returns `undefined`면 판단 불가 — 호출부가 근사로 폴백한다(구버전 클라·빈 히스토리).
 */
export const deriveLastTurnSearched = (history: ClientHistoryMessage[]): boolean | undefined => {
    const lastBotMsg = (history || [])
        .filter((m: any) => m?.role === 'assistant' || m?.role === 'model')
        .at(-1);
    if (!lastBotMsg) return undefined;
    return Array.isArray(lastBotMsg.groundingSources) && lastBotMsg.groundingSources.length > 0;
};

/**
 * 직전 봇 답변의 출처를 **이름표**로 뽑는다 — 근거 규칙에 실어 모델이 "무엇으로 확인했는지" 보게 한다.
 * 추상 안내("직전 답변은 검색으로 확인됨")만으로는 번복이 멈추지 않는다. URL 은 넣지 않는다 —
 * 본문에 URL 을 박는 포맷을 다시 학습시키지 않으려고 인용 마커를 지운 것과 같은 이유다 → DEV_261013
 */
export const deriveLastTurnSourceLabels = (history: ClientHistoryMessage[], max = 6): string[] => {
    const lastBotMsg = (history || [])
        .filter((m: any) => m?.role === 'assistant' || m?.role === 'model')
        .at(-1);
    const sources = Array.isArray(lastBotMsg?.groundingSources) ? lastBotMsg!.groundingSources! : [];
    const labels = sources
        .map((s: any) => String(s?.title ?? '').trim())
        .filter(Boolean);
    return [...new Set(labels)].slice(0, max);
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
            // 클라이언트는 Role.MODEL='model'을 보내고(types.ts), DB 표기는 'assistant' 다(useChatSessions.ts).
            // 두 표기를 모두 봇 메시지로 받는다 — 하나만 보면 과거 봇 답변이 HumanMessage 로 들어가 라우터의
            // 직전응답 주입·카드 후속 판정·검색 게이트가 전부 무효가 된다.
            if (msg.role === 'assistant' || msg.role === 'model') return new AIMessage(stripCitationLinksForHistory(msg.content || ''));
            const isRecent = index >= array.length - mediaWindow;
            const msgAttachments = msg.attachments || (msg.attachment ? [msg.attachment] : []);
            const parts: any[] = [{ type: 'text', text: msg.content || '' }];
            for (const att of msgAttachments) {
                if (att.data && att.mimeType) {
                    const isSupported = SUPPORTED_ATTACHMENT_MIME_PREFIXES.some(t => att.mimeType.startsWith(t));
                    if (!isSupported) continue;
                    if (!isRecent) {
                        // 조용한 전환에 관측점을 남긴다. 이 강등이 일어나면 Gemini 의 tier 400(멀티모달)이 사라져
                        // 같은 요청의 검색 판정이 뒤집히므로, 로그가 있어야 "왜 이 턴만 검색이 됐지"를 답할 수 있다 → DEV_260902 §9.5
                        console.log(`[History] 첨부 미디어 → 텍스트 강등 (mediaWindow ${mediaWindow} 밖): ${att.fileName || att.mimeType}`);
                        parts[0].text += `\n[Attached File: ${att.fileName || att.mimeType}]`;
                        continue;
                    }
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
