/**
 * "이 턴이 영상 턴인가" 판정 — 순수, 무의존.
 *
 * 🔴 **한 곳에서만 판정한다.** `generator.ts` 가 인라인으로 같은 `.some(...)` 을 갖고 있었고,
 *    2026-09-25 에 `route.ts` 도 같은 판정을 필요로 하게 됐다(영상 프롬프트 블록을 조건부로
 *    바꾸면서). 두 벌로 두면 **한쪽만 고쳐져** 프롬프트에는 영상 규칙이 실리는데 모델 핀은
 *    안 걸리는(또는 그 반대) 턴이 생긴다. 이 레포가 반복해서 맞은 결함 유형이다.
 *
 * 히스토리까지 훑는 것이 의도다 — 영상을 재전송하지 않는 멀티턴 후속 질문도 영상 턴이다.
 */
export const hasVideoPart = (messages: unknown[]): boolean =>
    messages.some((m: any) => Array.isArray(m?.content) && m.content.some((p: any) => p?.fileData));
