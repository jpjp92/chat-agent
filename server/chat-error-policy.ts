export type ChatErrorType =
    | 'rateLimit'
    | 'dailyExhausted'
    | 'openAIQuota'
    | 'unavailable'
    | 'auth'
    | 'safety'
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
