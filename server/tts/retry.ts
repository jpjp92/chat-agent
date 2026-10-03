/**
 * TTS 조각 재시도 — 순수 모듈(하니스가 가짜 생성기로 검증한다).
 *
 * 규칙
 *   - 재시도는 **그 조각의 첫 바이트 전까지만.** 오디오를 내보낸 뒤 다시 부르면 앞부분이 두 번 재생된다.
 *   - 영구 오류(400·401·403·404 등)는 재시도하지 않는다 — 키를 바꿔도 같은 답이다.
 *   - 호출자 취소(사용자가 멈춤)는 재시도하지 않는다.
 *   - 시도 횟수 상한 3. 🔴 초판 Gemini 루프는 키 12개를 전부 돌았다 — 조각당 60s 타임아웃 × 12 가
 *     라우트 maxDuration(120s)을 넘긴다.
 */

export const TTS_MAX_ATTEMPTS = 3;
/**
 * 첫 바이트 타임아웃. 정상 첫 소리는 0.6~1.9s(PLAN_TTS_STREAMING_261002 §4-4).
 * 🔴 로컬 실사용(2026-10-03): 응답 없이 걸린 시도 하나를 조각 전체 타임아웃(60s)까지 기다려
 *    **61초 뒤 500** 이 났다. 첫 바이트만 짧게 끊고 다음 시도로 넘긴다. 전체 타임아웃은 호출부가 따로 둔다.
 */
export const TTS_FIRST_BYTE_TIMEOUT_MS = 12_000;

export function ttsErrorStatus(error: any): number | undefined {
    if (typeof error?.status === 'number') return error.status;
    const m = String(error?.message ?? '').match(/\b(4\d\d|5\d\d)\b/);
    return m ? Number(m[1]) : undefined;
}

export function isRetryableTtsError(error: any): boolean {
    const status = ttsErrorStatus(error);
    if (status === 429 || status === 408) return true;
    if (status !== undefined && status >= 500) return true;
    if (status !== undefined && status >= 400) return false;
    const msg = String(error?.message ?? '');
    if (/RESOURCE_EXHAUSTED/.test(msg)) return true;
    // 상태 코드 없는 실패: 네트워크·타임아웃·빈 오디오 — 일시적일 수 있다
    return true;
}

/**
 * `attempt(n)` 이 만든 생성기를 흘려보내되, **첫 바이트 전** 재시도 가능한 실패면 다음 시도로 넘어간다.
 * `onError` 는 키 마킹(429) 같은 부수 처리용.
 */
export async function* withTtsRetry(
    attempt: (n: number, signal: AbortSignal) => AsyncGenerator<Uint8Array>,
    signal: AbortSignal,
    opts: {
        maxAttempts?: number;
        firstByteTimeoutMs?: number;
        backoffMs?: (n: number) => number;
        onError?: (error: unknown, n: number) => void;
    } = {},
): AsyncGenerator<Uint8Array> {
    const maxAttempts = opts.maxAttempts ?? TTS_MAX_ATTEMPTS;
    const firstByteMs = opts.firstByteTimeoutMs ?? TTS_FIRST_BYTE_TIMEOUT_MS;
    let lastError: unknown;
    for (let n = 0; n < maxAttempts; n++) {
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        let started = false;
        // 시도마다 자기 컨트롤러 — 첫 바이트가 늦으면 이 시도만 끊는다(호출자 signal 은 그대로)
        const attemptAbort = new AbortController();
        const onParentAbort = () => attemptAbort.abort(signal.reason);
        signal.addEventListener('abort', onParentAbort, { once: true });
        const timer = setTimeout(
            () => attemptAbort.abort(Object.assign(new Error(`tts: no first byte in ${firstByteMs}ms`), { status: 408 })),
            firstByteMs,
        );
        try {
            for await (const bytes of raceAbort(attempt(n, attemptAbort.signal), attemptAbort.signal)) {
                if (!started) clearTimeout(timer);
                started = true;
                yield bytes;
            }
            if (started) return;
            lastError = new Error('tts: no audio');
        } catch (error) {
            if (started || signal.aborted) throw error;
            // 첫 바이트 타임아웃으로 끊은 것은 SDK 가 AbortError 로 감싸 올리므로 원인으로 바꿔 판정한다
            if (attemptAbort.signal.aborted) error = attemptAbort.signal.reason;
            lastError = error;
            opts.onError?.(error, n);
            if (!isRetryableTtsError(error)) throw error;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onParentAbort);
        }
        const wait = opts.backoffMs?.(n) ?? 0;
        if (wait > 0 && n < maxAttempts - 1) await new Promise(r => setTimeout(r, wait));
    }
    throw lastError;
}

/**
 * 생성기의 다음 값을 signal 과 경주시킨다. SDK·fetch 가 abort 를 무시하고 걸려 있어도
 * 이쪽에서 즉시 빠져나온다(걸린 쪽은 abort 로 정리되길 기대하고 버린다).
 */
async function* raceAbort<T>(gen: AsyncGenerator<T>, signal: AbortSignal): AsyncGenerator<T> {
    const aborted = new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    aborted.catch(() => {});
    try {
        for (;;) {
            const r = await Promise.race([gen.next(), aborted]);
            if (r.done) return;
            yield r.value;
        }
    } finally {
        gen.return(undefined).catch(() => {});
    }
}
