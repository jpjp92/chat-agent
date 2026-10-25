
import 'server-only';
import { currentKeyTier } from './key-tier';

/**
 * API 키 관리 유틸
 * 환경 변수에서 Gemini API 키를 전부 읽어 온다.
 * rate-limit 을 고려한 키 로테이션 + 임시 차단.
 */

// 'API_KEY' 로 시작하는 키 전부 수집 (예: API_KEY, API_KEY2 …)
// 같은 키 중복 제거
const rawKeys = Object.keys(process.env)
    .filter(key => /^API_KEY\d*$/.test(key))
    .map(key => process.env[key])
    .filter(Boolean) as string[];

export const API_KEYS = [...new Set(rawKeys)]; // 중복 제거

/**
 * rate-limit 을 고려한 키 로테이션 관리
 */
let currentKeyIndex = 0;

// apiKey → 다시 시도할 수 있는 시각(ms)
const rateLimitedUntil: Map<string, number> = new Map();

const RATE_LIMIT_COOLDOWN_MS = 60_000;             // RPM 초과: 60s 쿨다운
const DAILY_LIMIT_COOLDOWN_MS = 24 * 60 * 60_000; // RPD 초과: 24h 비활성화

/**
 * 429 오류가 일일 쿼터(RPD) 소진인지
 * 분당 rate-limit(RPM)인지 판정한다.
 * Gemini API 오류 메시지에 "quota"·"day"·"daily" 같은 단서가 있다.
 */
export const isDailyQuotaError = (err: any): boolean => {
    const msg: string = (err?.message || err?.toString() || '').toLowerCase();
    const details: string = JSON.stringify(err?.errorDetails || err?.details || '').toLowerCase();
    return (
        msg.includes('per day') ||
        msg.includes('daily') ||
        msg.includes('quota_exceeded') ||
        // Gemini 무료티어 일일 한도: "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
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

// 로그에 키 조각을 남기지 않는다 — 끝 6자리도 여러 로그를 모으면 키 식별·추측 단서가 된다.
const keyLabel = (apiKey: string) => apiKey === paidKey() ? 'paid' : `#${API_KEYS.indexOf(apiKey)}`;

/**
 * API 키를 RPM rate-limit 으로 표시 (60s 쿨다운).
 */
export const markKeyRateLimited = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
    console.warn(`[Config] API key ${keyLabel(apiKey)} rate-limited (RPM). Cooling down for 60s.`);
};

/**
 * API 키를 일일 쿼터 소진으로 표시 (24h 쿨다운).
 * 남은 일일 쿼터를 다른 키에서 다 태우는 재시도 루프를 막는다.
 */
export const markKeyDailyExhausted = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + DAILY_LIMIT_COOLDOWN_MS);
    console.error(`[Config] API key ${keyLabel(apiKey)} daily quota exhausted (RPD). Disabled for 24h.`);
};

/**
 * API 키를 무효(401/403)로 표시 — 24시간 비활성.
 */
export const markKeyInvalid = (apiKey: string) => {
    rateLimitedUntil.set(apiKey, Date.now() + DAILY_LIMIT_COOLDOWN_MS);
    console.error(`[Config] API key ${keyLabel(apiKey)} marked invalid (401/403). Disabled for 24h.`);
};

/**
 * rate-limit 걸린 키를 건너뛰고 다음 사용 가능한 키를 준다.
 * 모든 키가 rate-limit 중이면 null.
 */
/**
 * 유료 키 — 이름의 TIER1 은 Google 등급 번호가 아니라 "유료 프로젝트 키" 라는 뜻이다(등급이 올라도 이름 유지).
 * `^API_KEY\d*$` 에 걸리지 않으므로 무료 풀(API_KEYS)에 섞이지 않는다. 테스트가 env 를 바꿀 수 있게 호출 시점에 읽는다.
 */
const paidKey = (): string | null => process.env.API_KEY_TIER1 || null;

/** 회원 유료 우선 스위치 — 끄면 현행(무료 로테이션만)과 동일. 비용이 튀면 배포 없이 끈다. */
const isPaidFirstEnabled = (): boolean => process.env.GEMINI_PAID_FIRST === 'true' && !!paidKey();

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
            // 사용 가능한 키 (제한된 적 없거나 쿨다운 끝남)
            if (cooldownUntil && now > cooldownUntil) {
                rateLimitedUntil.delete(key); // 끝난 쿨다운 제거
            }
            return key;
        }
        attempts++;
    }

    // 모든 키가 rate-limit 중: 호출부가 처리하도록 null 반환
    console.error('[Config] All API keys are rate-limited. Returning null.');
    return null;
};

/**
 * 모든 키가 장기 쿨다운(일일 쿼터 소진)인지 확인.
 * 기준: 남은 쿨다운이 5분 넘으면 RPD(24h), 아니면 RPM(60s).
 */
const DAILY_EXHAUSTED_THRESHOLD_MS = 5 * 60_000; // 5분

export const isAllKeysDailyExhausted = (): boolean => {
    if (API_KEYS.length === 0) return false;
    const now = Date.now();
    return API_KEYS.every(key => {
        const cooldownUntil = rateLimitedUntil.get(key);
        return cooldownUntil !== undefined && (cooldownUntil - now) > DAILY_EXHAUSTED_THRESHOLD_MS;
    });
};

// 불러온 고유 키 개수 로그
console.log(`[Config] Loaded ${API_KEYS.length} Gemini API keys.`);
