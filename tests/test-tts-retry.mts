/**
 * TTS 조각 재시도 하니스 — `npx tsx tests/test-tts-retry.mts`
 *
 * 재시도 규칙이 깨지면 증상이 조용하다: 앞부분이 **두 번 재생**되거나(첫 바이트 후 재시도),
 * 영구 오류에 키 풀을 다 태우거나, 사용자가 멈춘 뒤에도 요청이 계속 나간다. 가짜 생성기로 고정한다.
 */
import { withTtsRetry, isRetryableTtsError, TTS_MAX_ATTEMPTS } from '../server/tts/retry.js';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed++;
};
const err = (status?: number, message = 'x') => Object.assign(new Error(message), status ? { status } : {});
const b = (n: number) => new Uint8Array([n]);

/** 시도별 시나리오: 'ok' | 'empty' | Error | { partial, then: Error } */
type Step = 'ok' | 'empty' | Error | { partial: true; error: Error };
function fake(steps: Step[]) {
    const calls = { n: 0 };
    const attempt = (n: number) => (async function* () {
        calls.n++;
        const step = steps[n];
        if (step === 'ok') { yield b(n); yield b(n); return; }
        if (step === 'empty') return;
        if (step instanceof Error) throw step;
        yield b(n);
        throw step.error;
    })();
    return { attempt, calls };
}
async function run(steps: Step[], signal = new AbortController().signal) {
    const f = fake(steps);
    const out: number[] = [];
    let error: any = null;
    try { for await (const x of withTtsRetry(f.attempt, signal)) out.push(x[0]); } catch (e) { error = e; }
    return { out, error, calls: f.calls.n };
}

{
    const r = await run([err(429), err(503), 'ok']);
    check('429 → 503 → 성공: 세 번째 시도의 오디오만', r.error === null && r.out.join() === '2,2' && r.calls === 3, `out=${r.out} calls=${r.calls}`);
}
{
    const r = await run([err(400), 'ok']);
    check('400 은 재시도하지 않는다', r.error?.status === 400 && r.calls === 1, `calls=${r.calls}`);
}
{
    const r = await run([err(401), 'ok']);
    check('401 은 재시도하지 않는다', r.error?.status === 401 && r.calls === 1);
}
{
    const r = await run([{ partial: true, error: err(503) }, 'ok']);
    check('첫 바이트 후 실패는 재시도하지 않는다(중복 재생 방지)', r.error?.status === 503 && r.calls === 1 && r.out.join() === '0', `out=${r.out} calls=${r.calls}`);
}
{
    const r = await run(['empty', 'ok']);
    check('빈 오디오는 재시도', r.error === null && r.out.join() === '1,1' && r.calls === 2);
}
{
    const r = await run([err(500), err(500), err(500), 'ok']);
    check(`상한 ${TTS_MAX_ATTEMPTS}회에서 멈춘다`, r.error?.status === 500 && r.calls === TTS_MAX_ATTEMPTS, `calls=${r.calls}`);
}
{
    const r = await run([new Error('fetch failed'), 'ok']);
    check('상태 코드 없는 네트워크 실패는 재시도', r.error === null && r.calls === 2);
}
{
    const ac = new AbortController();
    const f = fake([err(503), 'ok']);
    let calls = 0;
    const attempt = (n: number) => { calls++; if (n === 0) ac.abort(); return f.attempt(n); };
    let error: any = null;
    try { for await (const _ of withTtsRetry(attempt, ac.signal)) { /* drain */ } } catch (e) { error = e; }
    check('사용자 취소 후에는 재시도하지 않는다', error !== null && calls === 1, `calls=${calls}`);
}
{
    // 로컬 실사용 재현(2026-10-03): 응답 없이 걸린 시도 — 첫 바이트 타임아웃 후 다음 시도로 넘어가야 한다
    let calls = 0;
    const attempt = (n: number, signal: AbortSignal) => (async function* () {
        calls++;
        if (n === 0) { await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))); }
        yield b(n);
    })();
    const t0 = Date.now();
    const out: number[] = [];
    let error: any = null;
    try { for await (const x of withTtsRetry(attempt, new AbortController().signal, { firstByteTimeoutMs: 100 })) out.push(x[0]); } catch (e) { error = e; }
    const ms = Date.now() - t0;
    check('걸린 시도는 첫 바이트 타임아웃으로 끊고 재시도', error === null && out.join() === '1' && calls === 2 && ms < 1000, `calls=${calls} ${ms}ms`);
}
{
    // abort 를 무시하고 영원히 걸리는 SDK 도 빠져나와야 한다
    const attempt = (n: number) => (async function* () {
        if (n === 0) await new Promise(() => {});
        yield b(n);
    })();
    const out: number[] = [];
    try { for await (const x of withTtsRetry(attempt, new AbortController().signal, { firstByteTimeoutMs: 100 })) out.push(x[0]); } catch { /* */ }
    check('abort 를 무시하는 시도에서도 빠져나온다', out.join() === '1');
}
{
    // 첫 바이트 뒤에 느린 것은 타임아웃 대상이 아니다(긴 조각은 수십 초 흐른다)
    const attempt = () => (async function* () {
        yield b(7);
        await new Promise(r => setTimeout(r, 250));
        yield b(8);
    })();
    const out: number[] = [];
    let error: any = null;
    try { for await (const x of withTtsRetry(attempt, new AbortController().signal, { firstByteTimeoutMs: 100 })) out.push(x[0]); } catch (e) { error = e; }
    check('첫 바이트 후의 느린 흐름은 끊지 않는다', error === null && out.join() === '7,8', `out=${out}`);
}
{
    let calls = 0;
    const attempt = (_n: number, signal: AbortSignal) => (async function* () {
        calls++;
        await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
        yield b(0);
    })();
    let error: any = null;
    try { for await (const _ of withTtsRetry(attempt, new AbortController().signal, { firstByteTimeoutMs: 50 })) { /* */ } } catch (e) { error = e; }
    check('전부 걸리면 상한에서 408 로 실패', error?.status === 408 && calls === TTS_MAX_ATTEMPTS, `status=${error?.status} calls=${calls}`);
}
check('Gemini RESOURCE_EXHAUSTED 문구는 재시도 대상', isRetryableTtsError(new Error('{"code":429,"status":"RESOURCE_EXHAUSTED"}')));
check('메시지 속 404 는 영구 오류', !isRetryableTtsError(new Error('openai tts 404: model not found')));

if (failed) { console.error(`\n❌ ${failed}건 실패`); process.exit(1); }
console.log('\n✅ 전부 통과');
