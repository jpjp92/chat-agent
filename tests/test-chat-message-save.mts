/**
 * 턴 메시지 저장 하니스 — `npx tsx tests/test-chat-message-save.mts`
 * 계획: docs/plans/PLAN_STABILITY_261112.md §2
 *
 * 감시 대상: ① user → assistant 순서 ② 앞 저장 실패해도 뒤는 진행·로그 1줄 ③ 로그는 role·traceId·code 뿐
 * ④ DB Promise reject 가 떠돌이 rejection 이 되지 않음 ⑤ 종료 뒤 마무리(settle) 상한 ⑥ 턴끼리 섞이지 않음
 * DB 호출 없음 — insert 를 가짜로 넣는다.
 */
import { createMessageSaver, dbErrorCode } from '../server/chat-message-save.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let stray = 0;
process.on('unhandledRejection', () => { stray++; });

const PII = 'invalid input syntax for type uuid: "11111111-2222-3333-4444-555555555555" user@example.com 010-1234-5678';
type Row = Record<string, unknown>;
const mk = (traceId: string, behave: (row: Row) => Promise<{ error: any }>, capMs?: number) => {
    const logs: string[] = [];
    const done: string[] = [];
    const saver = createMessageSaver({
        traceId, settleCapMs: capMs, log: (l) => logs.push(l),
        insert: async (row) => { const r = await behave(row); done.push(`${row.role}:${row.trace_id}`); return r; },
    });
    return { saver, logs, done };
};

// ① 정상 — user 가 느려도 assistant 는 그 뒤에 끝난다, trace_id·role 은 saver 가 붙인다
{
    const t = mk('t-1', async (row) => { await sleep(row.role === 'user' ? 40 : 1); return { error: null }; });
    void t.saver.save('user', { session_id: 's', content: 'q' });
    const r = await t.saver.save('assistant', { session_id: 's', content: 'a' });
    check('정상: user → assistant 순서', t.done.join() === 'user:t-1,assistant:t-1', t.done.join());
    check('정상: ok·로그 0줄', r.ok && t.logs.length === 0);
}

// ② user 실패(오류 응답) → assistant 진행, 로그 1줄
{
    const t = mk('t-2', async (row) => row.role === 'user'
        ? { error: { code: '22P02', message: PII, hint: PII, details: PII } } : { error: null });
    const u = t.saver.save('user', { session_id: 's', content: '비밀 질문' });
    const a = await t.saver.save('assistant', { session_id: 's', content: 'a' });
    check('user 실패해도 assistant 저장 진행', (await u).ok === false && a.ok === true);
    check('실패 로그 1줄', t.logs.length === 1, String(t.logs.length));
    const line = t.logs[0] ?? '';
    check('로그 키는 event·role·traceId·code 뿐',
        line === '[save] {"event":"chat_message_save_failed","role":"user","traceId":"t-2","code":"22P02"}', line);
    check('로그에 오류 문구·입력값 없음', !/example\.com|010-|11111111|비밀|session/.test(line));
    await t.saver.settle();
    check('settle 뒤에도 로그는 1줄(중복 없음)', t.logs.length === 1);
}

// ③ 코드 정규화 — 허용 모양 밖은 고정 코드
{
    const t = mk('t-3', async (row) => ({ error: { code: row.role === 'user' ? 'x"; DROP\n[turn] {}' : 'PGRST116' } }));
    await t.saver.save('user', {});
    await t.saver.save('assistant', {});
    check('모양 밖 코드 → db_error_unknown', t.logs[0]?.includes('"code":"db_error_unknown"') && !t.logs[0].includes('DROP'), t.logs[0]);
    check('PostgREST 코드는 그대로', t.logs[1]?.includes('"code":"PGRST116"'), t.logs[1]);
}

// ④ DB Promise reject(네트워크) — 아무도 await 하지 않아도 떠돌이 0건(생성 즉시 실패 경로)
{
    const t = mk('t-4', async () => { throw new Error(PII); });
    void t.saver.save('user', { session_id: 's', content: 'q' });
    await sleep(20);
    check('reject 가 떠돌이 rejection 이 되지 않음', stray === 0, `stray=${stray}`);
    check('reject → db_request_failed 로그 1줄', t.logs.length === 1 && t.logs[0].includes('"code":"db_request_failed"') && !t.logs[0].includes('example'), t.logs.join());
    check('settle 은 done', await t.saver.settle() === 'done');
}

// ⑤ URL 실패 경로 — assistant 를 await 하지 않고 나가도 settle 이 순서대로 끝까지 기다린다
{
    const t = mk('t-5', async () => { await sleep(30); return { error: null }; });
    void t.saver.save('user', { content: 'q' });
    void t.saver.save('assistant', { content: 'fail msg' });
    check('settle 전: 아직 미완료', t.done.length === 0);
    check('settle → done', await t.saver.settle() === 'done');
    check('settle 뒤: user → assistant 모두 저장', t.done.join() === 'user:t-5,assistant:t-5', t.done.join());
}

// ⑥ DB 지연 — 상한에서 놓고 로그 1줄(무한 대기 없음)
{
    const t = mk('t-6', async () => { await sleep(300); return { error: null }; }, 30);
    void t.saver.save('user', { content: 'q' });
    const started = Date.now();
    const r = await t.saver.settle();
    const ms = Date.now() - started;
    check('지연: 상한에서 timeout', r === 'timeout' && ms < 200, `${r} ${ms}ms`);
    check('지연: 대기 초과 로그(traceId·ms 만)',
        t.logs.join() === '[save] {"event":"chat_message_save_wait_timeout","traceId":"t-6","ms":30}', t.logs.join());
}

// ⑦ 동시 턴 2개 — 한쪽 실패·지연이 다른 쪽에 안 섞인다
{
    const a = mk('t-A', async (row) => { await sleep(40); return row.role === 'user' ? { error: { code: '23503' } } : { error: null }; });
    const b = mk('t-B', async () => ({ error: null }));
    void a.saver.save('user', {}); void b.saver.save('user', {});
    const [ra, rb] = await Promise.all([a.saver.save('assistant', {}), b.saver.save('assistant', {})]);
    check('동시: 각 턴 저장은 자기 traceId 만', a.done.every(d => d.endsWith('t-A')) && b.done.every(d => d.endsWith('t-B')));
    check('동시: A 실패 로그는 A 에만', a.logs.length === 1 && a.logs[0].includes('t-A') && b.logs.length === 0);
    check('동시: 둘 다 assistant 저장 완료', ra.ok && rb.ok);
}

// ⑧ 저장이 없던 턴(세션 없음·인증 실패) — settle 즉시 done
check('저장 0건: settle 즉시 done', await mk('t-8', async () => ({ error: null })).saver.settle() === 'done');

// ⑨ 프로필 조회 실패 로그도 같은 코드 규칙
check('dbErrorCode: SQLSTATE·PGRST 만, 밖은 고정', dbErrorCode({ code: '42P01' }) === '42P01' && dbErrorCode({ code: 'PGRST301' }) === 'PGRST301' && dbErrorCode({ code: PII }) === 'db_error_unknown' && dbErrorCode(null) === 'db_error_unknown');

await sleep(20);
check('전체: 떠돌이 rejection 0건', stray === 0, `stray=${stray}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
