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
const ERR_CODES = ['timeout', 'rate_limit', 'unavailable', 'bad_request', 'auth', 'server'] as const;
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

/** 공급자 오류 → 코드. 메시지 문자열은 읽지 않는다(프롬프트 일부가 섞여 돌아올 수 있다). */
export const errCodeOf = (err: unknown): (typeof ERR_CODES)[number] | 'other' => {
    const e = err as { status?: unknown; name?: unknown } | null;
    const status = typeof e?.status === 'number' ? e.status : null;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
    if (status === 429) return 'rate_limit';
    if (status === 503) return 'unavailable';
    if (status === 400) return 'bad_request';
    if (status === 401 || status === 403) return 'auth';
    if (status !== null && status >= 500) return 'server';
    return 'other';
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
    searchBy?: unknown;
    sources?: unknown;
    // 출처 성격별 개수 — 호출부가 센다. 출처 자체는 받지 않는다
    sourceKinds?: unknown;
    text?: string;
    ms?: unknown;
    outcome?: unknown;
    err?: unknown;
    // 턴 ID — LangSmith 루트 run ID·chat_messages.trace_id 와 같은 값(PLAN_TRACE_ID_261108).
    // 매 턴 새 무작위 UUID 라 사용자·세션과 이어지지 않는다 — 로그의 유일한 식별자 예외(11-08 결정)
    traceId?: unknown;
}

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
        search: i.search === true ? 'on' : i.search === false ? 'off' : 'other',
        searchBy: pick(SEARCH_BY, i.searchBy),
        sources: int(i.sources),
        sourceKinds: kindCounts(i.sourceKinds),
        blocks: countBlocks(typeof i.text === 'string' ? i.text : ''),
        chars: typeof i.text === 'string' ? i.text.length : 0,
        ms: int(i.ms),
        outcome,
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
