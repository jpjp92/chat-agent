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
 */
import { Client } from 'langsmith';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';

type Run = Record<string, unknown>;

// LangGraph·LangChain 이 붙이는 메타데이터 중 원문·식별자가 아닌 것만
const META_KEYS = new Set(['langgraph_node', 'langgraph_step', 'langgraph_triggers', 'ls_provider', 'ls_model_name',
    'ls_model_type', 'ls_temperature', 'ls_max_tokens']);
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

type Usage = { input_tokens: number; output_tokens: number; total_tokens: number };
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

/** 전송 직전 run 정리 — 허용 키만 남기고 원문 자리는 비운다 */
export const sanitizeRun = (run: Run): Run => {
    const out: Run = {};
    for (const [k, v] of Object.entries(run)) if (RUN_KEYS.has(k)) out[k] = v;
    const usage = usageOf(run.outputs);
    if ('inputs' in out) out.inputs = HIDDEN;
    if ('outputs' in out) out.outputs = HIDDEN;
    if ('error' in out) {
        const name = errorName(out.error);
        if (name) out.error = name; else delete out.error;
    }
    if ('extra' in out) {
        const extra = out.extra as { metadata?: unknown } | undefined;
        out.extra = { metadata: cleanMeta(extra?.metadata) };
    }
    // 토큰은 숫자만 메타데이터로 — LangSmith 는 `usage_metadata` 를 토큰 수로 읽는다
    if (usage) out.extra = { metadata: { ...((out.extra as { metadata?: object } | undefined)?.metadata ?? {}), usage_metadata: usage } };
    if (Array.isArray(out.tags)) out.tags = (out.tags as unknown[]).filter(t => typeof t === 'string' && TAG_RE.test(t)).slice(0, 20);
    else delete out.tags;
    return out;
};

/** createRun·updateRun 이 배치 큐에 넣기 전에 정리 — 배치·멀티파트 어느 경로로 보내도 여기를 지난다 */
class SanitizingClient extends Client {
    override async createRun(run: Parameters<Client['createRun']>[0], options?: Parameters<Client['createRun']>[1]) {
        return super.createRun(sanitizeRun(run as unknown as Run) as unknown as typeof run, options);
    }
    override async updateRun(runId: string, run: Parameters<Client['updateRun']>[1], options?: Parameters<Client['updateRun']>[2]) {
        return super.updateRun(runId, sanitizeRun(run as unknown as Run) as unknown as typeof run, options);
    }
}

let client: SanitizingClient | null = null;

/** 하니스가 가짜 전송(fetchImplementation)으로 실제 페이로드를 검사할 수 있게 Client 를 받는다 */
export const createSanitizingClient = (config: ConstructorParameters<typeof Client>[0]) =>
    new SanitizingClient({ ...config, hideInputs: true, hideOutputs: true });
export const makeTracer = (c: Client) =>
    new LangChainTracer({ client: c, projectName: process.env.LANGSMITH_PROJECT || 'chat-agent-dev' });

/** 켜졌는가 — env 스위치와 키가 둘 다 있어야. 없으면 아무것도 만들지 않는다 */
export const tracingEnabled = (): boolean =>
    process.env.CHAT_TRACING === 'true' && !!process.env.LANGSMITH_API_KEY;

/** 그래프 실행 config 에 넣을 콜백. 꺼져 있으면 빈 배열 */
export const traceCallbacks = (): LangChainTracer[] => {
    if (!tracingEnabled()) return [];
    try {
        client ??= new SanitizingClient({ hideInputs: true, hideOutputs: true });
        return [makeTracer(client)];
    } catch {
        return []; // 추적 실패가 채팅을 막지 않는다
    }
};

/** 응답을 닫은 뒤 호출 — 백그라운드 콜백과 배치 전송을 마저 보낸다(서버리스는 응답 뒤 멈출 수 있다) */
export const flushTraces = async (): Promise<void> => {
    if (!client) return;
    try {
        await awaitAllCallbacks();
        await client.awaitPendingTraceBatches();
    } catch { /* 추적 전송 실패는 무시 */ }
};
