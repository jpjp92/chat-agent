/**
 * LangSmith 추적 정리 하니스 — `npx tsx tests/test-tracing.mts`
 * 계획: docs/plans/PLAN_LANGSMITH_TRACING_261107.md §2·§5
 *
 * 가짜 전송(fetchImplementation)으로 **실제로 나갈 바이트**를 받아, 원문·URL·이메일·스트리밍 토큰·오류 메시지가 없는지 본다.
 * 네트워크·키 없음.
 */
import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { FakeStreamingChatModel } from '@langchain/core/utils/testing';
import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { createSanitizingClient, makeTracer, sanitizeRun, usageOf, errorName, tracingEnabled, traceCallbacks } from '../server/agent/tracing.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// ① 순수 정리
const r = sanitizeRun({ id: '1', name: 'generator', inputs: { q: '비밀' }, outputs: { a: '답' }, error: 'ApiError: prompt leaked 비밀',
    events: [{ name: 'new_token', kwargs: { token: '토큰' } }], serialized: { kwargs: { apiKey: 'sk-x' } },
    extra: { metadata: { langgraph_node: 'generator', thread_id: 'user@example.com', ls_model_name: 'gemini-3.8-flash' }, runtime: { x: 1 } },
    tags: ['graph:step:1', '사용자 질문 원문 태그'] });
const js = JSON.stringify(r);
check('inputs·outputs 숨김', js.includes('"inputs":{"hidden":true}') && js.includes('"outputs":{"hidden":true}'));
check('오류는 이름만', r.error === 'ApiError', String(r.error));
check('events·serialized·runtime 제거', !('events' in r) && !('serialized' in r) && !js.includes('runtime'));
check('메타데이터 허용 목록(thread_id 제거)', !js.includes('example.com') && js.includes('langgraph_node'));
check('원문 태그 제거', !js.includes('원문'));
check('errorName 메시지 안 읽음', errorName('Error: 010-1234-5678') === 'Error' && errorName('TimeoutError: x') === 'TimeoutError' && errorName('') === undefined);

// 토큰 수 — 숫자만 메타데이터로, 출력 원문은 여전히 비운다
const ur = sanitizeRun({ id: '2', outputs: { generations: [[{ text: '답 원문', message: { kwargs: { content: '답 원문', usage_metadata: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } } } }]] } });
const ujs = JSON.stringify(ur);
check('토큰 수 → metadata.usage_metadata', ujs.includes('"usage_metadata":{"input_tokens":120,"output_tokens":30,"total_tokens":150}'), ujs);
check('토큰 옮겨도 출력 원문 없음', !ujs.includes('답 원문'));
check('llm_output.tokenUsage 형식', JSON.stringify(usageOf({ llm_output: { tokenUsage: { promptTokens: 5, completionTokens: 7 } } })) === '{"input_tokens":5,"output_tokens":7,"total_tokens":12}');
check('숫자 아닌 토큰 값은 무시', usageOf({ usage_metadata: { input_tokens: '많음' } }) === null);

// ② 켜기 스위치
const saved = { ...process.env };
process.env.LANGSMITH_API_KEY = 'test'; process.env.CHAT_TRACING = 'false';
check('CHAT_TRACING≠true 면 꺼짐·콜백 없음', !tracingEnabled() && traceCallbacks().length === 0);
process.env.CHAT_TRACING = 'true'; delete process.env.LANGSMITH_API_KEY;
check('키 없으면 꺼짐', !tracingEnabled() && traceCallbacks().length === 0);
process.env = saved;

// ③ 실제 전송 바이트 — 그래프 + 스트리밍 모델 + 오류
const SECRET = ['비밀질문', 'user@example.com', 'https://secret.example/a', '응답토큰', 'leaked-prompt'];
const bodies: string[] = [];
const fakeFetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const b = init?.body;
    if (b instanceof ReadableStream) bodies.push(await new Response(b).text());
    else if (b instanceof Uint8Array || b instanceof ArrayBuffer) bodies.push(new TextDecoder().decode(b as Uint8Array));
    else if (b && typeof (b as Blob).arrayBuffer === 'function') bodies.push(new TextDecoder().decode(await (b as Blob).arrayBuffer()));
    else if (b && typeof (b as FormData).entries === 'function') {
        for (const [, v] of (b as FormData).entries()) bodies.push(typeof v === 'string' ? v : new TextDecoder().decode(await (v as Blob).arrayBuffer()));
    } else bodies.push(String(b ?? ''));
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;
const client = createSanitizingClient({ apiKey: 'test', apiUrl: 'http://localhost:1', fetchImplementation: fakeFetch });

const S = Annotation.Root({ q: Annotation<string>(), a: Annotation<string>() });
const model = new FakeStreamingChatModel({ chunks: [new AIMessageChunk('응답토큰 '), new AIMessageChunk('https://secret.example/a')] });
const g = new StateGraph(S)
    .addNode('generator', async (s) => {
        let a = '';
        for await (const c of await model.stream([new HumanMessage(s.q)])) a += String(c.content);
        return { a };
    })
    .addNode('boom', async () => { throw new Error('leaked-prompt user@example.com'); })
    .addEdge(START, 'generator').addEdge('generator', 'boom').addEdge('boom', END)
    .compile();
try {
    for await (const _ of g.streamEvents({ q: '비밀질문 user@example.com' }, { version: 'v2', callbacks: [makeTracer(client)] })) { /* 소비 */ }
} catch { /* boom 노드 오류는 의도 */ }
await awaitAllCallbacks();
await client.awaitPendingTraceBatches();
const all = bodies.join("\n");
check(`전송이 일어났다 (본문 ${bodies.length}개, ${all.length}자)`, all.length > 0);
for (const s of SECRET) check(`전송 바이트에 "${s}" 없음`, !all.includes(s));
check('노드 이름은 남는다(관측 가치)', all.includes('generator'));
// 멀티파트 각 조각 — inputs·outputs 는 숨김 객체, error 는 이름만
const parts = [...all.matchAll(/name="post\.[^".]+\.(inputs|outputs|error|events)"\r?\n[^\r\n]*\r?\n\r?\n([^\r\n]*)/g)].map(m => [m[1], m[2]]);
const io = parts.filter(([k]) => k === 'inputs' || k === 'outputs');
check(`inputs·outputs 조각 ${io.length}개 전부 빈 객체(숨김)`, io.length > 0 && io.every(([, v]) => v === '{}' || v === '{"hidden":true}'), JSON.stringify(io.slice(0, 3)));
const errs = parts.filter(([k]) => k === 'error');
check(`오류 조각 ${errs.length}개 전부 이름만`, errs.length > 0 && errs.every(([, v]) => /^"[A-Za-z]*Error"$/.test(v)), JSON.stringify(errs));
check('events 조각 없음', !parts.some(([k]) => k === 'events'));
check('스트리밍 모델 run 도 정리됨(llm run 존재)', all.includes('"run_type":"llm"'));

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
