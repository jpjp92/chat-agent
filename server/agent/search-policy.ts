/**
 * Search Policy — 증거(Signal) → 정책(Policy) 2단 분리.
 *
 * 기획: docs/plans/PLAN_SEARCH_POLICY_260815.md
 * 진단: docs/logs/2026/08/DEV_260815.md
 *
 * 왜 이게 필요한가:
 *   이전 구조는 각 게이트가 `useGoogleSearch` boolean을 **순차적으로 덮어썼다**.
 *   우선순위가 if문의 물리적 배치 순서로만 존재했고, 그래서 휴리스틱 추측(멀티턴 가드)이
 *   사용자의 명시적 검색 요청을 이길 수 있었다 — "검색해서 정리해줘"에 검색이 안 붙던 결함.
 *
 *   여기서는 아무도 덮어쓰지 않는다. 각 주체는 근거를 담은 **신호를 제출**하고,
 *   승자는 선언된 **계층(tier)**이 정한다. 우선순위가 코드가 아니라 데이터다.
 */

/**
 * 권한 계층. 높을수록 강하다.
 *
 * 400이 300보다 위인 것은 의도적이다 — 이미지가 붙어 있으면 사용자가 검색을 요청해도
 * Gemini API가 grounding을 거부한다. 물리적 사실이 사용자 의사보다 위다(정책이 아니라 제약).
 */
export const TIER = {
    /** API가 물리적으로 불가 (멀티모달 + grounding 동시 불가). **off만** 낼 수 있다. */
    HARD_CONSTRAINT: 400,
    /** 사용자가 검색·출처를 명시 요청. 시스템이 뒤집을 권리가 없다. **on만** 낼 수 있다. */
    USER_EXPLICIT: 300,
    /** 답변 근거가 이미 제공됨 (URL·첨부문서·영상 자막/요약). */
    CONTEXT_GROUNDED: 200,
    /** 룰 판정 · 라우터 LLM · 멀티턴 follow-up 가드. */
    CLASSIFIER: 100,
    /** 검색 누락 방어용 기본값. */
    DEFAULT: 0,
} as const;

export type SearchSignal = {
    tier: number;
    verdict: 'on' | 'off';
    /** 신호 출처. 동 tier 충돌 해소에 쓰이므로 SAME_TIER_PRECEDENCE와 이름을 맞출 것. */
    source: string;
    reason?: string;
};

export type SearchDecisionResult = {
    useGoogleSearch: boolean;
    winner: SearchSignal;
    trace: SearchSignal[];
};

/**
 * 동 tier 내 우선순위 — 앞일수록 강하다.
 *
 * `followup-guard`가 `rule`보다 앞인 것이 핵심이다. "최근 검색한 내용 요약해줘"는
 * "최근" 때문에 rule이 temporal ON을 내지만 실제로는 과거참조다. 가드가 rule을 정정하지
 * 못하면 가드 자체가 무의미해진다. (이번 결함을 막는 것은 이 순서가 아니라 TIER 300이다.)
 *
 * 목록에 없는 source는 가장 약하게 취급한다.
 */
const SAME_TIER_PRECEDENCE = [
    'multimodal',
    'history-image',
    'user-explicit',
    'url-content',
    'doc-content',
    'video-content',
    'renderer',
    'medical-qa',
    'followup-guard',
    'rule',
    'router-llm',
    'default',
];

const precedenceOf = (source: string): number => {
    const i = SAME_TIER_PRECEDENCE.indexOf(source);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

const DEFAULT_SIGNAL: SearchSignal = {
    tier: TIER.DEFAULT,
    verdict: 'on',
    source: 'default',
    reason: '판정 없음 — 검색 누락 방어 우선',
};

/**
 * 신호들로부터 최종 결정을 계산한다. 순수 함수 — 부작용 없음.
 *
 * 규칙:
 *   1. 가장 높은 tier의 신호가 이긴다.
 *   2. 동 tier면 SAME_TIER_PRECEDENCE 순서로 해소한다.
 *   3. 신호가 없으면 default-on.
 */
export const decideSearch = (signals: SearchSignal[]): SearchDecisionResult => {
    const trace = signals.length > 0 ? signals : [DEFAULT_SIGNAL];

    const maxTier = Math.max(...trace.map(s => s.tier));
    const winner = trace
        .filter(s => s.tier === maxTier)
        .sort((a, b) => precedenceOf(a.source) - precedenceOf(b.source))[0];

    return {
        useGoogleSearch: winner.verdict === 'on',
        winner,
        trace,
    };
};

/** 로그 한 줄로 전체 근거를 남긴다 — 게이트별로 흩어진 로그로는 조합을 추적할 수 없었다. */
export const formatSearchTrace = (result: SearchDecisionResult): string => {
    const { winner, trace, useGoogleSearch } = result;
    const others = trace
        .filter(s => s !== winner)
        .map(s => `${s.source}=${s.verdict}(${s.tier})`)
        .join(', ');
    const head = `[SearchPolicy] ${useGoogleSearch ? 'ON' : 'OFF'} by ${winner.source}(${winner.tier})`;
    const why = winner.reason ? ` "${winner.reason}"` : '';
    return others ? `${head}${why} | trace: ${others}` : `${head}${why}`;
};
