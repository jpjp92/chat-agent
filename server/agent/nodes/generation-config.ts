/**
 * Generation config resolvers — pure helpers extracted from generator.ts.
 * Token budget and thinking config selection, kept side-effect free so the
 * generator can compute `effectiveMaxTokens`/`effectiveModel` (search-gate
 * dependent) around these results.
 */

const RENDERER_INTENTS = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);

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
 * Thinking config — model-aware branching:
 * 3.5-flash uses thinkingLevel enum (thinkingBudget deprecated):
 *   - YouTube native video: "minimal" — disable thinking to stay within Vercel 60s
 *   - Renderer intents (astronomy/data_viz/etc): "minimal" — structured JSON output;
 *     "low" budget can be exhausted by JSON reasoning → empty response
 *   - 1st turn / others: "low" — prevents 60s timeout on first complex queries
 * 2.5-flash keeps thinkingBudget (thinkingLevel may be unsupported):
 *   - YouTube: budget 0 (disable — thinkingBudget>0 causes 503 with fileData on 2.5-flash)
 *   - medical_qa: budget 3000 (cap)
 *   - Others: undefined (model default)
 */
export const resolveThinkingConfig = (ctx: {
    is3xModel: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    intent: string;
}) => {
    return ctx.is3xModel
        ? ((ctx.isYoutubeRequest && ctx.hasVideoData) || RENDERER_INTENTS.has(ctx.intent))
            ? { thinkingLevel: "minimal" as const }
            : { thinkingLevel: "low" as const }
        : ctx.isYoutubeRequest
            ? { thinkingBudget: 0 }
            : ctx.intent === 'medical_qa'
            ? { thinkingBudget: 3000 }
            : undefined;
};
