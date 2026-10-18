import { lowestThinkingLevel } from '../../model-thinking';

/**
 * 생성 설정 결정 — generator.ts 에서 쓰는 순수 헬퍼.
 * 토큰 상한과 thinking 설정을 고른다. 부수효과가 없어 generator 가
 * 결과를 받아 `effectiveMaxTokens`/`effectiveModel`(검색 게이트 의존)을
 * 계산할 수 있다.
 */

/**
 * 인텐트별 출력 토큰 상한 — 짧게 답하는 경로는 상한을 낮춰 생성 시간을 줄인다.
 * 검색 grounding 하한(Google Search 켜지면 최소 8192)은 검색 게이트에 달려 있어 호출부가
 * `effectiveMaxTokens` 로 적용한다.
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
 * Thinking config — **모델별 측정표**로 분기한다(계열 판정 아님).
 *
 * thinkingLevel 경로(3.x): 전 경로에서 **그 모델의 최저 레벨**을 쓴다.
 *   - YouTube native video: 사고를 끄는 쪽이 영상 분석 시간이 짧다(정상 ~30~48s)
 *   - Renderer intents(astronomy/data_viz/…): structured JSON. 3.5·3.6 의 "low" 는
 *     JSON 추론에 예산이 소진돼 빈 응답이 난다
 *   - general(비검색 코드·작문·추론) 포함 그 외 전부: 같은 값(품질 저하 없이 지연 단축)
 *
 * "minimal" 을 리터럴로 박지 않는다 — 모델마다 하한이 다르다(3.7 은 `low`, `minimal` 은 400 거부).
 * `lowestThinkingLevel(model)` 이 모델별 하한을 준다(PLAN_MODEL_3_7_MIGRATION_260817 §3).
 *
 * thinkingBudget 경로(2.5): thinkingLevel 은 400 으로 거부된다.
 *   - YouTube: budget 0 (thinkingBudget>0 이면 fileData 와 함께 503)
 *   - URL 요약: budget 0 (추출성 작업 — 기본 thinking ON 이면 무료티어에서 100s+ 지연)
 *   - 이미지/영상 미디어 턴: budget 0 (멀티모달 지연 최소화)
 *   - medical_qa: budget 3000 (상한)
 *   - 나머지: undefined (모델 기본값)
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
 * 그 모델의 하한과 비교하고 하한으로 재시도한다. `'minimal'` 로 고정 재시도하면 minimal 을 받지 않는
 * 모델(3.7)에서 재시도 자체가 400 이 된다.
 */
export const thinkingRetryLevel = (model: string, current: unknown): string | undefined => {
    const lowest = lowestThinkingLevel(model);
    if (!lowest) return undefined;                       // budget 경로 — 내릴 칸이 없다
    return typeof current === 'string' && current !== lowest ? lowest : undefined;
};

/**
 * 무거운 미디어(YouTube·업로드 영상·대용량 PDF) 턴이 **데드라인 타임아웃**으로 끝났을 때 다음 수.
 *
 * maxDuration 300s 안에 heavy 상한 90s × 2 가 들어가므로 강등 재시도로 건질 수 있다 → DEV_260808 §9
 *
 * 키 로테이션은 답이 아니다 — 타임아웃은 키 쿼터가 아니라 모델 측 혼잡이라 키만 바꾸면 90s 를
 * 또 태운다. 바꿀 가치가 있는 건 **모델**이고, 그래서 강등은 **1회뿐**이다(누적 폭주 방지).
 */
export const heavyMediaTimeoutAction = (ctx: {
    alreadyDowngraded: boolean;
    resolvedModel: string;
    fallbackModel: string;
}): 'downgrade' | 'stop' =>
    !ctx.alreadyDowngraded && ctx.resolvedModel !== ctx.fallbackModel ? 'downgrade' : 'stop';
