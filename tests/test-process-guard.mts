/**
 * 떠돌이 rejection 처리 하니스 — `npx tsx tests/test-process-guard.mts`
 * 계획: docs/plans/PLAN_STABILITY_261112.md §1
 *
 * 감시 대상: ① LangChain Gemini 스트림이 깨져도 버려진 `response` Promise 가 새지 않음(재현은 패치 전 1건)
 * ② 리스너는 프로세스당 1개 ③ 로그 요약에 오류 문구가 실리지 않음
 * 실제 API 호출 없음 — fetch 를 가짜로 바꾼다.
 */
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { installProcessGuard, __test } from '../server/process-guard.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const enc = new TextEncoder();
const brokenStream = () => new Response(new ReadableStream({ start(c) {
    c.enqueue(enc.encode('data: {"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"}}]}\n\n'));
    c.enqueue(enc.encode('data: {"broken'));  // 잘린 마지막 청크 → Failed to parse stream
    c.close();
}}), { status: 200, headers: { 'content-type': 'text/event-stream' } });
globalThis.fetch = (async () => brokenStream()) as any;

// 리스너 집계는 가드 설치 전에 붙여 둔다 — 새는 건 이 리스너로 센다
let leaked = 0;
process.on('unhandledRejection', () => { leaked++; });

const before = process.listenerCount('unhandledRejection');
installProcessGuard();
installProcessGuard();
check('리스너는 두 번 설치해도 1개 추가', process.listenerCount('unhandledRejection') === before + 1,
    `${before} → ${process.listenerCount('unhandledRejection')}`);

const streamOnce = async () => {
    const llm = new ChatGoogleGenerativeAI({ apiKey: 'test', model: 'gemini-test', maxRetries: 0 });
    try { for await (const _ of await llm.stream('q')) { /* 소비 */ } return 'ok'; }
    catch (e: any) { return String(e?.message ?? e); }
};

// 동시 3개 — 요청 오류는 각자 catch 로 받고 프로세스로는 새지 않아야 한다
const results = await Promise.all([streamOnce(), streamOnce(), streamOnce()]);
await new Promise(r => setTimeout(r, 50));
check('깨진 스트림 오류는 각 호출의 catch 로 전달', results.every(r => r.includes('Failed to parse stream')), JSON.stringify(results));
check('버려진 response Promise 가 새지 않음(0건)', leaked === 0, `leaked=${leaked}`);

// 진짜 떠돌이 rejection 은 프로세스를 끝내지 않고 리스너로 간다
Promise.reject(Object.assign(new Error('user@example.com 010-1234-5678'), { code: 'E_X' }));
await new Promise(r => setTimeout(r, 20));
check('떠돌이 rejection 은 리스너가 받음', leaked === 1, `leaked=${leaked}`);

const s = __test.rejectionSummary(Object.assign(new Error('user@example.com 010-1234-5678'), { status: 500, code: 'E_X' }));
const json = JSON.stringify(s);
check('요약은 name·code·status 만', json === '{"name":"Error","code":"E_X","status":500}', json);
check('요약에 오류 문구 없음', !json.includes('example.com') && !json.includes('010'));
check('객체 아닌 reason 도 처리', JSON.stringify(__test.rejectionSummary('x')) === '{"name":"string"}');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
