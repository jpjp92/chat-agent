/**
 * 추적 오버헤드 — `npx tsx tests/manual/bench-tracing-overhead.mts [반복]`
 * 계획: docs/plans/PLAN_LANGSMITH_TRACING_261107.md §3
 *
 * 실제 턴과 비슷한 그래프(router → generator, 노드마다 SDK 호출 1회 = traceGemini)를 가짜 모델·가짜 전송으로 돌려
 * 추적 끔 / 숨김 / 원문 모드의 **응답 경로 시간**을 비교한다. 모델 지연을 빼고 추적이 더하는 시간만 본다.
 * 원문 모드 입력은 실제 프롬프트 크기(약 6천 토큰 ≈ 2만 자)로 맞춘다. 네트워크·키·비용 없음.
 */
import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';
import { traceGemini, traceCallbacks } from '../../server/agent/tracing.js';
// 실제 크기 — 라우터 지시 약 1.4만 자, 답변 지시 약 3만 자, 이전 대화 3턴(원문 모드는 이걸 Input 으로 기록한다)
const ROUTER_SYS = 'r'.repeat(14_000);
const GEN_SYS = '지시 '.repeat(10_000);
const HISTORY = (q: string) => [{ role: 'user', parts: [{ text: '이전 질문' }] }, { role: 'model', parts: [{ text: '이전 답 '.repeat(400) }] }, { role: 'user', parts: [{ text: q }] }];

const N = Number(process.argv[2] || 200);
const PROMPT = '합성 프롬프트 '.repeat(2500); // ≈ 2만 자
const resp = { candidates: [{ content: { parts: [{ text: '합성 답변 '.repeat(300) }] }, groundingMetadata: { groundingChunks: [{}, {}, {}] } }],
    usageMetadata: { promptTokenCount: 5944, candidatesTokenCount: 500, totalTokenCount: 6444 } };
const models = { generateContent: async (_p: unknown) => resp };
const fakeFetch = (async (_u: unknown, i?: { body?: unknown }) => {
    if (i?.body instanceof ReadableStream) await new Response(i.body).arrayBuffer(); // 본문을 실제로 소비(직렬화 비용 포함)
    return new Response('{}', { status: 200 });
}) as unknown as typeof fetch;

// intent·attachments 는 원문 모드 턴 판정용 — general 이라 보류 후 원문으로 해제되는 경로를 잰다
const S = Annotation.Root({ q: Annotation<string>(), intent: Annotation<string>(), attachments: Annotation<unknown[]>() });
const graph = new StateGraph(S)
    .addNode('router', async (s) => { await traceGemini('router', models, { model: 'gemini-2.5-flash', contents: s.q, config: { systemInstruction: ROUTER_SYS } } as never); return { intent: 'general' }; })
    .addNode('generator', async (s) => { await traceGemini('single', models, { model: 'gemini-3.8-flash', contents: HISTORY(s.q), config: { systemInstruction: GEN_SYS, tools: [{ googleSearch: {} }] } } as never); return {}; })
    .addEdge(START, 'router').addEdge('router', 'generator').addEdge('generator', END).compile();

const run = async (label: string, env: Record<string, string | undefined>) => {
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    const cbs = traceCallbacks();
    const c = (cbs[0] as unknown as { client?: { fetchImplementation: typeof fetch; awaitPendingTraceBatches: () => Promise<void> } })?.client;
    if (c) c.fetchImplementation = fakeFetch;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        for await (const _ of graph.streamEvents({ q: PROMPT }, { version: 'v2', callbacks: cbs })) { /* 소비 */ }
        times.push(performance.now() - t0); // 응답 경로 = 스트림 종료까지
    }
    const t1 = performance.now();
    await awaitAllCallbacks(); await c?.awaitPendingTraceBatches(); // after() 에서 하는 일 — 응답 뒤
    const flush = performance.now() - t1;
    times.sort((a, b) => a - b);
    const p = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(2);
    console.log(`${label.padEnd(8)} 턴당 중앙값 ${p(0.5)}ms · p95 ${p(0.95)}ms · (응답 뒤 전송 마무리 ${flush.toFixed(0)}ms / ${N}턴)`);
    return Number(p(0.5));
};

const off = await run('끔', { CHAT_TRACING: 'false' });
const hid = await run('숨김', { CHAT_TRACING: 'true', LANGSMITH_API_KEY: 'bench', CHAT_TRACING_RAW: 'false', VERCEL: undefined });
const raw = await run('원문', { CHAT_TRACING: 'true', LANGSMITH_API_KEY: 'bench', CHAT_TRACING_RAW: 'true', VERCEL: undefined });
console.log(`\n추적이 더하는 시간(중앙값): 숨김 +${(hid - off).toFixed(2)}ms · 원문 +${(raw - off).toFixed(2)}ms — 실제 턴(수 초) 대비`);
