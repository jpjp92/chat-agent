/**
 * 서버 진행 상태 이벤트 — SSE `{ status: 'searching' | 'lookup' }`. 검증: `npx tsx tests/test-status-event.mts`
 *
 * 원칙(10-10): 기본은 Orb 만. **실제로 오래 걸리는 일을 실제로 시작할 때만** 알린다.
 *  · 브라우저가 미리 아는 것(영상·문서·URL·이미지)은 클라이언트가 이미 표시한다(src/lib/loading-status.ts).
 *  · 서버만 아는 것 두 가지만 여기서 보낸다:
 *      lookup    — 라우터가 외부 조회(카드·약품·논문) 의도로 확정했을 때 (라우터 종료 시점)
 *      searching — generator 가 **실제로** 웹 검색을 켰을 때. 라우터의 needsSearch 가 아니다 —
 *                  이미지·URL·렌더러 턴은 search-gate 가 검색을 끄므로, 라우터 값으로 알리면
 *                  "검색 중"인데 검색을 안 하는 거짓 표시가 된다.
 * 둘 다 아니면 아무것도 보내지 않는다 → 일반 질문은 Orb 만.
 */
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

export type ServerStatus = 'searching' | 'lookup';
export const STATUS_EVENT = 'chat_status';

/** 외부 API·DB 를 조회하는 의도. drug_id 는 이미지 첨부라 클라이언트가 이미 "약품 식별" 을 보인다. */
const LOOKUP_INTENTS = new Set([
    'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa',
    'movie_search', 'weather', 'paper_search', 'arxiv_search', 'drug_info',
]);

/**
 * 라우터 출력 → lookup 여부. 카드 **후속**(화면 카드로 답함)은 조회가 아니다 —
 * 날씨·논문·위치 카드 후속, 영화 후속(재검색 턴 제외), 법률 refine(intent=general).
 */
export const statusForRouter = (out: any): ServerStatus | null => {
    if (!out || !LOOKUP_INTENTS.has(out.intent)) return null;
    if (out.weatherFollowup || out.paperFollowup || out.cardFollowup) return null;
    if (out.movieFollowup && !out.movieSearchTurn) return null;
    return 'lookup';
};

/** generator 에서 호출 — 실패해도 응답 생성은 계속한다(표시는 부가 기능). */
export const emitStatus = async (kind: ServerStatus): Promise<void> => {
    try { await dispatchCustomEvent(STATUS_EVENT, { kind }); } catch { /* 표시 실패는 무시 */ }
};
