import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { API_KEYS, getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from '../config';
import { SERVER_MODELS } from '../models';
import { splitForTts } from './split';
import { withTtsRetry } from './retry';

/**
 * TTS 합성 — 공급자 전환 + 분할 조각을 **하나의 PCM 스트림**으로 이어 붙인다.
 *
 * 출력은 두 공급자 공통 **24kHz · 16bit · mono · little-endian raw PCM**.
 * 1순위 공급자는 `TTS_PROVIDER` (gemini | openai), **미설정이면 gemini(3.8 Flash Lite)**.
 * 다른 공급자는 **폴백** — 키가 있으면 자동으로 켜진다(`TTS_FALLBACK=off` 로 끈다).
 *   - 첫 조각이 1순위에서 실패하면 **요청 전체**를 폴백으로 넘긴다(목소리 하나로 읽는다)
 *   - 이후 조각이 실패하면 **그 조각만** 폴백 — 목소리가 바뀌는 편이 내용을 건너뛰는 것보다 낫다
 * 음량은 공급자마다 달라 **서버에서 PCM 을 맞춘다**(TTS_GAIN) — 한 스트림에 두 공급자가 섞여도 같은 크기로 들린다.
 * Gemini 키는 `TTS_USE_TIER1=true` 면 유료 `API_KEY_TIER1`, 아니면 무료 풀(한도가 작다 — 폴백이 받쳐 준다).
 * 라우트가 토큰·게스트·회원 일일 한도를 먼저 검사한다(app/api/speech/route.ts, PLAN §7).
 *
 * 실측 근거: PLAN_TTS_STREAMING_261002 §4-1~4-2c.
 */

export type TtsProvider = 'gemini' | 'openai';

/**
 * 🔴 **2027-01-06 API 제거 예정**(OpenAI 2026-10-01 공지 — tts-1·tts-1-hd·gpt-4o-mini-tts 전 버전).
 * 공식 대체는 `gpt-realtime-2.1-mini` 지만 음성 대화 모델이라 원문 그대로 읽기를 보장하지 않는다(PLAN §4-3).
 * 그 전에 폴백을 `gemini-3.8-flash-tts` 등으로 바꾼다 — PLAN_TTS_STREAMING_261002 §10, TODO.
 */
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = 'alloy';
const GEMINI_TTS_VOICE = 'Kore';
/** 재생 중 다음 조각을 미리 받는 수. 2 가 전체 시간이 가장 짧았다(§4-2: 23s vs p1 45s). */
const PREFETCH = 2;
const CHUNK_TIMEOUT_MS = 60_000;

/**
 * OpenAI TTS 키. 전용 `OPENAI_API_TTS` 를 우선한다 — 채팅과 같은 키(`OPENAI_API_KEY_TIER1`)를 쓰면
 * 프로젝트 hard limit 에 TTS 가 닿는 순간 **GPT 채팅까지 429** 로 멈춘다(상한은 프로젝트 단위).
 * 전용 키가 없을 때만 공유 키로 내려간다.
 */
function openAITtsKey(): string | undefined {
    return process.env.OPENAI_API_TTS || process.env.OPENAI_API_KEY_TIER1;
}

function geminiAvailable(): boolean {
    return (process.env.TTS_USE_TIER1 === 'true' && !!process.env.API_KEY_TIER1) || API_KEYS.length > 0;
}

/** [1순위, 폴백?]. 키가 없는 공급자는 빠진다. */
export function resolveTtsProviders(): TtsProvider[] {
    const primary: TtsProvider = process.env.TTS_PROVIDER === 'openai' && openAITtsKey() ? 'openai' : 'gemini';
    const secondary: TtsProvider = primary === 'gemini' ? 'openai' : 'gemini';
    const secondaryOk = secondary === 'openai' ? !!openAITtsKey() : geminiAvailable();
    return process.env.TTS_FALLBACK !== 'off' && secondaryOk ? [primary, secondary] : [primary];
}

/**
 * 공급자별 증폭 — 서버에서 PCM 샘플에 곱한다(클리핑 방지 포함). 실측(2026-10-03, 한국어 3문장, 증폭 전):
 *   gemini 3.8 Lite  RMS 5899(-14.9 dBFS) · 피크 32768 — 🔴 이미 풀스케일. 예전 1.8(2.5 TTS 용)을 그대로 두면 찌그러진다
 *   openai           RMS 4029(-18.2 dBFS) · 피크 22152 — 3.3dB 작다. 1.4 로 맞추면 RMS ≈5640·피크 ≈31000
 * → 두 공급자가 폴백으로 한 스트림에 섞여도 비슷한 크기로 들린다.
 */
const TTS_GAIN: Record<TtsProvider, number> = { gemini: 1.0, openai: 1.4 };

/** 16bit LE PCM 증폭. 청크가 홀수 바이트로 끊길 수 있어 남는 1바이트를 다음 청크로 넘긴다. */
async function* applyGain(gen: AsyncGenerator<Uint8Array>, gain: number): AsyncGenerator<Uint8Array> {
    if (gain === 1) { yield* gen; return; }
    let carry: Uint8Array | null = null;
    for await (const value of gen) {
        let bytes = value;
        if (carry) { bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length); carry = null; }
        const even = bytes.length - (bytes.length % 2);
        if (even < bytes.length) carry = bytes.slice(even);
        if (even === 0) continue;
        const out = Buffer.from(bytes.slice(0, even));
        for (let i = 0; i < even; i += 2) {
            const v = Math.round(out.readInt16LE(i) * gain);
            out.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i);
        }
        yield out;
    }
    if (carry) yield carry;
}

/** 시도 설정. 뒤에 폴백이 있으면 짧게 쥐고 빨리 넘긴다(FAST_HANDOFF). */
type Attempts = { maxAttempts?: number; firstByteTimeoutMs?: number };
type Synth = (text: string, signal: AbortSignal, attempts?: Attempts) => AsyncGenerator<Uint8Array>;

/**
 * 뒤에 폴백이 있을 때의 시도 설정 — **2회 · 첫 바이트 6s**. 응답 없이 걸려도 ≈12.5s 안에 폴백으로 넘어간다.
 * 🔴 기본(3회 · 12s)이면 걸린 Gemini 를 ~37s 붙잡은 뒤에야 폴백했다(사용자: "너무 길다", 2026-10-04).
 * 정상 첫 소리는 1.2~1.7s 라 6s 는 넉넉하다. 1회가 아니라 2회인 이유: 일시적 429·5xx 는 한 번 더 부르면
 * 대개 같은 공급자로 풀려 목소리가 덜 바뀐다.
 */
const FAST_HANDOFF: Attempts = { maxAttempts: 2, firstByteTimeoutMs: 6_000 };

async function* openAIOnce(text: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAITtsKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: text, response_format: 'pcm' }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(CHUNK_TIMEOUT_MS)]),
    });
    if (!res.ok || !res.body) {
        throw Object.assign(new Error(`openai tts ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
    }
    const reader = res.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value.length) yield value;
    }
}

/** 키가 하나라 같은 키로 다시 부른다 — 429 를 바로 다시 치지 않게 0.5s·1s 쉰다. */
function synthOpenAI(text: string, signal: AbortSignal, attempts: Attempts = {}): AsyncGenerator<Uint8Array> {
    return withTtsRetry((_, attemptSignal) => openAIOnce(text, attemptSignal), signal, { ...attempts, backoffMs: n => 500 * (n + 1) });
}

/**
 * Gemini 는 키 풀을 돈다. 🔴 키 전환은 **그 조각의 첫 바이트 전까지만** — 이미 보낸 오디오는 되돌릴 수 없다.
 * 2.5 TTS 는 stream 으로 불러도 한 덩어리로 온다(§4-1 ①) — 3.1 부터 실제로 스트리밍된다.
 */
async function* geminiOnce(text: string, apiKey: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const ai = new GoogleGenAI({ apiKey });
    const stream = await ai.models.generateContentStream({
        model: SERVER_MODELS.TTS,
        contents: [{ parts: [{ text }] }],
        config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } },
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(CHUNK_TIMEOUT_MS)]),
        } as any,
    });
    for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData?.data) yield Buffer.from(part.inlineData.data, 'base64');
        }
    }
}

/**
 * 키 선택. `TTS_USE_TIER1=true` 면 유료 `API_KEY_TIER1` 만 쓴다(같은 키로 재시도, 대기 0.5s·1s).
 * 아니면 무료 풀에서 시도마다 다음 키(대기 없음).
 * 🔴 3.1 TTS 무료 한도는 **키(프로젝트)당 10회/일** — 조각마다 1회라 무료 풀은 금방 바닥난다
 *    (로컬 실사용 2026-10-03: 키 3개 RPD 소진 → 500). 유료 키는 env 로 명시할 때만 쓴다.
 */
function synthGemini(text: string, signal: AbortSignal, attempts: Attempts = {}): AsyncGenerator<Uint8Array> {
    const tier1 = process.env.TTS_USE_TIER1 === 'true' ? process.env.API_KEY_TIER1 : undefined;
    if (tier1) {
        return withTtsRetry((_, s) => geminiOnce(text, tier1, s), signal, { ...attempts, backoffMs: n => 500 * (n + 1) });
    }
    // 동기 throw 는 ChunkBuffer 밖으로 새어 나간다 — 생성기 안에서 실패시킨다
    if (API_KEYS.length === 0) return (async function* () { throw new Error('gemini tts: no API keys'); })();
    const keys: string[] = [];
    return withTtsRetry((n, s) => {
        const apiKey = getNextApiKey();
        if (!apiKey) throw Object.assign(new Error('gemini tts: all keys exhausted'), { status: 429 });
        keys[n] = apiKey;
        return geminiOnce(text, apiKey, s);
    }, signal, {
        firstByteTimeoutMs: attempts.firstByteTimeoutMs,
        maxAttempts: Math.min(attempts.maxAttempts ?? 3, API_KEYS.length),
        onError: (error: any, n) => {
            const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit && keys[n]) isDailyQuotaError(error) ? markKeyDailyExhausted(keys[n]) : markKeyRateLimited(keys[n]);
        },
    });
}

/** 조각 하나를 미리 받아 두는 버퍼. 앞 조각이 재생(전송)되는 동안 뒤 조각이 여기에 쌓인다. */
class ChunkBuffer {
    private parts: Uint8Array[] = [];
    private done = false;
    private error: unknown = null;
    private wake: (() => void) | null = null;

    constructor(gen: AsyncGenerator<Uint8Array>) {
        (async () => {
            try {
                for await (const p of gen) { this.parts.push(p); this.notify(); }
            } catch (e) {
                this.error = e;
            } finally {
                this.done = true;
                this.notify();
            }
        })();
    }

    private notify() { this.wake?.(); this.wake = null; }

    async *drain(): AsyncGenerator<Uint8Array> {
        for (;;) {
            while (this.parts.length) yield this.parts.shift()!;
            if (this.error) throw this.error;
            if (this.done) return;
            await new Promise<void>(r => { this.wake = r; });
        }
    }
}

/**
 * 텍스트 → PCM 바이트 스트림. 첫 바이트가 나오기 전 실패는 throw 로 올려
 * 라우트가 JSON 오류를 낼 수 있게 한다(그 뒤의 실패는 스트림 중단).
 */
const SYNTH: Record<TtsProvider, Synth> = { gemini: synthGemini, openai: synthOpenAI };

/**
 * 조각 하나를 공급자 순서대로 시도한다. 폴백은 **그 조각의 첫 바이트 전** 실패에만 —
 * 한 공급자가 오디오를 내보낸 뒤 끊기면 다른 공급자로 처음부터 읽을 수 없다(앞부분이 두 번 나온다).
 * `onProvider` 로 실제로 읽은 공급자를 알린다(헤더·로그용).
 */
async function* synthWithFallback(
    text: string, providers: TtsProvider[], signal: AbortSignal, onProvider: (p: TtsProvider) => void,
): AsyncGenerator<Uint8Array> {
    let lastError: unknown;
    for (const [k, provider] of providers.entries()) {
        let started = false;
        try {
            const hasFallback = k < providers.length - 1;
            for await (const bytes of applyGain(SYNTH[provider](text, signal, hasFallback ? FAST_HANDOFF : {}), TTS_GAIN[provider])) {
                if (!started) { started = true; onProvider(provider); }
                yield bytes;
            }
            if (started) return;
            lastError = new Error(`${provider} tts: no audio`);
        } catch (error) {
            if (started || signal.aborted) throw error;
            lastError = error;
        }
        if (k < providers.length - 1) {
            console.warn(`[speech] ${provider} failed before first byte — falling back to ${providers[k + 1]}:`, (lastError as Error)?.message);
        }
    }
    throw lastError;
}

export async function synthesizeSpeechStream(text: string, signal: AbortSignal): Promise<{
    provider: TtsProvider;
    chunks: number;
    stream: ReadableStream<Uint8Array>;
}> {
    const providers = resolveTtsProviders();
    const pieces = splitForTts(text);
    if (pieces.length === 0) throw new Error('empty text');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    // 첫 조각을 읽은 공급자. 1순위가 첫 조각에서 실패했다면 이후 조각도 폴백부터 시작한다(목소리 하나로).
    // 선행(prefetch)으로 이미 1순위로 띄운 조각은 그대로 두고, 실패하면 각자 폴백한다.
    let firstProvider: TtsProvider | null = null;
    const order = (): TtsProvider[] =>
        firstProvider && firstProvider !== providers[0] ? [firstProvider, ...providers.filter(p => p !== firstProvider)] : providers;

    const buffers: ChunkBuffer[] = [];
    const launch = (i: number) => {
        if (i < pieces.length && !buffers[i]) {
            buffers[i] = new ChunkBuffer(synthWithFallback(pieces[i], order(), controller.signal, p => {
                if (i === 0) firstProvider = p;
                else if (firstProvider && p !== firstProvider) console.warn(`[speech] chunk ${i + 1}/${pieces.length} read by ${p} (voice change)`);
            }));
        }
    };
    for (let i = 0; i <= PREFETCH; i++) launch(i);

    const iterator = (async function* () {
        for (let i = 0; i < pieces.length; i++) {
            for (let j = 1; j <= PREFETCH; j++) launch(i + j);
            // 첫 조각 실패는 위로 올려 HTTP 오류로 만든다. 그 뒤 조각은 재시도까지 실패하면 **건너뛴다** —
            // 한 조각을 잃는 편이 나머지 전부를 잃는 것(스트림 중단, "failed to pipe response")보다 낫다.
            if (i === 0) { yield* buffers[i].drain(); continue; }
            try {
                yield* buffers[i].drain();
            } catch (error) {
                if (controller.signal.aborted) throw error;
                console.warn(`[speech] chunk ${i + 1}/${pieces.length} skipped:`, (error as Error)?.message);
            }
        }
    })();

    // 첫 바이트를 기다렸다가 응답을 연다 — 시작 실패를 HTTP 오류로 돌려주기 위해
    const first = await iterator.next().catch(e => { controller.abort(); throw e; });
    if (first.done) { controller.abort(); throw new Error('tts: no audio'); }

    const stream = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(first.value); },
        async pull(c) {
            try {
                const { done, value } = await iterator.next();
                if (done) { signal.removeEventListener('abort', onAbort); c.close(); } else c.enqueue(value);
            } catch (e) {
                controller.abort();
                c.error(e);
            }
        },
        cancel() { controller.abort(); },
    });
    return { provider: firstProvider ?? providers[0], chunks: pieces.length, stream };
}
