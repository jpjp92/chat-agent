export type ChatErrorType =
    | 'rateLimit'
    | 'dailyExhausted'
    | 'openAIQuota'
    | 'unavailable'
    | 'auth'
    | 'safety'
    | 'guestCapacity'
    | 'generic';

// OpenAI billing/quota failures are persistent until credits or account limits change.
// Keep these internal codes for classification and logs only; never return them to the UI.
export const OPENAI_QUOTA_ERROR_CODES = new Set([
    'insufficient_quota',
    'credit_balance_exhausted',
    'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
]);

export const isOpenAIQuotaError = (error: any): boolean =>
    OPENAI_QUOTA_ERROR_CODES.has(String(error?.code ?? '')) ||
    String(error?.type ?? '') === 'insufficient_quota';

export const classifyChatError = (
    error: any,
    options: { geminiDailyQuota?: boolean } = {},
): ChatErrorType => {
    const status = error?.status ?? error?.code;
    const message = String(error?.message ?? '');

    if (error?.safetyBlock) return 'safety';
    if (isOpenAIQuotaError(error)) return 'openAIQuota';
    if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
        return options.geminiDailyQuota ? 'dailyExhausted' : 'rateLimit';
    }
    if (message.includes('No API key available') || message.includes('All API keys')) {
        return options.geminiDailyQuota ? 'dailyExhausted' : 'rateLimit';
    }
    if (
        status === 503 || status === 504 ||
        message.includes('503') || message.includes('UNAVAILABLE') || message.includes('DEADLINE_EXCEEDED')
    ) return 'unavailable';
    if (status === 401 || status === 403) return 'auth';
    return 'generic';
};

/**
 * 게스트는 무료 키 로테이션만 쓴다(PLAN_GEMINI_PAID_FIRST_261004 §2-1). 무료 등급이 막혀
 * 실패한 경우(429·일일 소진·503)엔 "잠시 후 다시"가 아니라 **로그인하면 계속 쓸 수 있다**고 안내한다 —
 * 회원은 유료 키가 먼저라 같은 순간에도 대부분 성공한다(10-10 측정: 무료 3.x 503·2.5 429, 유료 실패 0).
 * 안전 차단·인증·OpenAI 할당량·일반 오류는 로그인과 무관하므로 그대로 둔다.
 */
const GUEST_CAPACITY_TYPES: ReadonlySet<ChatErrorType> = new Set(['rateLimit', 'dailyExhausted', 'unavailable']);
export const forGuest = (type: ChatErrorType, isGuest: boolean): ChatErrorType =>
    isGuest && GUEST_CAPACITY_TYPES.has(type) ? 'guestCapacity' : type;
