import { markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from "../../config";

/**
 * Shared error classification & key-rotation helpers — the byte-identical parts
 * of the SDK and LangChain catch blocks in generator.ts (4-A, move-only).
 *
 * NOTE: `isRateLimit`/`isUnavailable` intentionally NOT shared — their predicates
 * drift between the two paths (SDK checks message text; LangChain checks statusText).
 * Converging them is a behavior change, tracked separately as 4-B.
 */

export const isTimeoutError = (err: any): boolean =>
    err?.status === 504 || err?.message?.includes('DEADLINE_EXCEEDED') || err?.message?.includes('504') || err?.code === 'ERR_STREAM_DESTROYED';

// Gemini는 무효 API 키를 401이 아닌 400(API_KEY_INVALID)으로 반환
export const isAuthError = (err: any): boolean =>
    err?.status === 401 || err?.status === 403 || /api key not valid|API_KEY_INVALID/i.test(err?.message ?? '');

/**
 * Mark a key on a rate-limit error: daily/project quota → exhausted (rotation won't
 * help today); otherwise transient rate-limit. Call only when isRateLimit is true.
 */
export const markRateLimitKey = (key: string, err: any): void => {
    if (isDailyQuotaError(err)) {
        markKeyDailyExhausted(key);
    } else {
        markKeyRateLimited(key);
    }
};
