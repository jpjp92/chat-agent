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
 * Thinking config — model-aware branching:
 * 3.x-flash (3.5·3.6) uses thinkingLevel enum (thinkingBudget deprecated):
 *   - YouTube native video: "minimal" — disable thinking to stay within Vercel 60s
 *   - Renderer intents (astronomy/data_viz/etc): "minimal" — structured JSON output;
 *     "low" budget can be exhausted by JSON reasoning → empty response
 *   - general(비검색 코드·작문·추론) 포함 그 외 전부: "minimal"
 *     2026-06-23 low→minimal 전환. 검증: 코드/수학/추론 5케이스 품질 저하 0 +
 *     평균 25%(코드 58%) 단축 (scripts/test-low-vs-minimal-reasoning.ts, doc §3-3 연장).
 *     (검색 답변의 3.5 종합=two-track Stage2는 generator.ts에서 이미 minimal 하드코딩)
 * 2.5-flash keeps thinkingBudget (thinkingLevel may be unsupported):
 *   - YouTube: budget 0 (disable — thinkingBudget>0 causes 503 with fileData on 2.5-flash)
 *   - URL 요약: budget 0 (추출성 작업 — 기본 thinking ON 시 무료티어 100s+ 지연. 2026-06-26)
 *   - 이미지/영상 미디어 턴: budget 0 (멀티모달 지연 최소화. 2026-06-26)
 *   - medical_qa: budget 3000 (cap)
 *   - Others: undefined (model default)
 */
export const resolveThinkingConfig = (ctx: {
    is3xModel: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    hasUrlContent: boolean;
    isMediaTurn: boolean;
    intent: string;
}) => {
    return ctx.is3xModel
        ? { thinkingLevel: "minimal" as const }   // 3.x(3.5·3.6) 전 경로 minimal (renderer·youtube·general 통합, 2026-06-23)
        : ctx.isYoutubeRequest || ctx.hasUrlContent || ctx.isMediaTurn
            ? { thinkingBudget: 0 }
            : ctx.intent === 'medical_qa'
            ? { thinkingBudget: 3000 }
            : undefined;
};
