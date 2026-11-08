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
import { createSanitizingClient, makeTracer, sanitizeRun, usageOf, traceGemini, rawMode, rawAllowedForTurn, scrubRaw, redactText, errorName, tracingEnabled, traceCallbacks } from '../server/agent/tracing.js';

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

// ④ L2 — SDK 직접 호출 span
check('Gemini usageMetadata → 토큰', JSON.stringify(usageOf({ usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, totalTokenCount: 15 } })) === '{"input_tokens":11,"output_tokens":4,"total_tokens":15}');
check('OpenAI usage → 토큰', JSON.stringify(usageOf({ usage: { input_tokens: 9, output_tokens: 3 } })) === '{"input_tokens":9,"output_tokens":3,"total_tokens":12}');
const gr = sanitizeRun({ id: '3', outputs: { candidates: [{ content: { parts: [{ text: '답' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'kosis.kr', uri: 'https://secret.example/r' } }, {}] } }] } });
check('한 겹 감싼 출력에서도 출처 개수', JSON.stringify(sanitizeRun({ id: '4', outputs: { outputs: { candidates: [{ groundingMetadata: { groundingChunks: [{}, {}, {}] } }] } } })).includes('"grounding_sources":3'));
check('grounding 출처는 개수만', JSON.stringify(gr).includes('"grounding_sources":2') && !JSON.stringify(gr).includes('kosis') && !JSON.stringify(gr).includes('secret'));

// 꺼져 있으면 traceable 을 거치지 않고 원본 그대로
{
    const saved2 = { ...process.env };
    process.env.CHAT_TRACING = 'false';
    const res = { tag: 'same' };
    let calls = 0, thisOk = false;
    const models = { generateContent(this: unknown, _p: { model: string }) { calls++; thisOk = this === models; return Promise.resolve(res); } };
    const got = await traceGemini('single', models, { model: 'gemini-3.8-flash' });
    check('꺼짐: 반환값이 원본 객체·호출 1회·this 유지', got === res && calls === 1 && thisOk);
    process.env = saved2;
}

// 켜져 있으면 노드의 자식 llm run — 모델·호출 종류·검색·토큰·출처 개수, 원문 없음
{
    const saved3 = { ...process.env };
    process.env.CHAT_TRACING = 'true'; process.env.LANGSMITH_API_KEY = 'test';
    const b2: string[] = [];
    const f2 = (async (_u: unknown, i?: { body?: unknown }) => { const b = i?.body; if (b instanceof ReadableStream) b2.push(await new Response(b).text()); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    // llmSpan 은 모듈 Client 를 쓴다 — traceCallbacks 로 그 Client 를 만들고 전송만 가짜로 바꾼다
    const tracers = (await import('../server/agent/tracing.js')).traceCallbacks();
    const modClient = (tracers[0] as unknown as { client: unknown }).client;
    (modClient as unknown as { fetchImplementation: typeof fetch }).fetchImplementation = f2;
    const resp = { candidates: [{ content: { parts: [{ text: '비밀답변' }] }, groundingMetadata: { groundingChunks: [{}, {}, {}] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, totalTokenCount: 25 } };
    const models = { generateContent: async (_p: unknown) => resp };
    const S2 = Annotation.Root({ q: Annotation<string>() });
    const g2 = new StateGraph(S2).addNode('generator', async () => {
        const out = await traceGemini('single', models, { model: 'gemini-3.8-flash', contents: '비밀질문', config: { tools: [{ googleSearch: {} }] } } as any, 1);
        check('켜짐: 반환값이 원본 객체', out === resp);
        return {};
    }).addEdge(START, 'generator').addEdge('generator', END).compile();
    for await (const _ of g2.streamEvents({ q: 'x' }, { version: 'v2', callbacks: tracers })) { /* 소비 */ }
    await awaitAllCallbacks();
    await (modClient as unknown as { awaitPendingTraceBatches: () => Promise<void> }).awaitPendingTraceBatches();
    const all2 = b2.join('\n');
    const runs = [...all2.matchAll(/name="post\.([0-9a-f-]{36})"\r?\n[^\r\n]*\r?\n\r?\n([^\r\n]*)/g)].map(m => ({ id: m[1], ...JSON.parse(m[2]) }));
    const gen = runs.find(r => r.name === 'generator'), llm = runs.find(r => r.name === 'gemini.single');
    check('gemini.single 이 generator 의 자식', !!gen && !!llm && llm.parent_run_id === gen.id, JSON.stringify(runs.map(r => r.name)));
    const meta = [...all2.matchAll(/name="post\.[^".]+\.extra"\r?\n[^\r\n]*\r?\n\r?\n([^\r\n]*)/g)].map(m => m[1]).find(x => x.includes('"call":"single"')) ?? '';
    check('메타데이터: 모델·호출·검색·시도', /"ls_model_name":"gemini-3\.8-flash"/.test(meta) && /"search":true/.test(meta) && /"attempt":1/.test(meta), meta);
    check('메타데이터: 토큰·출처 개수', meta.includes('"usage_metadata":{"input_tokens":20,"output_tokens":5,"total_tokens":25}') && meta.includes('"grounding_sources":3'), meta);
    check('L2 전송에 원문 없음', !/비밀/.test(all2));
    process.env = saved3;
}

// ⑤ 원문 모드 — 로컬 전용·base64 길이만·긴 문자열 앞부분만
{
    const saved4 = { ...process.env };
    process.env.CHAT_TRACING_RAW = 'true'; delete process.env.VERCEL;
    check('원문 모드: 로컬이면 켜짐', rawMode());
    process.env.VERCEL = '1'; process.env.VERCEL_ENV = 'production'; process.env.VERCEL_GIT_COMMIT_REF = 'dev';
    check('원문 모드: 배포는 허용 스위치 없으면 무시', !rawMode());
    process.env.CHAT_TRACING_RAW_ALLOW_DEPLOYED = 'true';
    check('원문 모드: 배포 dev 브랜치 + 허용 스위치면 켜짐(production 환경이어도)', rawMode());
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    check('원문 모드: main 브랜치는 허용 스위치가 있어도 무시', !rawMode());
    delete process.env.VERCEL_GIT_COMMIT_REF;
    check('원문 모드: 브랜치를 모르면 무시', !rawMode());
    process.env = saved4;
    const b64 = 'A'.repeat(5000);
    const sc = JSON.stringify(scrubRaw({ img: `data:image/png;base64,${b64}`, raw: b64, long: '가'.repeat(65000), bin: new Uint8Array(10), q: '합성 질문' }));
    check('scrubRaw: data URI·긴 base64 → 길이만', sc.includes('[base64 ') && !sc.includes('A'.repeat(100)), sc.slice(0, 200));
    check('scrubRaw: 긴 문자열은 앞부분 + 남은 길이', sc.includes('…[+5000 chars]'));
    check('scrubRaw: 바이너리 → 바이트 수', sc.includes('[binary 10 bytes]'));
    check('scrubRaw: 일반 문자열은 그대로', sc.includes('합성 질문'));
    const shared = { text: '공유된 내용' };
    const cyc: Record<string, unknown> = { a: 1 }; cyc.self = cyc;
    const sh = JSON.stringify(scrubRaw({ content: shared, lc_kwargs: { content: shared }, sessionId: 'sess-123', cyc }));
    check('scrubRaw: 같은 객체 두 번 참조는 둘 다 원문(순환 아님)', (sh.match(/공유된 내용/g) || []).length === 2, sh);
    check('scrubRaw: 진짜 순환만 [circular]', sh.includes('"self":"[circular]"'));
    check('scrubRaw: sessionId 등 식별자 가림', !sh.includes('sess-123') && sh.includes('"sessionId":"[id]"'));
    const red = redactText('메일 user.name@example.co.kr 전화 010-1234-5678 +82 10 9876 5432 카드 1234-5678-9012-3456 주민 900101-1234567 키 sk-abcdefghijklmnopqrstuv AIzaSyA1234567890abcdefghijklmnopqrstu Bearer abcdefghijklmnop.qrs jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 그래프 y=x² 2025.11 1,404.3원');
    check('redactText: 이메일·전화·카드·주민번호·키·토큰·JWT 가림', !/example|1234-5678|9876|9012|1234567|abcdefghij|AIzaSy|eyJ/.test(red), red);
    check('redactText: 일반 숫자·수식은 그대로', red.includes('y=x²') && red.includes('2025.11') && red.includes('1,404.3원'), red);
    const gr = JSON.stringify(scrubRaw({ candidates: [{ content: { parts: [{ text: '답', thoughtSignature: 'SIG'.repeat(50) }] }, groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQabc_def-123', title: 'yna.co.kr' } }],
        searchEntryPoint: { renderedContent: '<style>.chip{}</style>' }, webSearchQueries: ['주요 뉴스'] } }], sdkHttpResponse: { headers: { 'x-h': 'v' } } }));
    check('scrubRaw: 검색 칩·HTTP 헤더·서명 제거', !/renderedContent|sdkHttpResponse|thoughtSignature|SIGSIG/.test(gr), gr);
    check('scrubRaw: 리다이렉트 주소 → [redirect], 도메인·검색어 유지', !gr.includes('AUZIYQ') && gr.includes('"uri":"[redirect]"') && gr.includes('yna.co.kr') && gr.includes('주요 뉴스'), gr);
    check('Gemini 캐시 토큰 → input_token_details.cache_read', JSON.stringify(usageOf({ usageMetadata: { promptTokenCount: 6021, candidatesTokenCount: 785, totalTokenCount: 6806, cachedContentTokenCount: 1094 } })) === '{"input_tokens":6021,"output_tokens":785,"total_tokens":6806,"input_token_details":{"cache_read":1094}}');
    check('OpenAI 캐시 토큰 → cache_read', JSON.stringify(usageOf({ usage: { input_tokens: 4907, output_tokens: 19, total_tokens: 4926, input_tokens_details: { cached_tokens: 4775 } } })) === '{"input_tokens":4907,"output_tokens":19,"total_tokens":4926,"input_token_details":{"cache_read":4775}}');
    const echo = JSON.stringify(sanitizeRun({ id: '9', inputs: { instructions: '시스템지시원문', tools: [{ name: 't' }] }, outputs: { outputs: { instructions: '시스템지시원문', tools: [{ name: 't' }], output: [{ type: 'function_call' }] } } }, true));
    check('원문 출력: OpenAI instructions·tools 되돌림 제거, 입력은 유지', (echo.match(/시스템지시원문/g) || []).length === 1 && echo.includes('function_call'), echo);
    check('scrubRaw 가 문자열 안 민감정보도 가림', JSON.stringify(scrubRaw({ q: '연락처 010-2222-3333' })).includes('[phone]'));
    const rr = sanitizeRun({ id: '5', inputs: { q: '합성 질문' }, outputs: { a: '합성 답' }, error: 'ApiError: 상세 사유', events: [{ x: 1 }] }, true);
    const rjs = JSON.stringify(rr);
    check('원문 모드 정리: 입출력·오류 원문 유지', rjs.includes('합성 질문') && rjs.includes('합성 답') && rjs.includes('상세 사유'));
    check('원문 모드 정리: events 는 여전히 제거(출력과 중복)', !('events' in rr));
    const rc = createSanitizingClient({ apiKey: 'test', apiUrl: 'http://localhost:1' }, true);
    check('원문 모드 Client 는 별도 프로젝트', (makeTracer(rc) as unknown as { projectName: string }).projectName === (process.env.LANGSMITH_PROJECT_RAW || 'chat-agent-dev-raw'));
    check('숨김 Client 는 기본 프로젝트', (makeTracer(createSanitizingClient({ apiKey: 'test', apiUrl: 'http://localhost:1' })) as unknown as { projectName: string }).projectName !== 'chat-agent-dev-raw');
}

// ⑥ 원문 모드 턴 단위 판정 — 민감 의도·첨부는 숨김, 루트가 끝날 때까지 보류
{
    check('턴 판정: 일반 의도는 원문', rawAllowedForTurn({ outputs: { intent: 'general', attachments: [] } }));
    for (const it of ['medical_qa', 'drug_info', 'drug_id', 'hospital_search', 'pharmacy_search', 'law_qa', 'law_search', 'vet_search', 'new_future_intent'])
        check(`턴 판정: ${it} 는 숨김`, !rawAllowedForTurn({ outputs: { intent: it } }));
    check('턴 판정: 첨부 있으면 숨김', !rawAllowedForTurn({ outputs: { intent: 'general', attachments: [{ x: 1 }] } }));
    check('턴 판정: 의도 모르면 숨김', !rawAllowedForTurn({ outputs: {} }));
    const red2 = redactText('사무실 02-123-4567 · 031)987-6543 · 서울 세종대로 110 · 역삼동 123-45번지 · 101동 1203호 · 경로 2개 · 3번길 아님 · 2025.11');
    check('redactText: 일반 전화·주소 가림', !/123-4567|987-6543|세종대로 110|123-45번지|1203호/.test(red2), red2);
    check('redactText: "경로 2개"·연월은 그대로', red2.includes('경로 2개') && red2.includes('2025.11'), red2);

    const runTurn = async (intent: string) => {
        const sent: string[] = [];
        const f = (async (_u: unknown, i?: { body?: unknown }) => { const b = i?.body; if (b instanceof ReadableStream) sent.push(await new Response(b).text()); else if (typeof b === 'string') sent.push(b); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
        const c = createSanitizingClient({ apiKey: 'test', apiUrl: 'http://localhost:1', fetchImplementation: f }, true);
        const root = '00000000-0000-4000-8000-000000000001', child = '00000000-0000-4000-8000-000000000002';
        const t0 = Date.now();
        await c.createRun({ id: root, trace_id: root, name: 'LangGraph', run_type: 'chain', inputs: { q: '합성원문질문' }, start_time: t0, dotted_order: `${t0}Z${root}` } as never);
        await c.createRun({ id: child, trace_id: root, parent_run_id: root, name: 'gemini.single', run_type: 'llm', inputs: { contents: '합성원문프롬프트' }, start_time: t0, dotted_order: `${t0}Z${root}.${t0}Z${child}` } as never);
        const beforeEnd = sent.join('').includes('합성원문');
        await c.updateRun(child, { trace_id: root, parent_run_id: root, outputs: { text: '합성원문답' }, end_time: t0 + 1, dotted_order: `${t0}Z${root}.${t0}Z${child}` } as never);
        await c.updateRun(root, { trace_id: root, outputs: { intent, attachments: [], a: '합성원문답' }, end_time: t0 + 2, dotted_order: `${t0}Z${root}` } as never);
        await c.awaitPendingTraceBatches();
        return { beforeEnd, all: sent.join('\n') };
    };
    const hist = JSON.stringify(scrubRaw({
        messages: [{ type: 'human', content: '앞턴건강질문' }, { type: 'ai', content: '앞턴건강답' }, { type: 'human', content: '이번질문' }, { type: 'ai', content: '이번답' }],
        contents: [{ role: 'user', parts: [{ text: '앞턴건강질문' }] }, { role: 'model', parts: [{ text: '앞턴건강답' }] }, { role: 'user', parts: [{ text: '이번질문' }] }],
        lastTurnSourceLabels: ['당뇨 치료 가이드', 'x'], url: 'https://abc.supabase.co/storage/v1/object/sign/chat/u1/a.png?token=zz' }));
    check('대화 내역: 앞 턴은 생략, 이번 질문·답만', !hist.includes('앞턴건강') && hist.includes('이번질문') && hist.includes('이번답') && hist.includes('[이전 대화 2개 생략]'), hist);
    check('앞 턴 출처 제목은 개수만', !hist.includes('당뇨') && hist.includes('"lastTurnSourceLabels":"[2개]"'), hist);
    const prev = JSON.stringify(scrubRaw({ instructions: 'retrieved in this conversation** (sources: Headaches - NHS · 편두통 (migraine) 안내). It is NOT your training data', r: { encrypted_content: 'gAAAAB' + 'x'.repeat(50) } }));
    check('시스템 지시 속 앞 턴 출처 제목 → 개수', !prev.includes('Headaches') && !prev.includes('migraine') && prev.includes('(sources: [2개]). It is NOT'), prev);
    check('OpenAI 추론 블롭 제거', !prev.includes('gAAAAB'), prev);
    const lcMsg = { lc_serializable: true, lc_namespace: ['langchain_core', 'messages'], type: 'ai', id: '13725f57-df18-42f1-96f5-d30516799e0c',
        content: '답원문', lc_kwargs: { content: '답원문', id: '13725f57-df18-42f1-96f5-d30516799e0c' }, additional_kwargs: {}, response_metadata: {},
        tool_calls: [{ name: 'weatherTool', args: { q: '010-1111-2222' }, id: 'call_1' }], invalid_tool_calls: [] };
    const toolMsg = { lc: 1, type: 'constructor', id: ['langchain_core', 'messages', 'ToolMessage'], kwargs: { content: '도구결과', tool_call_id: 'call_1', name: 'weatherTool', id: 'u-2' } };
    const norm = JSON.stringify(scrubRaw({ messages: [{ type: 'human', content: 'q', lc_serializable: true, lc_namespace: ['x'], lc_kwargs: { content: 'q' } }, lcMsg, toolMsg] }));
    check('LangChain 메시지 정규화: UUID·lc_* 제거, 원문 1번', !norm.includes('13725f57') && !norm.includes('lc_kwargs') && !norm.includes('lc_namespace') && (norm.match(/답원문/g) || []).length === 1, norm);
    check('정규화: tool_calls 유지·인자 마스킹, ToolMessage 관계 유지', norm.includes('"name":"weatherTool"') && norm.includes('[phone]') && norm.includes('"tool_call_id":"call_1"') && norm.includes('"type":"tool"'), norm);
    const q = JSON.stringify(scrubRaw({ u: 'https://example.com/article?id=123&utm_source=x 와 https://a.com/p?token=secret#f', md: '[1](https://apnews.com/a/b?utm_source=openai)', ask: '이거 맞아? 진짜?', redir: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ?x=1' }));
    check('URL 쿼리 제거: URL 만, 질문의 ? 는 그대로', q.includes('https://example.com/article 와 https://a.com/p"') && !q.includes('secret') && q.includes('(https://apnews.com/a/b)') && q.includes('이거 맞아? 진짜?') && q.includes('[redirect]'), q);
    const nouser = JSON.stringify(scrubRaw({ input: [{ role: 'assistant', content: '앞턴원문' }, { type: 'function_call_output', output: 'x' }], contents: ['단순 문자열'] }));
    check('사용자 메시지 없는 대화 배열은 통째 생략(fail-closed), 대화 아닌 배열은 그대로', !nouser.includes('앞턴원문') && nouser.includes('[대화 2개 생략]') && nouser.includes('단순 문자열'), nouser);
    check('Storage 서명 URL 가림', !hist.includes('token=zz') && hist.includes('[storage-url]'), hist);
    const g = await runTurn('general');
    check('보류: 루트가 끝나기 전엔 아무것도 안 보냄', !g.beforeEnd);
    check('일반 턴: 질문·모델 입력·답 원문 전송', g.all.includes('합성원문질문') && g.all.includes('합성원문프롬프트') && g.all.includes('합성원문답'), g.all.slice(0, 300));
    const m = await runTurn('medical_qa');
    check('민감 턴: 루트·자식 모두 원문 없음', m.all.length > 0 && !m.all.includes('합성원문'), m.all.slice(0, 300));
}

// ⑦ LangSmith 한도 초과(429)·장애 — 응답은 정상, 전송 마무리는 상한 안에서 끝난다
{
    const saved7 = { ...process.env };
    process.env.CHAT_TRACING = 'true'; process.env.LANGSMITH_API_KEY = 'test'; delete process.env.CHAT_TRACING_RAW;
    const mod = await import('../server/agent/tracing.js');
    const tr = mod.traceCallbacks();
    (tr[0] as unknown as { client: { fetchImplementation: typeof fetch } }).client.fetchImplementation =
        (async () => new Response('{"detail":"Monthly trace limit exceeded"}', { status: 429 })) as unknown as typeof fetch;
    const S7 = Annotation.Root({ q: Annotation<string>(), a: Annotation<string>() });
    const g7 = new StateGraph(S7).addNode('gen', async () => ({ a: '정상답' })).addEdge(START, 'gen').addEdge('gen', END).compile();
    let ans = '';
    for await (const ev of g7.streamEvents({ q: 'x' }, { version: 'v2', callbacks: tr })) if (ev.event === 'on_chain_end' && ev.name === 'LangGraph') ans = (ev.data as { output?: { a?: string } }).output?.a ?? '';
    const origWrite = process.stdout.write.bind(process.stdout); const lines: string[] = [];
    process.stdout.write = ((c: string | Uint8Array) => { lines.push(String(c)); return true; }) as typeof process.stdout.write;
    const t0 = Date.now(); let threw = false;
    try { await mod.flushTraces(300); } catch { threw = true; } finally { process.stdout.write = origWrite; }
    const ms = Date.now() - t0;
    check('429: 그래프 응답은 정상', ans === '정상답');
    check('429: flushTraces 는 던지지 않고 상한 안에 끝난다', !threw && ms < 2000, `${ms}ms`);
    check('429: 상한 초과는 [trace] flush timeout 한 줄', lines.some(l => l.includes('"flush":"timeout"')), lines.join('').slice(0, 200));
    process.env = saved7;
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
