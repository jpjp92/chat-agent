import { OPENAI_QUOTA_ERROR_CODES } from '../chat-error-policy';

/**
 * 요청당 구조화 로그 `[turn] {JSON}` — 응답 200 과 기능 성공(블록 생성·파싱)을 구분한다.
 * 계획·보안 원칙: docs/plans/PLAN_TURN_LOG_261105.md §3
 *
 * 허용 목록 방식이다. 문자열 필드는 전부 열거값으로 강제하고 밖의 값은 "other" —
 * 모델이 쓴 펜스 이름·공급자 오류 문구를 그대로 찍으면 로그 주입(가짜 `[turn]` 줄)과 내용 유출 통로가 된다.
 * 사용자 질문·답 본문·URL·출처·세션 ID 는 받지도 않는다(입력 타입에 없다).
 */
const INTENTS = ['drug_id', 'drug_info', 'medical_qa', 'biology', 'chemistry', 'physics', 'astronomy', 'data_viz',
    'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa', 'movie_search', 'weather',
    'paper_search', 'arxiv_search', 'general'] as const;
const INTENT_FROM = ['router', 'rule', 'guard', 'shortcut'] as const;
const PROVIDERS = ['gemini', 'openai'] as const;
const SEARCH_BY = ['router-llm', 'user-explicit', 'followup-guard', 'followup-detail', 'renderer', 'medical-qa',
    'multimodal', 'url-content', 'video-content', 'doc-content', 'default', 'none'] as const;
const BLOCKS = ['chart', 'diagram', 'smiles', 'bio', 'constellation', 'drug', 'weather', 'law', 'physics'] as const;
const OUTCOMES = ['ok', 'empty', 'error', 'url_fetch_failed'] as const;
const ERR_CODES = ['timeout', 'rate_limit', 'openai_quota', 'keys_exhausted', 'unavailable', 'safety', 'bad_request', 'auth', 'server'] as const;
// 재시도·강등 사유 — generator 가 다시 부를 때마다 하나씩 알린다(stream-dispatch 가 모은다)
export const RETRY_REASONS = ['rate_limit', 'timeout', 'unavailable', 'auth', 'media_error', 'empty', 'malformed_call', 'tool_code', 'primary_failed'] as const;
export type RetryReason = (typeof RETRY_REASONS)[number];
// 한 턴의 재시도는 키 수·강등으로 묶여 많아야 몇 번이다 — 이상값이 로그를 키우지 않게 자른다
const MAX_RETRY_LOG = 20;
// models.ts 는 server-only 라 하니스가 못 불러온다 — 목록 대신 형태로 제한(줄바꿈·따옴표·공백 불가)
const MODEL_RE = /^(?:gemini|gpt)-[a-z0-9.-]{1,40}$/;
const pickModel = (v: unknown): string => (typeof v === 'string' && MODEL_RE.test(v) ? v : 'other');

/** 본문이 이보다 크면 블록 파싱을 건너뛴다 — 큰 응답이 로그 단계에서 CPU 를 잡지 않게 */
const MAX_PARSE_CHARS = 200_000;

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | 'other' =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T[number]) : 'other';
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
// 키 3개만 정수로 — 다른 키가 섞여 와도 찍지 않는다
const kindCounts = (v: unknown): { official: number | null; secondary: number | null; other: number | null } | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    return { official: int(o.official), secondary: int(o.secondary), other: int(o.other) };
};

/**
 * 공급자 오류 → 코드. 메시지는 **고정 표지 몇 개가 들어 있는지만** 본다 — 값은 열거값만 나가고 문장은 찍지 않는다
 * (프롬프트 일부가 섞여 돌아올 수 있다). 화면 분류(chat-error-policy)와 같은 원인이 같은 이름이 되게 맞춘다 → REF_ErrorCodes §3
 */
export const errCodeOf = (err: unknown): (typeof ERR_CODES)[number] | 'other' => {
    const e = err as { status?: unknown; name?: unknown; code?: unknown; type?: unknown; message?: unknown; safetyBlock?: unknown } | null;
    const status = typeof e?.status === 'number' ? e.status : null;
    const msg = typeof e?.message === 'string' ? e.message : '';
    if (e?.safetyBlock) return 'safety';
    if (OPENAI_QUOTA_ERROR_CODES.has(String(e?.code ?? '')) || e?.type === 'insufficient_quota') return 'openai_quota';
    // 504·DEADLINE_EXCEEDED·OpenAI 요청 상한(code timeout, status 504)도 타임아웃 — 전엔 status≥500 으로 server 가 됐다
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.code === 'timeout' || status === 504 || msg.includes('DEADLINE_EXCEEDED')) return 'timeout';
    if (status === 429) return 'rate_limit';
    // 키 로테이션이 다 막혀 던진 오류 — status 가 없어 전엔 other 였다
    if (msg.includes('No API key available') || msg.includes('All API keys')) return 'keys_exhausted';
    if (status === 503) return 'unavailable';
    if (status === 400) return 'bad_request';
    if (status === 401 || status === 403) return 'auth';
    if (status !== null && status >= 500) return 'server';
    return 'other';
};

// 오류 문구에서 **있는지만** 보는 고정 표지 — 문구 자체는 로그에 싣지 않는다(입력 일부·모델 출력·URL 이 섞여 온다).
// 한도 종류(PerDay/PerMinute)·공급자 상태 문자열처럼 errCode 만으로는 안 갈리는 진단 단서만 고른다
const ERR_MARKERS = [
    'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'NOT_FOUND',
    'API_KEY_INVALID', 'PerDay', 'PerMinute', 'All API keys', 'No API key available',
    'Failed to parse stream', 'fetch failed', 'MALFORMED_FUNCTION_CALL', 'MAX_TOKENS', 'SAFETY', 'context_length_exceeded',
] as const;
const ERR_TAG_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const errTag = (v: unknown): string | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && ERR_TAG_RE.test(v) ? v : undefined;

/** 모델 요청 실패 로그 필드 — 원문 없이 코드·표지·길이만. `[turn].errCode` 와 같은 분류를 쓴다 → REF_ErrorCodes */
export const errLogFields = (err: unknown) => {
    const e = err as { status?: unknown; code?: unknown; type?: unknown; name?: unknown; message?: unknown } | null;
    const msg = typeof e?.message === 'string' ? e.message : typeof err === 'string' ? err : '';
    return {
        errCode: errCodeOf(err),
        status: typeof e?.status === 'number' && Number.isFinite(e.status) ? e.status : undefined,
        code: errTag(e?.code),
        type: errTag(e?.type),
        name: errTag(e?.name),
        markers: ERR_MARKERS.filter(m => msg.includes(m)),
        msgLen: msg.length,
    };
};

/** 본문의 ```json:<종류> 펜스를 세고 JSON 파싱 성공 수를 센다. 파싱 결과·오류는 버린다. */
export const countBlocks = (text: string): Record<string, { n: number; ok: number | null }> => {
    const out: Record<string, { n: number; ok: number | null }> = {};
    if (!text) return out;
    const tooBig = text.length > MAX_PARSE_CHARS;
    const re = /```json:([A-Za-z_]+)[^\n]*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const kind = pick(BLOCKS, m[1]);
        const slot = (out[kind] ??= { n: 0, ok: tooBig ? null : 0 });
        slot.n += 1;
        if (slot.ok !== null) {
            try { JSON.parse(m[2]); slot.ok += 1; } catch { /* 깨진 블록 — ok 에 안 센다 */ }
        }
    }
    return out;
};

interface TurnLogInput {
    intent?: unknown;
    intentFrom?: unknown;
    provider?: unknown;
    model?: unknown;
    requestedModel?: unknown;
    search?: unknown;
    // 라우터의 검색 필요 판정 — search(실제 실행)와 나란히 봐야 '요청했는데 미실행'이 보인다
    needsSearch?: unknown;
    searchBy?: unknown;
    sources?: unknown;
    // 출처 성격별 개수 — 호출부가 센다. 출처 자체는 받지 않는다
    sourceKinds?: unknown;
    text?: string;
    ms?: unknown;
    // 라우터 노드 소요 · assistant 저장 대기(둘 다 ms 에 포함돼 있다)
    routerMs?: unknown;
    saveMs?: unknown;
    outcome?: unknown;
    err?: unknown;
    // 재시도·강등 사유 목록(발생 순). 열거값 밖은 other
    retries?: unknown;
    // 턴 ID — LangSmith 루트 run ID·chat_messages.trace_id 와 같은 값(PLAN_TRACE_ID_261108).
    // 매 턴 새 무작위 UUID 라 사용자·세션과 이어지지 않는다 — 로그의 유일한 식별자 예외(11-08 결정)
    traceId?: unknown;
}

const retryFields = (v: unknown): { retries: number; retryReasons: string[] } => {
    const list = Array.isArray(v) ? v.slice(0, MAX_RETRY_LOG).map(x => pick(RETRY_REASONS, x)) : [];
    return { retries: list.length, retryReasons: [...new Set(list)] };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** [turn] 필드 객체 — 로그와 LangSmith 루트 메타데이터(tracing.ts turnMetaOf)가 같은 값을 쓰게 한 곳에서 만든다 */
export const turnFields = (i: TurnLogInput): Record<string, unknown> => {
    const model = pickModel(i.model);
    const requested = pickModel(i.requestedModel);
    const outcome = pick(OUTCOMES, i.outcome);
    const line: Record<string, unknown> = {
        v: 1,
        // UUID 형식이 아니면 버린다 — 다른 값(세션 ID·문장)이 이 칸으로 새지 않게
        traceId: typeof i.traceId === 'string' && UUID_RE.test(i.traceId) ? i.traceId : null,
        intent: pick(INTENTS, i.intent),
        intentFrom: pick(INTENT_FROM, i.intentFrom),
        provider: pick(PROVIDERS, i.provider),
        model,
        modelDowngraded: model !== 'other' && requested !== 'other' ? model !== requested : null,
        needsSearch: i.needsSearch === true ? 'on' : i.needsSearch === false ? 'off' : 'other',
        search: i.search === true ? 'on' : i.search === false ? 'off' : 'other',
        searchBy: pick(SEARCH_BY, i.searchBy),
        sources: int(i.sources),
        sourceKinds: kindCounts(i.sourceKinds),
        blocks: countBlocks(typeof i.text === 'string' ? i.text : ''),
        chars: typeof i.text === 'string' ? i.text.length : 0,
        ms: int(i.ms),
        routerMs: int(i.routerMs),
        saveMs: int(i.saveMs),
        outcome,
        ...retryFields(i.retries),
    };
    if (outcome === 'error') line.errCode = errCodeOf(i.err);
    return line;
};

export const buildTurnLog = (i: TurnLogInput): string => {
    try {
        return `[turn] ${JSON.stringify(turnFields(i))}`;
    } catch {
        return '[turn] {"v":1,"logError":true}';
    }
};

/**
 * 로그 실패가 응답을 망치지 않게 — 호출부는 이것만 부른다.
 * 운영 빌드는 `removeConsole` 로 console.log 를 지운다(next.config.ts, error·warn 만 남김) — 경고가 아닌 이 줄이
 * 사라지지 않게 stdout 에 직접 쓴다(Node 런타임 → Vercel 로그 수집)
 */
export const logTurn = (i: TurnLogInput): Record<string, unknown> | null => {
    let fields: Record<string, unknown> | null = null;
    let line = '[turn] {"v":1,"logError":true}';
    try { fields = turnFields(i); line = `[turn] ${JSON.stringify(fields)}`; } catch { fields = null; }
    try { process.stdout.write(`${line}\n`); } catch { /* 무시 */ }
    return fields; // 블록 파싱을 두 번 하지 않게 호출부가 LangSmith 에 그대로 넘긴다
};
