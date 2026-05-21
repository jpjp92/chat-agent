
/**
 * API Key Management Utility
 * Dynamically loads all Gemini API keys from environment variables.
 * Supports rate-limit aware key rotation with temporary blacklisting.
 */

// Collect all API keys starting with 'API_KEY' (e.g., API_KEY, API_KEY2, etc.)
// Deduplicate identical keys
const rawKeys = Object.keys(process.env)
    .filter(key => /^API_KEY\d*$/.test(key))
    .map(key => process.env[key])
    .filter(Boolean) as string[];

export const API_KEYS = [...new Set(rawKeys)]; // Remove duplicates

/**
 * Key Rotation Management with Rate-Limit Awareness
 */
let currentKeyIndex = 0;

// Map of apiKey -> timestamp when it can be retried again (ms)
const rateLimitedUntil: Map<string, number> = new Map();

const RATE_LIMIT_COOLDOWN_MS = 60_000;             // RPM 초과: 60s 쿨다운
const DAILY_LIMIT_COOLDOWN_MS = 24 * 60 * 60_000; // RPD 초과: 24h 비활성화

/**
 * Detect whether a 429 error indicates daily quota (RPD) exhaustion
 * vs a per-minute rate limit (RPM).
 * Google Gemini API error messages include clues like "quota", "day", "daily".
 */
export const isDailyQuotaError = (err: any): boolean => {
    const msg: string = (err?.message || err?.toString() || '').toLowerCase();
    const details: string = JSON.stringify(err?.errorDetails || err?.details || '').toLowerCase();
    return (
        msg.includes('per day') ||
        msg.includes('daily') ||
        msg.includes('quota_exceeded') ||
        // Gemini free tier daily limit: "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
        // err.message가 JSON 문자열 전체이므로 msg(소문자화)에서 camelCase 패턴 검사
        msg.includes('perday') ||
        msg.includes('freetier') ||
        details.includes('per day') ||
        details.includes('daily') ||
        details.includes('quota_exceeded') ||
        details.includes('perday') ||
        details.includes('free_tier') ||
        details.includes('freetier')
    );
};

/**
 * Mark an API key as RPM rate-limited (60s cooldown).
 */
export const markKeyRateLimited = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
    console.warn(`[Config] API key ...${apiKey.slice(-6)} rate-limited (RPM). Cooling down for 60s.`);
};

/**
 * Mark an API key as daily-quota-exhausted (24h cooldown).
 * Prevents retry loops that burn all remaining daily quota on other keys.
 */
export const markKeyDailyExhausted = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + DAILY_LIMIT_COOLDOWN_MS);
    console.error(`[Config] API key ...${apiKey.slice(-6)} daily quota exhausted (RPD). Disabled for 24h.`);
};

/**
 * Mark an API key as invalid (401/403) — disabled for 24 hours.
 */
export const markKeyInvalid = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + DAILY_LIMIT_COOLDOWN_MS);
    console.error(`[Config] API key ...${apiKey.slice(-6)} marked invalid (401/403). Disabled for 24h.`);
};

/**
 * Get the next available API key, skipping rate-limited ones.
 * Returns null if all keys are currently rate-limited.
 */
export const getNextApiKey = (): string | null => {
    if (API_KEYS.length === 0) return null;

    const now = Date.now();
    let attempts = 0;

    while (attempts < API_KEYS.length) {
        const key = API_KEYS[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;

        const cooldownUntil = rateLimitedUntil.get(key);
        if (!cooldownUntil || now > cooldownUntil) {
            // Key is available (either never limited, or cooldown has expired)
            if (cooldownUntil && now > cooldownUntil) {
                rateLimitedUntil.delete(key); // Remove expired cooldown
            }
            return key;
        }
        attempts++;
    }

    // All keys are rate-limited: return null so callers can handle gracefully
    console.error('[Config] All API keys are rate-limited. Returning null.');
    return null;
};

/**
 * Check if all keys are in a long-term cooldown (daily quota exhausted).
 * Threshold: remaining cooldown > 5 minutes distinguishes RPD (24h) from RPM (60s).
 */
const DAILY_EXHAUSTED_THRESHOLD_MS = 5 * 60_000; // 5 minutes

export const isAllKeysDailyExhausted = (): boolean => {
    if (API_KEYS.length === 0) return false;
    const now = Date.now();
    return API_KEYS.every(key => {
        const cooldownUntil = rateLimitedUntil.get(key);
        return cooldownUntil !== undefined && (cooldownUntil - now) > DAILY_EXHAUSTED_THRESHOLD_MS;
    });
};

// Log the number of unique keys loaded
console.log(`[Config] Loaded ${API_KEYS.length} Gemini API keys.`);
