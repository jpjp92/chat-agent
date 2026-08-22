/**
 * 라우터의 **이미지 판정** — `server-only` 를 끌어오지 않는 순수 모듈로 분리했다.
 * 하니스(`tests/test-pill-messages.mts`)가 임포트해야 하는데, `router.ts` 는
 * 도구를 통해 `server-only` 를 끌어와 테스트에서 로드되지 않기 때문이다.
 */

/**
 * ─── 이미지 판정 두 종류 ───────────────────────────────────────────────────
 *
 * 🔴 **둘을 섞으면 후속 턴이 첫 턴처럼 처리된다.** (2026-08-18 실측 버그)
 *
 *   `hasNewImageAttachment` — **이번 턴에 새로 붙인** 이미지. `state.attachments` 는
 *       `app/api/chat/route.ts` 가 **이번 요청 본문에서만** 만든다(:111 `allAttachments`).
 *   `historyHasImage`       — 대화 **전체**에 이미지가 있었는지. 1턴에 붙이면 이후 계속 true.
 *
 * 알약 식별 **지름길**(fast-path·general 복구)은 전자를 써야 한다. 후자를 쓰면
 * "이미지 + 약 키워드"가 2턴·3턴에도 성립해 **라우터 LLM 이 호출조차 되지 않고**
 * 같은 답이 반복된다. 반대로 intent 가 이미 `drug_id` 로 정해진 뒤의 vision 라우팅(:373)은
 * 후자가 맞다 — 그때는 히스토리 이미지로도 식별을 해야 한다.
 *
 * 하니스: `tests/test-pill-messages.mts`.
 */
export const hasNewImageAttachment = (attachments: any): boolean =>
    Array.isArray(attachments) && attachments.some((att: any) => typeof att?.mimeType === 'string' && att.mimeType.startsWith('image/'));

export const historyHasImage = (messages: any): boolean =>
    Array.isArray(messages) && messages.some((msg: any) =>
        Array.isArray(msg?.content) && msg.content.some((part: any) =>
            part?.type === 'image_url' ||
            part?.inlineData?.mimeType?.startsWith?.('image/') ||
            (part?.fileData?.mimeType?.startsWith?.('image/') && !part.fileData.fileUri?.includes('youtube'))
        )
    );

/**
 * 알약 식별 **지름길**을 탈지. `hasImage`(히스토리 포함)를 넘기면 안 된다 — 그게 위 버그다.
 * 지름길을 안 타도 라우터 LLM 이 `drug_id` 를 고를 수 있고, 그때 :373 이 vision 을 태운다.
 */
export const shouldFastPathPillId = (attachments: any, hasMedicalKeyword: boolean): boolean =>
    hasNewImageAttachment(attachments) && hasMedicalKeyword;
