/**
 * LangSmith 추적 — 관측만 더한다. 계획: docs/plans/PLAN_LANGSMITH_TRACING_261107.md
 *
 * 켜는 스위치는 `CHAT_TRACING=true` 이고 `LANGSMITH_TRACING` 은 **항상 false** 로 둔다. 후자를 켜면
 * @langchain/core 가 그래프 밖 LangChain 호출마다 기본 추적기(기본 Client)를 끼워 넣는데, 기본 Client 는
 * 바꿀 수 없어 아래 정리를 거치지 않고 나간다. 그래서 정리하는 추적기를 그래프 실행에만 직접 넘긴다.
 *
 * env 숨김(`LANGSMITH_HIDE_*`)은 inputs·outputs 만 덮는다. 그 밖으로 원문이 새는 자리:
 *   - error: 공급자 오류에 프롬프트 일부가 섞여 온다 → 오류 이름만
 *   - events: 스트리밍 토큰이 `new_token` 이벤트로 그대로 실린다 → 버린다
 *   - serialized: 모델·도구 생성자 인자 → 버린다
 *   - extra.metadata·tags: LangGraph 가 붙이는 값 → 허용 목록
 *
 * 원문 모드(`CHAT_TRACING_RAW=true`) — 디버깅용. 배포(`VERCEL`)에선 `CHAT_TRACING_RAW_ALLOW_DEPLOYED=true` 를 함께 둔
 * 경우만(dev 배포는 본인만 쓴다, 11-07), **Production(`VERCEL_ENV=production`)은 어떤 경우에도 무시**한다.
 * 입출력·오류 원문을 별도 프로젝트(`LANGSMITH_PROJECT_RAW`, 기본 chat-agent-dev-raw)로 보낸다 — 숨김 추적과 섞이지 않고
 * 프로젝트째 지울 수 있게. 첨부 base64 는 길이만, 아주 긴 문자열은 앞부분만. 합성 질문에만 쓴다.
 */
import { Client } from 'langsmith';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { traceable } from 'langsmith/traceable';

type Run = Record<string, unknown>;

// LangGraph·LangChain 이 붙이는 메타데이터 중 원문·식별자가 아닌 것만
const META_KEYS = new Set(['langgraph_node', 'langgraph_step', 'langgraph_triggers', 'ls_provider', 'ls_model_name',
    'ls_model_type', 'ls_temperature', 'ls_max_tokens',
    // llmSpan 이 붙이는 값 — 호출 종류(열거)·시도 번호·검색 여부·출처 개수
    'call', 'attempt', 'search', 'grounding_sources']);
// 태그는 내부 열거값만(`seq:step:1`·`graph:step:2`·노드명·내부 LLM 표시) — 길이·문자 제한
const TAG_RE = /^[a-z0-9_:.-]{1,40}$/i;
const RUN_KEYS = new Set(['id', 'name', 'run_type', 'start_time', 'end_time', 'parent_run_id', 'trace_id', 'dotted_order',
    'session_name', 'project_name', 'inputs', 'outputs', 'error', 'extra', 'tags']);

const HIDDEN = { hidden: true };

/** 오류 문자열 → 이름만("TimeoutError", "ApiError"). 메시지는 읽지 않는다 */
export const errorName = (e: unknown): string | undefined => {
    if (e === undefined || e === null || e === '') return undefined;
    const m = String(e).match(/^\s*([A-Z][A-Za-z]{0,40}Error)\b/);
    return m ? m[1] : 'Error';
};

const cleanMeta = (meta: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!meta || typeof meta !== 'object') return out;
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
        if (!META_KEYS.has(k)) continue;
        if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'string' && TAG_RE.test(v)) out[k] = v;
        else if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string' && TAG_RE.test(x)).slice(0, 10);
    }
    return out;
};

type Usage = { input_tokens: number; output_tokens: number; total_tokens: number; input_token_details?: { cache_read: number } };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * 출력에서 토큰 수만 꺼낸다 — 출력은 통째로 비우므로 LangSmith 가 토큰을 못 센다. 숫자 외에는 읽지 않는다.
 * LangChain 메시지 `usage_metadata`(input_tokens·output_tokens) · `llm_output.tokenUsage`(promptTokens·completionTokens)
 */
export const usageOf = (outputs: unknown): Usage | null => {
    const seen = new Set<unknown>();
    const walk = (o: unknown, depth: number): Usage | null => {
        if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return null;
        seen.add(o);
        const x = o as Record<string, unknown>;
        const um = x.usage_metadata as Record<string, unknown> | undefined;
        if (um && typeof um === 'object') {
            const i = num(um.input_tokens), out = num(um.output_tokens);
            if (i !== null || out !== null) return { input_tokens: i ?? 0, output_tokens: out ?? 0, total_tokens: num(um.total_tokens) ?? (i ?? 0) + (out ?? 0) };
        }
        // Gemini SDK 응답 `usageMetadata`(promptTokenCount·candidatesTokenCount)
        const gm = x.usageMetadata as Record<string, unknown> | undefined;
        if (gm && typeof gm === 'object') {
            const i = num(gm.promptTokenCount), out = num(gm.candidatesTokenCount);
            if (i !== null || out !== null) {
                const u: Usage = { input_tokens: i ?? 0, output_tokens: out ?? 0, total_tokens: num(gm.totalTokenCount) ?? (i ?? 0) + (out ?? 0) };
                // 암묵 캐시로 처리된 입력 — 단가가 달라 LangSmith 비용 계산에 필요하다
                const cached = num(gm.cachedContentTokenCount);
                if (cached) u.input_token_details = { cache_read: cached };
                return u;
            }
        }
        // OpenAI Responses `usage`(input_tokens·output_tokens)
        const ou = x.usage as Record<string, unknown> | undefined;
        if (ou && typeof ou === 'object') {
            const i = num(ou.input_tokens), out = num(ou.output_tokens);
            if (i !== null || out !== null) return { input_tokens: i ?? 0, output_tokens: out ?? 0, total_tokens: num(ou.total_tokens) ?? (i ?? 0) + (out ?? 0) };
        }
        const tu = x.tokenUsage as Record<string, unknown> | undefined;
        if (tu && typeof tu === 'object') {
            const i = num(tu.promptTokens), out = num(tu.completionTokens);
            if (i !== null || out !== null) return { input_tokens: i ?? 0, output_tokens: out ?? 0, total_tokens: num(tu.totalTokens) ?? (i ?? 0) + (out ?? 0) };
        }
        for (const v of Object.values(x)) { const u = walk(v, depth + 1); if (u) return u; }
        return null;
    };
    return walk(outputs, 0);
};

/** 출력 어딘가의 `groundingMetadata.groundingChunks` 개수 — 배열 길이만 읽는다 */
const groundingCountOf = (outputs: unknown): number | null => {
    const seen = new Set<unknown>();
    const walk = (o: unknown, depth: number): number | null => {
        if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return null;
        seen.add(o);
        const gm = (o as { groundingMetadata?: { groundingChunks?: unknown } }).groundingMetadata;
        if (gm && Array.isArray(gm.groundingChunks)) return gm.groundingChunks.length;
        for (const v of Object.values(o as Record<string, unknown>)) { const n = walk(v, depth + 1); if (n !== null) return n; }
        return null;
    };
    return walk(outputs, 0);
};

/** 원문 모드 — 로컬은 스위치 하나, 배포는 허용 스위치까지, Production 은 불가 */
export const rawMode = (): boolean => {
    if (process.env.CHAT_TRACING_RAW !== 'true') return false;
    if (!process.env.VERCEL) return true;
    if (process.env.VERCEL_ENV === 'production') return false;
    return process.env.CHAT_TRACING_RAW_ALLOW_DEPLOYED === 'true';
};

// 시스템 지시가 3만 자 안팎이라 2만에선 뒷부분(차트·출처 규칙)이 잘렸다
const RAW_STR_MAX = 60_000;
const BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/;
/**
 * 원문 모드 문자열 안의 민감정보 — 키 이름 가리기(ID_KEYS)로는 질문 **문장 안의** 값을 못 막는다(11-08 GPT 검토).
 * 디버깅에 필요한 건 문장 구조라 형태만 남긴다. 순서: 키·토큰(긴 것) 먼저, 숫자 패턴은 나중.
 */
const REDACT: Array<[RegExp, string]> = [
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [token]'],
    [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[api-key]'],
    [/\bAIza[0-9A-Za-z_-]{30,}/g, '[api-key]'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[api-key]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/\b(?:\d{4}[- ]?){3}\d{4}\b/g, '[card]'],
    [/\b\d{6}[- ]?[1-4]\d{6}\b/g, '[rrn]'],
    [/(?:\+?82[- ]?|\b0)1[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, '[phone]'],
    // grounding 리다이렉트 — 출처는 title(도메인)로 충분하고, 주소 자체는 읽을 수 없는 긴 토큰이다
    [/https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s"')\]]+/g, '[redirect]'],
];
export const redactText = (t: string): string => REDACT.reduce((acc, [re, rep]) => acc.replace(re, rep), t);

// 원문 모드에서도 식별자는 가린다 — 디버깅에 필요한 건 내용이지 누구의 세션인지가 아니다
const ID_KEYS = new Set(['sessionId', 'session_id', 'userId', 'user_id', 'email', 'thread_id']);
// 디버깅에 쓸모없는 값 — 검색 칩 HTML(수 KB, 검색어는 webSearchQueries 에 있다)·HTTP 헤더·내부 서명·중단 신호 객체
const RAW_DROP_KEYS = new Set(['sdkHttpResponse', 'searchEntryPoint', 'thoughtSignature', 'abortSignal']);

/**
 * 원문 모드 입출력 — base64·바이너리는 길이만, 긴 문자열은 앞부분만, 깊이·배열 길이 제한(전송량·직렬화 비용).
 * 순환 검사는 **조상 경로**로 한다 — LangChain 메시지는 같은 객체를 두 곳(content·lc_kwargs.content)에서 가리켜,
 * 한 번 본 객체를 전부 순환으로 치면 두 번째가 "[circular]" 로 지워진다(11-07 실화면).
 */
export const scrubRaw = (v: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown => {
    if (typeof v === 'string') {
        if (/^data:[^;,]+;base64,/.test(v)) return `[base64 ${v.length} chars]`;
        if (v.length > 2000 && BASE64_RE.test(v.slice(0, 2000))) return `[base64 ${v.length} chars]`;
        const t = redactText(v);
        return t.length > RAW_STR_MAX ? `${t.slice(0, RAW_STR_MAX)}…[+${t.length - RAW_STR_MAX} chars]` : t;
    }
    if (!v || typeof v !== 'object') return v;
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `[binary ${v.byteLength} bytes]`;
    if (depth > 12) return '[depth]';
    if (ancestors.has(v)) return '[circular]';
    ancestors.add(v);
    try {
        if (Array.isArray(v)) return v.slice(0, 200).map(x => scrubRaw(x, depth + 1, ancestors));
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
            if (RAW_DROP_KEYS.has(k)) continue;
            out[k] = ID_KEYS.has(k) && x != null ? '[id]' : scrubRaw(x, depth + 1, ancestors);
        }
        return out;
    } finally {
        ancestors.delete(v);
    }
};

/** 전송 직전 run 정리 — 허용 키만 남기고 원문 자리는 비운다(원문 모드는 입출력·오류를 줄여서 남긴다) */
export const sanitizeRun = (run: Run, raw = false): Run => {
    const out: Run = {};
    for (const [k, v] of Object.entries(run)) if (RUN_KEYS.has(k)) out[k] = v;
    const usage = usageOf(run.outputs);
    // Gemini 응답의 grounding 출처 개수 — 숫자만(제목·URL 은 읽지 않는다)
    // traceable 은 반환값을 한 겹 감싸 보낼 수 있어 경로를 고정하지 않고 찾는다(토큰과 같은 방식)
    const groundingSources = groundingCountOf(run.outputs);
    if (raw) {
        if ('inputs' in out) out.inputs = scrubRaw(out.inputs);
        if ('outputs' in out) out.outputs = scrubRaw(out.outputs);
        if (typeof out.error === 'string') out.error = redactText(out.error.slice(0, 2000));
    } else {
        if ('inputs' in out) out.inputs = HIDDEN;
        if ('outputs' in out) out.outputs = HIDDEN;
    }
    if ('error' in out && !raw) {
        const name = errorName(out.error);
        if (name) out.error = name; else delete out.error;
    }
    if ('extra' in out) {
        const extra = out.extra as { metadata?: unknown } | undefined;
        out.extra = { metadata: cleanMeta(extra?.metadata) };
    }
    // 토큰은 숫자만 메타데이터로 — LangSmith 는 `usage_metadata` 를 토큰 수로 읽는다
    if (usage || groundingSources !== null) {
        const meta = { ...((out.extra as { metadata?: object } | undefined)?.metadata ?? {}) } as Record<string, unknown>;
        if (usage) meta.usage_metadata = usage;
        if (groundingSources !== null) meta.grounding_sources = groundingSources;
        out.extra = { metadata: meta };
    }
    if (Array.isArray(out.tags)) out.tags = (out.tags as unknown[]).filter(t => typeof t === 'string' && TAG_RE.test(t)).slice(0, 20);
    else delete out.tags;
    return out;
};

/** createRun·updateRun 이 배치 큐에 넣기 전에 정리 — 배치·멀티파트 어느 경로로 보내도 여기를 지난다 */
class SanitizingClient extends Client {
    constructor(config: ConstructorParameters<typeof Client>[0], readonly raw = false) {
        // 원문 모드는 env 숨김(LANGSMITH_HIDE_*=true)을 명시 false 로 덮는다 — 정리는 sanitizeRun 이 한다
        super({ ...config, hideInputs: !raw, hideOutputs: !raw });
    }
    override async createRun(run: Parameters<Client['createRun']>[0], options?: Parameters<Client['createRun']>[1]) {
        return super.createRun(sanitizeRun(run as unknown as Run, this.raw) as unknown as typeof run, options);
    }
    override async updateRun(runId: string, run: Parameters<Client['updateRun']>[1], options?: Parameters<Client['updateRun']>[2]) {
        return super.updateRun(runId, sanitizeRun(run as unknown as Run, this.raw) as unknown as typeof run, options);
    }
}

let client: SanitizingClient | null = null;

const projectName = (raw: boolean) => raw
    ? process.env.LANGSMITH_PROJECT_RAW || 'chat-agent-dev-raw'
    : process.env.LANGSMITH_PROJECT || 'chat-agent-dev';

/** 모드가 바뀌면(로컬에서 env 를 고치고 재시작 없이) 새로 만든다 */
const getClient = (): SanitizingClient => {
    const raw = rawMode();
    if (!client || client.raw !== raw) client = new SanitizingClient({}, raw);
    return client;
};

/** 하니스가 가짜 전송(fetchImplementation)으로 실제 페이로드를 검사할 수 있게 Client 를 받는다 */
export const createSanitizingClient = (config: ConstructorParameters<typeof Client>[0], raw = false) =>
    new SanitizingClient(config, raw);
export const makeTracer = (c: Client) =>
    new LangChainTracer({ client: c, projectName: projectName(c instanceof SanitizingClient && c.raw) });

/** 켜졌는가 — env 스위치와 키가 둘 다 있어야. 없으면 아무것도 만들지 않는다 */
export const tracingEnabled = (): boolean =>
    process.env.CHAT_TRACING === 'true' && !!process.env.LANGSMITH_API_KEY;

/** 그래프 실행 config 에 넣을 콜백. 꺼져 있으면 빈 배열 */
export const traceCallbacks = (): LangChainTracer[] => {
    if (!tracingEnabled()) return [];
    try {
        return [makeTracer(getClient())];
    } catch {
        return []; // 추적 실패가 채팅을 막지 않는다
    }
};

/** 호출 종류 — 메타데이터 `call` 은 이 열거값만 */
type LlmCall = 'router' | 'stage1' | 'stage1_retry' | 'single' | 'single_retry' | 'malformed_retry' | 'ground_retry'
    | 'fallback' | 'openai_initial' | 'openai_followup' | 'openai_other';

/**
 * SDK 직접 호출 한 번을 LangSmith llm run 으로 — LangGraph 노드 안에서 부르면 그 노드의 자식이 된다.
 * 꺼져 있으면 fn 을 그대로 부른다(추적 비용 0). 반환값은 원본 그대로(grounding 메타데이터 유지, 호출 1회).
 */
export const llmSpan = <T>(
    provider: 'gemini' | 'openai',
    meta: { call: LlmCall; model: string; search?: boolean; attempt?: number },
    fn: () => Promise<T>,
    input?: () => Record<string, unknown>,
): Promise<T> => {
    if (!tracingEnabled()) return fn();
    let c: SanitizingClient;
    try { c = getClient(); } catch { return fn(); }
    const metadata: Record<string, string | number | boolean> = {
        ls_provider: provider === 'gemini' ? 'google_genai' : 'openai', ls_model_name: meta.model, call: meta.call,
    };
    if (meta.search !== undefined) metadata.search = meta.search;
    if (meta.attempt !== undefined) metadata.attempt = meta.attempt;
    const run = traceable((_in?: Record<string, unknown>) => fn(), {
        name: `${provider}.${meta.call}`, run_type: 'llm', client: c, tracingEnabled: true,
        project_name: projectName(c.raw), metadata,
    });
    // 입력은 원문 모드에서만 넘긴다 — 숨김 모드는 어차피 비우므로 프롬프트를 직렬화할 이유가 없다
    if (!c.raw || !input) return run();
    let args: Record<string, unknown> | undefined;
    try { args = input(); } catch { args = undefined; }
    return run(args);
};

/**
 * Gemini `models.generateContent` 를 llmSpan 으로 — 모델·검색 여부는 호출 인자에서 읽는다(호출부가 따로 적으면 어긋난다).
 * `models.generateContent(params)` 형태 그대로 부른다(메서드를 떼어 부르면 this 가 끊긴다).
 */
type GeminiParams = { model: string; config?: { tools?: unknown[] } };
export const traceGemini = <P extends GeminiParams, R>(
    call: LlmCall,
    models: { generateContent: (p: P) => Promise<R> },
    params: P,
    attempt?: number,
): Promise<R> => llmSpan('gemini', {
    call, model: params.model, attempt,
    search: Array.isArray(params.config?.tools) && params.config!.tools!.some(t => !!t && typeof t === 'object' && 'googleSearch' in (t as object)),
}, () => models.generateContent(params), () => ({ ...params }));

/** 응답을 닫은 뒤 호출 — 백그라운드 콜백과 배치 전송을 마저 보낸다(서버리스는 응답 뒤 멈출 수 있다) */
export const flushTraces = async (): Promise<void> => {
    if (!client) return;
    try {
        await awaitAllCallbacks();
        await client.awaitPendingTraceBatches();
    } catch (e) {
        // 응답은 이미 끝났다 — 실패는 막지 않고 누락을 알 수 있게 코드만 한 줄(메시지는 읽지 않는다)
        try { process.stdout.write(`[trace] ${JSON.stringify({ flush: 'error', code: errorName(e) ?? 'Error' })}\n`); } catch { /* 무시 */ }
    }
};
