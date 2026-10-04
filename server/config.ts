
import 'server-only';
import { currentKeyTier } from './key-tier';

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
/**
 * 유료 키 — 이름의 TIER1 은 Google 등급 번호가 아니라 "유료 프로젝트 키" 라는 뜻이다(2026-10-04 Tier 2 승급 후에도 이름 유지).
 * `^API_KEY\d*$` 에 걸리지 않으므로 무료 풀(API_KEYS)에 섞이지 않는다. 테스트가 env 를 바꿀 수 있게 호출 시점에 읽는다.
 */
const paidKey = (): string | null => process.env.API_KEY_TIER1 || null;

/** 회원 유료 우선 스위치 — 끄면 현행(무료 로테이션만)과 동일. 비용이 튀면 배포 없이 끈다. */
export const isPaidFirstEnabled = (): boolean => process.env.GEMINI_PAID_FIRST === 'true' && !!paidKey();

/** 이 키로 부르는 호출이 유료 등급인가 — 검색 강등(freeTierSearch) 판단에 쓴다. */
export const isPaidKey = (apiKey: string | null | undefined): boolean => !!apiKey && apiKey === paidKey();

export const getNextApiKey = (): string | null => {
    // 회원(paid-first) 요청은 유료 키부터. 실패한 유료 키는 기존 mark* 가 쿨다운을 걸므로
    // 재시도 루프가 다시 부르면 아래 무료 로테이션으로 내려간다(PLAN_GEMINI_PAID_FIRST_261004 §2-1 (a)).
    if (currentKeyTier() === 'paid-first' && isPaidFirstEnabled()) {
        const key = paidKey()!;
        const cooldownUntil = rateLimitedUntil.get(key);
        if (!cooldownUntil || Date.now() > cooldownUntil) {
            if (cooldownUntil) rateLimitedUntil.delete(key);
            return key;
        }
    }
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
