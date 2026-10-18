/**
 * 도구·노드 안에서 부르는 **내부** LangChain 모델 호출 표지 — 사용자 답변 스트림에서 뺀다.
 *
 * stream-dispatch 는 `generator` 노드의 `on_chat_model_stream` 만 내보낸다. 그런데 GPT 경로는
 * 도구를 generator 노드 **안에서** 실행해, 약 도구의 Gemini 각인 판독(OCR) 출력 "없음" 이
 * generator 이름을 달고 샜다 → `fullAiResponse` 가 채워져 GPT 의 진짜 답과 약 카드가
 * `!st.fullAiResponse` 조건에 걸려 통째로 버려졌다(2026-10-18, 화면엔 "없음" 한 단어).
 * 노드 이름은 경로마다 달라 믿을 수 없다 → 호출 쪽에서 태그로 표시한다.
 *
 * 사용: `model.invoke(messages, { tags: [INTERNAL_LLM_TAG] })`
 */
export const INTERNAL_LLM_TAG = 'internal-llm';

export const isInternalLlmEvent = (event: { tags?: string[] }): boolean =>
    Array.isArray(event?.tags) && event.tags.includes(INTERNAL_LLM_TAG);
