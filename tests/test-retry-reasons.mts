/**
 * 재시도·폴백 주입 하니스 — `npx tsx tests/test-retry-reasons.mts`
 * 계획: docs/plans/PLAN_STABILITY_261112.md §4
 *
 * 실제 장애를 기다리지 않고 fetch 를 가짜로 바꿔 실패를 순서대로 주입한다(API 호출·비용 없음).
 * 감시 대상: ① 라우터 — 실패하면 키를 바꿔 1회, 그래도 안 되면 규칙 분류 ② 멈춘 호출은 제한 시간에 끊는다
 * ③ 실패 사유가 열거값으로 남는다(오류 문구 아님) ④ LangChain 경로 재시도 사유
 *
 * config.ts 는 `server-only` 라 react-server 조건으로 자기 자신을 다시 띄운다.
 */
import { spawnSync } from 'node:child_process';

if (!process.env.__RETRY_CHILD) {
    const keys = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`API_KEY${i ? i + 1 : ''}`, `free-${i}`]));
    const env: Record<string, string | undefined> = { ...process.env, ...keys, __RETRY_CHILD: '1', ROUTER_CALL_TIMEOUT_MS: '200', GEMINI_PAID_FIRST: 'false', CHAT_TRACING: 'false',
        // 도구 모듈이 import 시점에 Supabase 클라이언트를 만든다 — 가짜 주소(fetch 는 가짜라 나가지 않는다)
        SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_KEY: 'test', SUPABASE_SERVICE_KEY: 'test', SUPABASE_ANON_KEY: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' };
    delete env.API_KEY_TIER1;
    const r = spawnSync('npx', ['tsx', '--conditions=react-server', new URL(import.meta.url).pathname], { stdio: 'inherit', env });
    process.exit(r.status ?? 1);
}
// .env 의 실제 키가 끼어들지 않게 — 부모가 준 가짜 키 12개만 남긴다
for (const k of Object.keys(process.env)) if (/^API_KEY\d*$/.test(k) && !/^free-\d+$/.test(process.env[k] ?? '')) delete process.env[k];

const { HumanMessage } = await import('@langchain/core/messages');
const { routerNode } = await import('../server/agent/nodes/router.js');
const { runLangChainPath } = await import('../server/agent/nodes/langchain-path.js');
const { RETRY_REASONS, errCodeOf } = await import('../server/agent/turn-log.js');
const { generateOpenAIChat } = await import('../server/openai/chat.js');
const { classifyChatError } = await import('../server/chat-error-policy.js');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
// 하니스 출력이 묻히지 않게 노드 로그는 끈다
console.log = ((orig) => (...a: unknown[]) => { if (typeof a[0] === 'string' && /^[✅❌\n]|passed/.test(a[0])) orig(...a); })(console.log);
console.warn = () => {}; console.error = () => {};

let stray = 0;
process.on('unhandledRejection', () => { stray++; });

// ── 가짜 fetch: 대기열의 응답을 순서대로 준다
type Step = 'ok' | 'hang' | { status: number; apiStatus: string; message?: string } | { reject: string; message: string };
let queue: Step[] = [];
let calls = 0;
const okBody = (text: string) => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
let okText = '{"intent":"general","needs_search":false}';
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    const step = queue.shift() ?? 'ok';
    if (step === 'ok') return new Response(okBody(okText), { status: 200, headers: { 'content-type': 'application/json' } });
    if (step === 'hang') return new Promise<Response>((_, reject) => {
        const sig = init?.signal;
        // AbortSignal.timeout 의 타이머는 이벤트 루프를 붙잡지 않는다 — 실제로는 소켓이 붙잡지만 가짜 fetch 엔 없어 대신 잡아 준다
        const keepAlive = setInterval(() => {}, 1000);
        const abort = () => { clearInterval(keepAlive); reject(sig?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })); };
        if (sig?.aborted) abort(); else sig?.addEventListener('abort', abort);
    });
    if ('reject' in step) throw Object.assign(new Error(step.message), { name: step.reject });
    return new Response(JSON.stringify({ error: { code: step.status, status: step.apiStatus, message: step.message ?? `user@example.com 010-1234-5678 ${step.apiStatus}` } }), { status: step.status, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const state = (text: string) => ({
    messages: [new HumanMessage(text)], attachments: [], webContent: '', contextInfo: '', pillData: null, sessionId: '',
    model: 'gemini-3.6-flash', timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [],
    lastTurnSearched: false, lastTurnSourceLabels: [],
}) as any;
const route = async (steps: Step[], text = '요즘 읽을 만한 소설 추천해줘') => {
    queue = [...steps]; calls = 0;
    const t0 = Date.now();
    const out: any = await routerNode(state(text));
    return { out, ms: Date.now() - t0, calls };
};
const enumOnly = (list: unknown) => Array.isArray(list) && list.every(r => (RETRY_REASONS as readonly string[]).includes(r as string));

// ① 정상 — 실패 없음
{
    const r = await route(['ok']);
    check('정상: LLM 판정·실패 0', r.out.intentFrom === 'router' && r.out.routerRetries.length === 0 && r.calls === 1, JSON.stringify({ f: r.out.intentFrom, rr: r.out.routerRetries, c: r.calls }));
}
// ② 429 → 다음 키로 성공
{
    const r = await route([{ status: 429, apiStatus: 'RESOURCE_EXHAUSTED' }, 'ok']);
    check('429 뒤 재시도 성공: intentFrom=router', r.out.intentFrom === 'router' && r.calls === 2, `${r.out.intentFrom} calls=${r.calls}`);
    check('429: 사유 rate_limit 1건', JSON.stringify(r.out.routerRetries) === '["rate_limit"]', JSON.stringify(r.out.routerRetries));
}
// ③ 503 두 번 → 규칙 분류
{
    const r = await route([{ status: 503, apiStatus: 'UNAVAILABLE' }, { status: 503, apiStatus: 'UNAVAILABLE' }]);
    check('503×2: 규칙 분류로(intentFrom=rule)·호출 2회', r.out.intentFrom === 'rule' && r.calls === 2, `${r.out.intentFrom} calls=${r.calls}`);
    check('503×2: 사유 unavailable 2건', JSON.stringify(r.out.routerRetries) === '["unavailable","unavailable"]', JSON.stringify(r.out.routerRetries));
    check('규칙 분류도 의도를 낸다', typeof r.out.intent === 'string' && r.out.nextNode === 'generator');
}
// ④ 멈춘 호출 → 제한 시간에 끊고 재시도 성공
{
    const r = await route(['hang', 'ok']);
    check('멈춤 뒤 재시도 성공: 사유 timeout', JSON.stringify(r.out.routerRetries) === '["timeout"]' && r.out.intentFrom === 'router', JSON.stringify(r.out.routerRetries));
    check('멈춤: 제한 시간(200ms) 근처에서 끊김', r.ms >= 180 && r.ms < 1500, `${r.ms}ms`);
}
// ⑤ 두 번 다 멈춤 → 규칙 분류, 매달리지 않는다
{
    const r = await route(['hang', 'hang']);
    check('멈춤×2: 규칙 분류·사유 timeout 2건', r.out.intentFrom === 'rule' && JSON.stringify(r.out.routerRetries) === '["timeout","timeout"]', JSON.stringify(r.out.routerRetries));
    check('멈춤×2: 상한 2회분 안에 끝남', r.ms >= 380 && r.ms < 2500, `${r.ms}ms`);
}
// ⑥ 무효 키(400 API_KEY_INVALID) → auth
{
    const r = await route([{ status: 400, apiStatus: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key. API_KEY_INVALID' }, 'ok']);
    check('무효 키: 사유 auth·재시도 성공', JSON.stringify(r.out.routerRetries) === '["auth"]' && r.out.intentFrom === 'router', JSON.stringify(r.out.routerRetries));
}
// ⑦ 사유는 열거값만 — 오류 문구(이메일·전화)가 출력에 없다
{
    const r = await route([{ status: 500, apiStatus: 'INTERNAL' }, { status: 429, apiStatus: 'RESOURCE_EXHAUSTED' }]);
    const json = JSON.stringify(r.out);
    check('사유는 열거값만', enumOnly(r.out.routerRetries), JSON.stringify(r.out.routerRetries));
    check('라우터 출력에 오류 문구 없음', !/example\.com|010-1234/.test(json));
}

// ── LangChain 경로: 키를 바꿔 다시 부를 때 사유를 알린다
const lc = async (steps: Step[]) => {
    queue = [...steps]; calls = 0; okText = '안녕하세요.';
    const reasons: string[] = [];
    let err: any = null, res: any = null;
    try {
        res = await runLangChainPath({
            state: { ...state('안녕'), intent: 'general' }, finalInstruction: 'You are a helpful assistant.', resolvedModel: 'gemini-3.6-flash',
            apiKey: 'free-0', systemInstructionBase: 'You are a helpful assistant.', useLangChain: false, sdkSuccess: false,
            isYoutubeRequest: false, hasVideoData: false, langName: 'Korean', onRetry: (r) => reasons.push(r),
        } as any);
    } catch (e) { err = e; }
    return { reasons, err, res, calls };
};
{
    const r = await lc([{ status: 503, apiStatus: 'UNAVAILABLE' }, 'ok']);
    check('LangChain 503 → unavailable 뒤 성공', JSON.stringify(r.reasons) === '["unavailable"]' && !r.err && !!r.res?.messages?.length, JSON.stringify({ reasons: r.reasons, err: String(r.err?.message ?? '').slice(0, 80), calls: r.calls }));
}
{
    const r = await lc([{ status: 429, apiStatus: 'RESOURCE_EXHAUSTED' }, 'ok']);
    check('LangChain 429 → rate_limit', JSON.stringify(r.reasons) === '["rate_limit"]' && !r.err, JSON.stringify({ reasons: r.reasons, err: String(r.err?.message ?? '').slice(0, 80) }));
}
{
    // AbortSignal.timeout 이 터질 때 fetch 가 던지는 실제 문구 — SDK 가 이름을 버리고 문구만 감싸 올린다
    const r = await lc([{ reject: 'TimeoutError', message: 'The operation was aborted due to timeout' }, 'ok']);
    check('LangChain 타임아웃 → timeout', JSON.stringify(r.reasons) === '["timeout"]' && !r.err, JSON.stringify({ reasons: r.reasons, err: String(r.err?.message ?? '').slice(0, 80) }));
}
{
    const r = await lc([{ reject: 'TypeError', message: 'fetch failed' }, 'ok']);
    check('LangChain 네트워크 끊김(fetch failed) → timeout', JSON.stringify(r.reasons) === '["timeout"]' && !r.err, JSON.stringify({ reasons: r.reasons, err: String(r.err?.message ?? '').slice(0, 80) }));
}
{
    const r = await lc([{ status: 500, apiStatus: 'INTERNAL', message: 'INTERNAL error' }, 'ok']);
    check('LangChain INTERNAL → stream_error', JSON.stringify(r.reasons) === '["stream_error"]' && !r.err, JSON.stringify({ reasons: r.reasons, err: String(r.err?.message ?? '').slice(0, 80) }));
}
{
    const r = await lc([{ status: 400, apiStatus: 'INVALID_ARGUMENT', message: 'bad request' }]);
    check('LangChain 400 → 재시도 없이 오류(사유 0건)', r.reasons.length === 0 && !!r.err, JSON.stringify({ reasons: r.reasons, calls: r.calls }));
}

// ── OpenAI: 키가 하나라 같은 요청을 잠깐 기다렸다 다시 보낸다
type OStep = 'ok' | { status: number; code?: string; type?: string } | 'network' | 'hang';
const oa = async (steps: OStep[], timeoutMs = 5000) => {
    const q = [...steps]; let n = 0; const reasons: string[] = [];
    let err: any = null, res: any = null;
    try {
        res = await generateOpenAIChat({
            model: 'gpt-6-luna', messages: [new HumanMessage('안녕')], instructions: 'You are a helpful assistant.',
            useWebSearch: false, maxOutputTokens: 256, apiKey: 'test', timeoutMs, retryDelaysMs: [0, 0], onRetry: (r) => reasons.push(r),
            fetchImpl: (async (_u: unknown, init?: RequestInit) => {
                n++;
                const step = q.shift() ?? 'ok';
                if (step === 'ok') return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '안녕하세요.', annotations: [] }] }], usage: {} }), { status: 200 });
                if (step === 'network') throw new TypeError('fetch failed');
                if (step === 'hang') return new Promise<Response>((_, reject) => {
                    const keep = setInterval(() => {}, 1000);
                    init?.signal?.addEventListener('abort', () => { clearInterval(keep); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
                });
                return new Response(JSON.stringify({ error: { message: 'user@example.com 010-1234-5678', code: step.code, type: step.type } }), { status: step.status });
            }) as typeof fetch,
        } as any);
    } catch (e) { err = e; }
    return { reasons, err, res, n };
};
{
    const r = await oa([{ status: 429 }, 'ok']);
    check('OpenAI 429 → 다시 보내 성공·사유 rate_limit', !r.err && r.res?.text === '안녕하세요.' && JSON.stringify(r.reasons) === '["rate_limit"]' && r.n === 2, JSON.stringify({ reasons: r.reasons, n: r.n, err: r.err?.code }));
}
{
    const r = await oa([{ status: 503 }, 'network', 'ok']);
    check('OpenAI 503·네트워크 끊김 → 2회 재시도 뒤 성공', !r.err && JSON.stringify(r.reasons) === '["unavailable","unavailable"]' && r.n === 3, JSON.stringify({ reasons: r.reasons, n: r.n }));
}
{
    const r = await oa([{ status: 500 }, { status: 502 }, { status: 503 }, 'ok']);
    check('OpenAI 5xx 가 계속되면 2회 재시도 뒤 오류(호출 3회)', !!r.err && r.n === 3 && r.reasons.length === 2, JSON.stringify({ n: r.n, reasons: r.reasons }));
    check('  └ 로그 코드 unavailable · 화면 unavailable("잠시 후 다시")', errCodeOf(r.err) === 'unavailable' && classifyChatError(r.err) === 'unavailable', `${errCodeOf(r.err)} / ${classifyChatError(r.err)}`);
}
{
    const r = await oa([{ status: 429 }, { status: 429 }, { status: 429 }]);
    check('OpenAI 429 가 계속되면 오류 — 로그 rate_limit · 화면 rate_limit("잠시 후 다시")', !!r.err && r.n === 3 && errCodeOf(r.err) === 'rate_limit' && classifyChatError(r.err) === 'rate_limit', `${r.n} ${errCodeOf(r.err)} / ${classifyChatError(r.err)}`);
}
{
    const r = await oa(['network', 'network', 'network']);
    check('OpenAI 네트워크 끊김이 계속되면 오류 — 로그 unavailable · 화면 unavailable', !!r.err && r.n === 3 && errCodeOf(r.err) === 'unavailable' && classifyChatError(r.err) === 'unavailable', `${r.n} ${errCodeOf(r.err)} / ${classifyChatError(r.err)}`);
}
{
    const r = await oa([{ status: 429, code: 'insufficient_quota' }, 'ok']);
    check('OpenAI 할당량 소진은 다시 보내지 않는다(호출 1회·openai_quota)', !!r.err && r.n === 1 && r.reasons.length === 0 && errCodeOf(r.err) === 'openai_quota' && classifyChatError(r.err) === 'openai_quota', `${r.n} ${errCodeOf(r.err)}`);
}
{
    const r = await oa([{ status: 400 }, 'ok']);
    const r2 = await oa([{ status: 401 }, 'ok']);
    check('OpenAI 400·401 은 다시 보내지 않는다', !!r.err && r.n === 1 && !!r2.err && r2.n === 1 && errCodeOf(r.err) === 'bad_request' && errCodeOf(r2.err) === 'auth');
}
{
    const t0 = Date.now();
    const r = await oa(['hang', 'ok'], 150);
    check('OpenAI 타임아웃은 다시 보내지 않는다(상한이 두 배가 되지 않게) — 로그 timeout · 화면 unavailable', !!r.err && r.n === 1 && r.reasons.length === 0 && Date.now() - t0 < 1000 && errCodeOf(r.err) === 'timeout' && classifyChatError(r.err) === 'unavailable', `${r.n} ${errCodeOf(r.err)} / ${classifyChatError(r.err)} ${Date.now() - t0}ms`);
}

await new Promise(r => setTimeout(r, 50));
check('전체: 떠돌이 rejection 0건', stray === 0, `stray=${stray}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
