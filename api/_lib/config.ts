
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

const RATE_LIMIT_COOLDOWN_MS = 60_000; // Wait 60s before retrying a rate-limited key

/**
 * Mark an API key as rate-limited so it gets skipped for a cooldown period.
 */
export const markKeyRateLimited = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
    console.warn(`[Config] API key ...${apiKey.slice(-6)} rate-limited. Cooling down for 60s.`);
};

/**
 * Mark an API key as invalid (401/403) — disabled for 24 hours.
 */
export const markKeyInvalid = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + 24 * 60 * 60_000);
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

// Log the number of unique keys loaded
console.log(`[Config] Loaded ${API_KEYS.length} Gemini API keys.`);
