/**
 * 도구·노드 안에서 부르는 **내부** LangChain 모델 호출 표지 — 사용자 답변 스트림에서 뺀다.
 *
 * stream-dispatch 는 `generator` 노드의 `on_chat_model_stream` 만 내보낸다. 그런데 GPT 경로는
 * 도구를 generator 노드 **안에서** 실행해, 도구 내부 LLM 출력(예: 각인 판독 "없음")이 generator 이름을
 * 달고 새면 `fullAiResponse` 가 채워져 진짜 답과 카드가 버려진다 → DEV_261018 §1~4
 * 노드 이름은 경로마다 달라 믿을 수 없으므로 호출 쪽에서 태그로 표시한다.
 *
 * 사용: `model.invoke(messages, { tags: [INTERNAL_LLM_TAG] })`
 */
export const INTERNAL_LLM_TAG = 'internal-llm';

export const isInternalLlmEvent = (event: { tags?: string[] }): boolean =>
    Array.isArray(event?.tags) && event.tags.includes(INTERNAL_LLM_TAG);
