import { lowestThinkingLevel } from '../../model-thinking';

/**
 * Generation config resolvers — pure helpers extracted from generator.ts.
 * Token budget and thinking config selection, kept side-effect free so the
 * generator can compute `effectiveMaxTokens`/`effectiveModel` (search-gate
 * dependent) around these results.
 */

/**
 * Intent-based token budget: short-output paths get reduced limits to fit within Vercel 60s.
 * Note: the search-grounding floor (min 8192 when Google Search is on) is applied by the
 * caller via `effectiveMaxTokens`, since it depends on the search gate.
 */
export const resolveMaxTokens = (ctx: {
    hasDocumentContent: boolean;
    isYoutubeRequest: boolean;
    hasMultimodalContent: boolean;
    hasUrlContent: boolean;
    intent: string;
}): number => {
    if (ctx.hasDocumentContent) return 16384;               // PDF·문서 분석
    if (ctx.isYoutubeRequest) return 8192;                  // YouTube 요약
    if (ctx.hasMultimodalContent) return 4096;              // 이미지 분석
    if (ctx.hasUrlContent) return 8192;                     // URL 요약
    if (ctx.intent === 'data_viz') return 8192;            // 차트 JSON + 설명
    if (ctx.intent === 'astronomy') return 8192;           // 별자리 JSON + 설명
    if (ctx.intent === 'biology') return 8192;             // PDB 구조 + 설명
    if (ctx.intent === 'chemistry') return 8192;           // SMILES + 설명 (grounding 대응)
    if (ctx.intent === 'physics') return 8192;             // 다이어그램 JSON + 설명 (grounding 대응)
    if (ctx.intent === 'medical_qa') return 8192;          // 의학 Q&A + 출처
    return 32768;                                            // 코드·일반
};

/**
 * Thinking config — **모델별 실측표**로 분기한다(계열 판정 아님).
 *
 * thinkingLevel 경로(3.x): 우리는 전 경로에서 **그 모델의 최저 레벨**을 쓴다.
 *   - YouTube native video: 사고를 끄는 쪽이 Vercel 60s 안에 들어온다
 *   - Renderer intents(astronomy/data_viz/…): structured JSON. 3.5·3.6 의 "low" 는
 *     JSON 추론에 예산이 소진돼 **빈 응답**이 났다 → 2026-06-23 minimal 로 전환
 *   - general(비검색 코드·작문·추론) 포함 그 외 전부: 같은 값
 *     검증: 코드/수학/추론 5케이스 품질 저하 0 + 평균 25%(코드 58%) 단축
 *     (tests 이전 `scripts/test-low-vs-minimal-reasoning.ts`, doc §3-3 연장)
 *
 * 🔴 **"minimal" 을 리터럴로 박지 않는다.** 3.7 의 하한은 `low` 이고 `minimal` 은 **400 으로 거부**한다.
 *    `lowestThinkingLevel(model)` 이 모델마다 다른 하한을 준다.
 *    (3.7 low 는 렌더러 45/45 통과 — PLAN_MODEL_3_7_MIGRATION_260817 §3. "low 예산 소진"은
 *     3.5·3.6 의 low 에서 났던 문제이고 3.7 의 low 는 그 모델 하한이라 다르게 동작한다.)
 *
 * thinkingBudget 경로(2.5): thinkingLevel 은 **문서와 달리 400 으로 거부**된다(실측).
 *   - YouTube: budget 0 (thinkingBudget>0 이면 fileData 와 함께 503)
 *   - URL 요약: budget 0 (추출성 작업 — 기본 thinking ON 시 무료티어 100s+ 지연. 2026-06-26)
 *   - 이미지/영상 미디어 턴: budget 0 (멀티모달 지연 최소화. 2026-06-26)
 *   - medical_qa: budget 3000 (cap)
 *   - Others: undefined (model default)
 */
export const resolveThinkingConfig = (ctx: {
    model: string;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    hasUrlContent: boolean;
    isMediaTurn: boolean;
    intent: string;
}) => {
    const level = lowestThinkingLevel(ctx.model);
    if (level) return { thinkingLevel: level };
    return ctx.isYoutubeRequest || ctx.hasUrlContent || ctx.isMediaTurn
        ? { thinkingBudget: 0 }
        : ctx.intent === 'medical_qa'
        ? { thinkingBudget: 3000 }
        : undefined;
};

/**
 * 빈 응답 복구 — **한 칸 더 낮출 수 있는가**.
 *
 * 🔴 예전 코드는 `thinkingLevel !== 'minimal'` 로 판정하고 `'minimal'` 로 재시도했다.
 *    3.7 에서는 그 재시도 자체가 **400**(minimal 미지원)이라 **복구 경로가 복구 불능**이 된다.
 *    지금은 그 모델의 하한과 비교하고, 하한으로 재시도한다.
 */
export const thinkingRetryLevel = (model: string, current: unknown): string | undefined => {
    const lowest = lowestThinkingLevel(model);
    if (!lowest) return undefined;                       // budget 경로 — 내릴 칸이 없다
    return typeof current === 'string' && current !== lowest ? lowest : undefined;
};
