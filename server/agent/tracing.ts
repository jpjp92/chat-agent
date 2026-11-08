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
            if (i !== null || out !== null) {
                const u: Usage = { input_tokens: i ?? 0, output_tokens: out ?? 0, total_tokens: num(ou.total_tokens) ?? (i ?? 0) + (out ?? 0) };
                const cached = num((ou.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens);
                if (cached) u.input_token_details = { cache_read: cached };
                return u;
            }
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

/**
 * 원문 모드 — 로컬은 스위치 하나, 배포는 허용 스위치 + dev 브랜치.
 * 환경(VERCEL_ENV)이 아니라 브랜치로 가른다 — dev 배포 프로젝트(chat-agent-dev)도 production 환경이라
 * 환경으로 막으면 dev 웹 디버깅이 불가능했다(11-08). 브랜치를 모르면 막는다.
 */
type RawWhy = 'on' | 'off' | 'switch_value' | 'allow_missing' | 'allow_value' | 'branch_missing' | 'branch_other';
const rawModeWhy = (): RawWhy => {
    const sw = process.env.CHAT_TRACING_RAW;
    if (sw === undefined || sw === 'false' || sw === '') return 'off';
    if (sw !== 'true') return 'switch_value';
    if (!process.env.VERCEL) return 'on';
    const allow = process.env.CHAT_TRACING_RAW_ALLOW_DEPLOYED;
    if (allow === undefined) return 'allow_missing';
    if (allow !== 'true') return 'allow_value';
    const ref = process.env.VERCEL_GIT_COMMIT_REF;
    if (!ref) return 'branch_missing';
    return ref === 'dev' ? 'on' : 'branch_other';
};
export const rawMode = (): boolean => rawModeWhy() === 'on';

// 원문 스위치를 켰는데 꺼진 이유 — 배포 env 값은 sensitive 라 읽을 수 없어 사유 코드로만 남긴다(인스턴스당 1번)
let rawWhyLogged = false;
const logRawWhy = () => {
    if (rawWhyLogged) return;
    rawWhyLogged = true;
    const why = rawModeWhy();
    if (why === 'off') return;
    try { process.stdout.write(`[trace] ${JSON.stringify({ raw: why === 'on', why })}\n`); } catch { /* 무시 */ }
};

/**
 * 원문으로 남겨도 되는 의도 — **허용 목록**이다. 건강·약·병원·법률·동물병원 상담은 민감정보라 형태 패턴 마스킹으로
 * 병명·사정을 못 가리고, 새로 생기는 의도도 기본은 숨김이어야 한다(제외 목록이면 새 의도가 원문으로 샌다).
 * 첨부(이미지·문서)가 있는 턴도 내용을 가릴 방법이 없어 숨김.
 */
const RAW_ALLOWED_INTENTS = new Set(['general', 'data_viz', 'biology', 'chemistry', 'physics', 'astronomy',
    'weather', 'movie_search', 'paper_search', 'arxiv_search']);
export const rawAllowedForTurn = (root: unknown): boolean => {
    if (!root || typeof root !== 'object') return false;
    const r = root as { outputs?: Record<string, unknown>; inputs?: Record<string, unknown> };
    const intent = r.outputs?.intent;
    if (typeof intent !== 'string' || !RAW_ALLOWED_INTENTS.has(intent)) return false;
    const hasAttach = (x: unknown) => Array.isArray(x) && x.length > 0;
    return !hasAttach(r.outputs?.attachments) && !hasAttach(r.inputs?.attachments);
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
    // 일반 전화(02·031 등) — 휴대폰 다음에 둬야 010 이 지역번호로 먼저 잡히지 않는다
    [/\b0(?:2|[3-6][1-5])[- )]?\d{3,4}[- ]?\d{4}\b/g, '[phone]'],
    // 주소 — 도로명(○○로·길 번호)·지번(○○동 번지)·동호수. 숫자 뒤에 개·명·% 등이 오면 주소가 아니다("경로 2개")
    [/[가-힣]{1,10}(?:로|길)\s?\d{1,4}(?:-\d{1,4})?(?:번길\s?\d{1,4})?(?![\d가-힣%])/g, '[address]'],
    [/[가-힣]{1,10}동\s?\d{1,5}(?:-\d{1,5})?\s?번지/g, '[address]'],
    [/\b\d{1,4}동\s?\d{1,5}호/g, '[address]'],
    // Storage 서명 URL — 첨부 원본에 바로 접근되는 주소다
    [/https:\/\/[a-z0-9.-]+\.supabase\.co\/storage\/[^\s"')\]]+/g, '[storage-url]'],
    // grounding 리다이렉트 — 출처는 title(도메인)로 충분하고, 주소 자체는 읽을 수 없는 긴 토큰이다
    [/https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s"')\]]+/g, '[redirect]'],
];
export const redactText = (t: string): string => REDACT.reduce((acc, [re, rep]) => acc.replace(re, rep), t);

// 원문 모드에서도 식별자는 가린다 — 디버깅에 필요한 건 내용이지 누구의 세션인지가 아니다
const ID_KEYS = new Set(['sessionId', 'session_id', 'userId', 'user_id', 'email', 'thread_id']);
// 디버깅에 쓸모없는 값 — 검색 칩 HTML(수 KB, 검색어는 webSearchQueries 에 있다)·HTTP 헤더·내부 서명·중단 신호 객체
const RAW_DROP_KEYS = new Set(['sdkHttpResponse', 'searchEntryPoint', 'thoughtSignature', 'abortSignal']);

/**
 * 대화 내역은 **마지막 사용자 메시지부터만** — 턴 판정은 이번 턴 의도로만 하므로, 앞 턴이 건강 상담이면
 * 일반 질문 턴의 messages·contents 에 그 대화가 원문으로 딸려 간다. 이번 턴 디버깅엔 이번 질문과 답이면 충분하다.
 * LangChain 메시지(type human)·Gemini contents(role user)·OpenAI input(role user) 모두.
 */
const HISTORY_KEYS = new Set(['messages', 'contents', 'input']);
const isUserMsg = (m: unknown): boolean => {
    if (!m || typeof m !== 'object') return false;
    const x = m as { type?: unknown; role?: unknown; id?: unknown; _getType?: unknown };
    if (x.type === 'human' || x.role === 'user') return true;
    return Array.isArray(x.id) && x.id.includes('HumanMessage');
};
const fromLastUser = (arr: unknown[]): unknown[] => {
    let i = -1;
    for (let k = arr.length - 1; k >= 0; k--) if (isUserMsg(arr[k])) { i = k; break; }
    if (i <= 0) return arr;
    return [`[이전 대화 ${i}개 생략]`, ...arr.slice(i)];
};
// 앞 턴 출처 제목 — 앞 턴 주제(예: 병명)가 드러난다. 개수만
const RAW_COUNT_KEYS = new Set(['lastTurnSourceLabels']);

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
            if (RAW_COUNT_KEYS.has(k) && Array.isArray(x)) { out[k] = `[${x.length}개]`; continue; }
            if (HISTORY_KEYS.has(k) && Array.isArray(x)) { out[k] = scrubRaw(fromLastUser(x), depth + 1, ancestors); continue; }
            out[k] = ID_KEYS.has(k) && x != null ? '[id]' : scrubRaw(x, depth + 1, ancestors);
        }
        return out;
    } finally {
        ancestors.delete(v);
    }
};

/**
 * OpenAI Responses 는 요청의 instructions(시스템 지시 약 3만 자)·tools 를 응답에 그대로 되돌려 준다 —
 * 입력에 이미 있으니 원문 모드 출력에선 뺀다(run 크기·전송량이 2배가 됐다, 11-08 실화면).
 */
const OUTPUT_ECHO_KEYS = new Set(['instructions', 'tools']);
const stripEcho = (v: unknown, depth = 0): unknown => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 3) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!OUTPUT_ECHO_KEYS.has(k)) out[k] = stripEcho(x, depth + 1);
    return out;
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
        if ('outputs' in out) out.outputs = scrubRaw(stripEcho(out.outputs));
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

type CreateArg = Parameters<Client['createRun']>[0];
type UpdateArg = Parameters<Client['updateRun']>[1];
type PendingOp = { kind: 'create'; run: CreateArg; options?: Parameters<Client['createRun']>[1] }
    | { kind: 'update'; runId: string; run: UpdateArg; options?: Parameters<Client['updateRun']>[2] };
// 원문 모드 보류 상한 — 루트가 끝나지 않은 trace 가 쌓여 메모리를 잡지 않게(넘치면 숨김으로 보낸다)
const PENDING_MAX_TRACES = 50;
const PENDING_STALE_MS = 10 * 60_000;

/**
 * createRun·updateRun 이 배치 큐에 넣기 전에 정리 — 배치·멀티파트 어느 경로로 보내도 여기를 지난다.
 * 원문 모드는 의도를 알아야 원문 여부를 정할 수 있는데, 의도는 라우터가 끝나야 나오고 질문은 그 전에 보내진다.
 * 그래서 trace 단위로 모아 두었다가 루트 run 이 끝날 때(의도·첨부가 출력에 있다) 한꺼번에 정리해 보낸다.
 */
class SanitizingClient extends Client {
    private pending = new Map<string, { at: number; rootId?: string; ops: PendingOp[] }>();
    private traceOf = new Map<string, string>();
    constructor(config: ConstructorParameters<typeof Client>[0], readonly raw = false) {
        // 원문 모드는 env 숨김(LANGSMITH_HIDE_*=true)을 명시 false 로 덮는다 — 정리는 sanitizeRun 이 한다
        super({ ...config, hideInputs: !raw, hideOutputs: !raw });
    }
    override async createRun(run: CreateArg, options?: Parameters<Client['createRun']>[1]) {
        if (!this.raw) return super.createRun(sanitizeRun(run as unknown as Run) as unknown as CreateArg, options);
        const r = run as unknown as Run & { id?: string; trace_id?: string; parent_run_id?: string; end_time?: unknown };
        const traceId = (r.trace_id ?? r.id) as string | undefined;
        if (!traceId) return super.createRun(sanitizeRun(r) as unknown as CreateArg, options);
        if (r.id) this.traceOf.set(r.id, traceId);
        const p = this.slot(traceId);
        if (!r.parent_run_id && r.id) p.rootId = r.id;
        p.ops.push({ kind: 'create', run, options });
        // 끝난 상태로 한 번에 오는 루트도 있다
        if (p.rootId === r.id && r.end_time) await this.release(traceId, rawAllowedForTurn(r));
    }
    override async updateRun(runId: string, run: UpdateArg, options?: Parameters<Client['updateRun']>[2]) {
        if (!this.raw) return super.updateRun(runId, sanitizeRun(run as unknown as Run) as unknown as UpdateArg, options);
        const r = run as unknown as Run & { trace_id?: string };
        const traceId = (r.trace_id as string | undefined) ?? this.traceOf.get(runId);
        const p = traceId ? this.pending.get(traceId) : undefined;
        if (!traceId || !p) return super.updateRun(runId, sanitizeRun(r) as unknown as UpdateArg, options);
        p.ops.push({ kind: 'update', runId, run, options });
        if (p.rootId === runId) await this.release(traceId, rawAllowedForTurn(r));
    }
    private slot(traceId: string) {
        let p = this.pending.get(traceId);
        if (!p) {
            if (this.pending.size >= PENDING_MAX_TRACES) void this.releaseStale(0);
            p = { at: Date.now(), ops: [] };
            this.pending.set(traceId, p);
        }
        return p;
    }
    private async release(traceId: string, raw: boolean) {
        const p = this.pending.get(traceId);
        if (!p) return;
        this.pending.delete(traceId);
        for (const op of p.ops) {
            const opId = op.kind === 'create' ? (op.run as { id?: string }).id : op.runId;
            if (opId) this.traceOf.delete(opId);
            if (op.kind === 'create') await super.createRun(sanitizeRun(op.run as unknown as Run, raw) as unknown as CreateArg, op.options);
            else await super.updateRun(op.runId, sanitizeRun(op.run as unknown as Run, raw) as unknown as UpdateArg, op.options);
        }
    }
    /** 루트가 끝나지 않은 오래된 trace 는 숨김으로 보낸다(오류로 끝난 턴·상한 초과) */
    async releaseStale(maxAgeMs = PENDING_STALE_MS) {
        const now = Date.now();
        for (const [id, p] of [...this.pending]) if (now - p.at >= maxAgeMs) await this.release(id, false);
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
    logRawWhy();
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
        await client.releaseStale();
        await client.awaitPendingTraceBatches();
    } catch (e) {
        // 응답은 이미 끝났다 — 실패는 막지 않고 누락을 알 수 있게 코드만 한 줄(메시지는 읽지 않는다)
        try { process.stdout.write(`[trace] ${JSON.stringify({ flush: 'error', code: errorName(e) ?? 'Error' })}\n`); } catch { /* 무시 */ }
    }
};
