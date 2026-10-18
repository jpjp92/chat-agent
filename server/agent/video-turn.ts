/**
 * "이 턴이 영상 턴인가" 판정 — 순수, 무의존.
 *
 * **한 곳에서만 판정한다.** generator.ts(모델 핀)와 route.ts(영상 프롬프트 블록 조건부)가 같이 쓴다.
 * 두 벌로 두면 한쪽만 고쳐져 프롬프트에는 영상 규칙이 실리는데 모델 핀은 안 걸리는(또는 그 반대) 턴이 생긴다.
 *
 * 히스토리까지 훑는 것이 의도다 — 영상을 재전송하지 않는 멀티턴 후속 질문도 영상 턴이다.
 */
export const hasVideoPart = (messages: unknown[]): boolean =>
    messages.some((m: any) => Array.isArray(m?.content) && m.content.some((p: any) => p?.fileData));
