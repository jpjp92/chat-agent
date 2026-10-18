import { markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from "../../config";

/**
 * 공용 오류 분류·키 로테이션 헬퍼 — generator.ts 의 SDK·LangChain catch 블록에서
 * 완전히 같은 부분만 모았다.
 *
 * 참고: `isRateLimit`/`isUnavailable` 은 일부러 공유하지 않는다 — 판정식이
 * 두 경로에서 다르다(SDK 는 메시지 문자열, LangChain 은 statusText 를 본다).
 * 합치면 동작이 바뀌므로 별도 과제다.
 */

export const isTimeoutError = (err: any): boolean =>
    err?.status === 504 || err?.message?.includes('DEADLINE_EXCEEDED') || err?.message?.includes('504') || err?.code === 'ERR_STREAM_DESTROYED'
    // AbortSignal.timeout() 발화(느린 3.5 무료티어 강제 중단) + fetch 끊김(네트워크 블립)
    || err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timed out|aborted|fetch failed/i.test(err?.message ?? '');

// Gemini는 무효 API 키를 401이 아닌 400(API_KEY_INVALID)으로 반환
export const isAuthError = (err: any): boolean =>
    err?.status === 401 || err?.status === 403 || /api key not valid|API_KEY_INVALID/i.test(err?.message ?? '');

/**
 * rate-limit 오류에 키 표시: 일일/프로젝트 쿼터면 소진(오늘은 로테이션해도 소용없음),
 * 아니면 일시적 rate-limit. isRateLimit 이 true 일 때만 호출.
 */
export const markRateLimitKey = (key: string, err: any): void => {
    if (isDailyQuotaError(err)) {
        markKeyDailyExhausted(key);
    } else {
        markKeyRateLimited(key);
    }
};
