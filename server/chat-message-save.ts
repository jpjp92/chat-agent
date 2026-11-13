/**
 * 턴의 chat_messages 저장 — 순서·실패 로그·종료 뒤 마무리 → docs/plans/PLAN_STABILITY_261112.md §2
 *
 * - 저장은 응답을 막지 않는다: user 저장은 시작만 하고 생성과 나란히 간다.
 * - 같은 턴의 저장은 시작한 순서대로 끝난다(assistant 는 user 가 끝난 뒤 나간다). 앞 저장이 실패해도 뒤는 진행.
 * - Promise 는 만드는 즉시 실패를 받아 둔다 — 나중에 await 하기 전 reject 되면 떠돌이 rejection 이 된다.
 * - 로그는 `{ role, traceId, code }` 뿐. Postgres 오류 문구에는 입력값(session_id 등)이 섞일 수 있다.
 */

type SaveRole = 'user' | 'assistant';
type InsertResult = { error: { code?: unknown } | null };

// Postgres SQLSTATE(5자) · PostgREST(PGRSTnnn)만 그대로, 나머지는 고정 코드
const CODE_RE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
/** DB 오류 → 로그에 남겨도 되는 코드. 문구(`message`·`hint`·`details`)는 입력값이 섞여 싣지 않는다 */
export const dbErrorCode = (error: { code?: unknown } | null | undefined) =>
    typeof error?.code === 'string' && CODE_RE.test(error.code) ? error.code : 'db_error_unknown';

export const createMessageSaver = (opts: {
    traceId: string;
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult>;
    log?: (line: string) => void;
    /** 종료 뒤 남은 저장을 기다리는 상한 — 넘으면 로그만 남기고 놓는다(DB 요청은 취소되지 않는다) */
    settleCapMs?: number;
}) => {
    const { traceId, insert, log = (line) => console.error(line), settleCapMs = 5000 } = opts;
    let last: Promise<unknown> = Promise.resolve();

    const fail = (role: SaveRole, code: string) =>
        log(`[save] ${JSON.stringify({ event: 'chat_message_save_failed', role, traceId, code })}`);

    /** 항상 resolve 한다 — 실패는 `{ ok: false }` 와 로그 1줄 */
    const save = (role: SaveRole, row: Record<string, unknown>): Promise<{ ok: boolean }> => {
        const run = last.then(() => insert({ ...row, role, trace_id: traceId })).then(
            ({ error }) => {
                if (!error) return { ok: true };
                fail(role, dbErrorCode(error));
                return { ok: false };
            },
            () => {
                fail(role, 'db_request_failed');
                return { ok: false };
            },
        );
        last = run;
        return run;
    };

    /** 응답이 끝난 뒤(`after`) 부른다 — 스트림 종료를 늦추지 않고, 함수가 멈추기 전에 저장을 마저 끝낸다 */
    const settle = async (): Promise<'done' | 'timeout'> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cap = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), settleCapMs); });
        const result = await Promise.race([last.then(() => 'done' as const), cap]);
        clearTimeout(timer);
        if (result === 'timeout') log(`[save] ${JSON.stringify({ event: 'chat_message_save_wait_timeout', traceId, ms: settleCapMs })}`);
        return result;
    };

    return { save, settle };
};
