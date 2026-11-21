/**
 * 등장 모션 "새 메시지" 판정 하니스 — `npx tsx tests/test-new-messages.mts`
 * 계획: docs/plans/PLAN_MOTION_UX_261005.md §7-3 — 기록 복원·세션 전환 때 대화 전체가 페이드되면 안 된다.
 */
import { createNewMessageTracker, FRESH_ON_MOUNT_MS } from '../src/lib/new-messages.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); };

const NOW = 1_800_000_000_000;
const OLD = NOW - 3_600_000;
const m = (id: string, ts = OLD) => ({ id, timestamp: ts });

// 첫 마운트
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('a'), m('b')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    check('기록을 열고 마운트 — 옛 메시지는 새 메시지 아님', !t.isNew('a') && !t.isNew('b'));
}
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('u1', NOW - 100)], sessionId: null, isLoadingHistory: false, now: NOW });
    check('새 대화 첫 질문(마운트와 동시에 생김) — 새 메시지', t.isNew('u1'));
    t.update({ messages: [m('u1', NOW - 100), m('a1', NOW)], sessionId: 's-new', isLoadingHistory: false, now: NOW });
    check('새 대화가 저장돼 세션 id 가 생겨도(null → id) 첫 답변은 새 메시지', t.isNew('a1'));
}
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('x', NOW - FRESH_ON_MOUNT_MS - 1)], sessionId: 's1', isLoadingHistory: false, now: NOW });
    check('마운트 기준 시간보다 오래된 메시지 — 새 메시지 아님', !t.isNew('x'));
}

// 같은 세션에서 턴 추가
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('a')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    t.update({ messages: [m('a'), m('u2')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    t.update({ messages: [m('a'), m('u2'), m('a2')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    check('질문 → 답변 차례로 추가 — 둘 다 새 메시지', t.isNew('u2') && t.isNew('a2'));
    check('기존 메시지는 그대로', !t.isNew('a'));
    t.update({ messages: [m('a'), m('u2'), m('a2')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    check('스트리밍 리렌더(같은 목록) — 판정 유지, 중복 없음', t.isNew('a2'));
}

// 세션 전환·기록 로딩
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('a')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    t.update({ messages: [m('b1'), m('b2')], sessionId: 's2', isLoadingHistory: false, now: NOW });
    check('🔴 세션 전환 — 메시지 2개뿐이어도 새 메시지 아님', !t.isNew('b1') && !t.isNew('b2'));
    t.update({ messages: [m('b1'), m('b2'), m('b3')], sessionId: 's2', isLoadingHistory: false, now: NOW });
    check('전환 뒤 이어서 보낸 메시지는 새 메시지', t.isNew('b3'));
}
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('a')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    t.update({ messages: [m('a'), m('h1')], sessionId: 's1', isLoadingHistory: true, now: NOW });
    check('기록 로딩 중 들어온 메시지 — 새 메시지 아님', !t.isNew('h1'));
}
{
    const t = createNewMessageTracker();
    t.update({ messages: [m('a')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    t.update({ messages: [m('a'), m('h1'), m('h2'), m('h3')], sessionId: 's1', isLoadingHistory: false, now: NOW });
    check('한 번에 3개 이상 늘면(복원) — 새 메시지 아님', !t.isNew('h1') && !t.isNew('h3'));
}

// StrictMode 이중 렌더
{
    const t = createNewMessageTracker();
    const a = { messages: [m('a')], sessionId: 's1', isLoadingHistory: false, now: NOW };
    t.update(a); t.update(a);
    const b = { messages: [m('a'), m('n')], sessionId: 's1', isLoadingHistory: false, now: NOW };
    t.update(b); t.update(b);
    check('같은 입력 두 번 — 결과 동일', t.isNew('n') && !t.isNew('a'));
}

console.log(`\n${pass}/${pass + fail}`);
if (fail > 0) process.exitCode = 1;
