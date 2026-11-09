/**
 * 라우터 LLM: 현행 Gemini(유료 키) vs K-EXAONE — 같은 질의를 번갈아, 운영 프롬프트·규칙·후처리 그대로
 *
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-router-exaone.mts --set=domains2 [라운드=3]
 *   ... --dry                     # 호출 0회, 호출 수만
 *   PROBE_OUT=out.json ...        # 원자료(합성 질의·의도·지연) 저장 — 저장소 밖에 둔다
 *
 * routerNode 의 Gemini generateContent 를 fetch 에서 가로챈다(probe-router-gpt 와 같은 방식).
 * EXAONE 은 추론 끄기(chat_template_kwargs.enable_thinking=false) + json_schema(strict) — probe-exaone-options 에서
 * 이 조합만 JSON 만 내고 빨랐다(추론을 켜면 1.3~6초, 끄기만 하면 추론이 본문으로 샌다).
 * 무료 EXAONE 은 초당 1회 — 호출 사이 간격은 지연에 넣지 않는다.
 */
import fs from 'node:fs';
for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const SET = args.find(a => a.startsWith('--set='))?.slice(6) ?? 'domains2';
// EXAONE 요청 설정 — off-schema: 추론 끄기+json_schema(짧은 지시에선 0.7초였으나 운영 프롬프트에선 abort 다수) · low: reasoning_effort low · low-json: low+json_object · off-json: 추론 끄기+json_object
const CFG = args.find(a => a.startsWith('--cfg='))?.slice(6) ?? 'low';
const cases = await import('./router-cases.mts');
const SETS: Record<string, { q: string; want: string; alt?: string[] }[]> = {
    final: cases.ROUTER_FINAL, domains: cases.ROUTER_DOMAINS, domains2: cases.ROUTER_DOMAINS2, causes: cases.ROUTER_CAUSES, law: cases.ROUTER_LAW_BOUNDARY, wobble: cases.ROUTER_WOBBLE, golden: (await import('./router-golden.mts')).GOLDEN_V1, base: [...cases.MISROUTED, ...cases.MUST_KEEP],
    holdout3: cases.HOLDOUT3, fresh: cases.ROUTER_FRESH, org: cases.ROUTER_ORG_ACTIVITY, searchoff: cases.ROUTER_SEARCH_OFF_RULE, visual: cases.ROUTER_VISUAL_EXPLAIN, concepts: cases.ROUTER_PHYSICS_CONCEPTS,
};
const CASES = SETS[SET];
if (!CASES) { console.error(`세트 없음: ${SET} (${Object.keys(SETS).join('|')})`); process.exit(1); }
const N = CASES.length * ROUNDS;
console.log(`라우터 Gemini(유료) vs EXAONE(${CFG}) · 세트 ${SET} · 질의 ${CASES.length}종 × ${ROUNDS}라운드 = 각 ${N}회(규칙이 먼저 끝내는 질의는 호출 없음)`);
if (DRY) process.exit(0);

if (process.env.TIER1 !== '1' || !process.env.API_KEY_TIER1) { console.error('TIER1=1 과 API_KEY_TIER1 이 필요하다 — 무료 키는 429 → 규칙 폴백으로 측정이 오염된다'); process.exit(1); }
for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
process.env.API_KEY = process.env.API_KEY_TIER1;
const EXA_KEY = process.env.EXAONE_API_KEY;
if (!EXA_KEY) { console.error('EXAONE_API_KEY 없음'); process.exit(1); }

// 운영 라우터 출력 계약(router.ts 프롬프트) 그대로 — 열거값은 프롬프트의 목록
const INTENTS = ['drug_id', 'drug_info', 'medical_qa', 'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa',
    'paper_search', 'movie_search', 'weather', 'biology', 'chemistry', 'physics', 'astronomy', 'data_viz', 'general'];
const SCHEMA = {
    type: 'json_schema',
    json_schema: {
        name: 'route', strict: true,
        schema: {
            type: 'object', additionalProperties: false, required: ['intent', 'needs_search', 'follow_up', 'topic_field', 'paper_source'],
            properties: {
                intent: { type: 'string', enum: INTENTS }, needs_search: { type: 'boolean' },
                follow_up: { type: 'string', enum: ['refine', 'new', 'unrelated'] },
                topic_field: { type: 'string' }, paper_source: { type: 'string', enum: ['pubmed', 'arxiv', 'none'] },
            },
        },
    },
};

const CFG_BODY: Record<string, unknown> = ({
    'off-schema': { chat_template_kwargs: { enable_thinking: false }, response_format: SCHEMA, max_tokens: 256 },
    low: { reasoning_effort: 'low', max_tokens: 1024 },
    'low-json': { reasoning_effort: 'low', response_format: { type: 'json_object' }, max_tokens: 1024 },
    'off-json': { chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' }, max_tokens: 512 },
} as Record<string, Record<string, unknown>>)[CFG];
if (!CFG_BODY) { console.error(`cfg 없음: ${CFG} (off-schema|off-json|low|low-json)`); process.exit(1); }
type Provider = 'gemini' | 'exaone';
let MODE: Provider = 'gemini';
// 이번 routerNode 호출에서 모델이 실제로 낸 것 — 규칙·후처리 전
let last: { called: boolean; rawIntent?: string; apiMs?: number; inTok?: number; outTok?: number; err?: string; retries?: number; bad?: string } = { called: false };
let lastExaoneAt = 0;

const realFetch = globalThis.fetch;
const rawIntentOf = (text: string) => { try { return String(JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, '').trim()).intent ?? '?'); } catch { return 'BADJSON'; } };
globalThis.fetch = async (url: any, init?: any) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, init);
    if (!u.includes(':generateContent')) throw new Error(`Gemini 요청 차단: ${u.split('?')[0]}`);
    last.called = true;
    const t0 = performance.now();
    if (MODE === 'gemini') {
        const res = await realFetch(url, init);
        last.apiMs = Math.round(performance.now() - t0);
        const j: any = await res.clone().json().catch(() => null);
        if (!res.ok) { last.err = `gemini ${res.status}`; return res; }
        last.rawIntent = rawIntentOf(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '');
        last.inTok = j?.usageMetadata?.promptTokenCount; last.outTok = j?.usageMetadata?.candidatesTokenCount;
        return res;
    }
    const req = JSON.parse(init?.body ?? '{}');
    const system = req.systemInstruction?.parts?.map((p: any) => p.text).join('\n') ?? '';
    const user = (req.contents ?? []).flatMap((c: any) => c.parts ?? []).map((p: any) => p.text ?? '').join('\n');
    // 429 를 라우터에 그대로 넘기면 라우터가 Gemini 키를 한도 초과로 블랙리스트에 올려 이후 전부 규칙 폴백이 된다(첫 실행에서 실측).
    // 초당 1회 한도라 잠깐 기다려 다시 부르고, 기다린 시간은 지연에서 뺀다(마지막 시도만 잰다)
    let res!: Response; let t1 = t0; last.retries = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
        const wait = 1500 - (Date.now() - lastExaoneAt);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastExaoneAt = Date.now(); t1 = performance.now();
        res = await realFetch('https://api.exaone.ai/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${EXA_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'k-exaone_v2.5', messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                ...CFG_BODY, stream: false }),
            signal: AbortSignal.timeout(15_000),
        });
        if (res.status !== 429) break;
        last.retries++;
    }
    last.apiMs = Math.round(performance.now() - t1);
    const body: any = await res.json().catch(() => null);
    // 실패는 500 으로 — 429 를 넘기면 위처럼 Gemini 키가 블랙리스트에 오른다
    if (!res.ok) { last.err = `exaone ${res.status}`; return new Response(JSON.stringify({ error: { code: 500, message: 'exaone' } }), { status: 500 }); }
    const text = body?.choices?.[0]?.message?.content ?? '';
    last.rawIntent = rawIntentOf(text);
    if (last.rawIntent === 'BADJSON') last.bad = `${body?.choices?.[0]?.finish_reason}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`;
    last.inTok = body?.usage?.prompt_tokens; last.outTok = body?.usage?.completion_tokens;
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');

const isRight = (g: string | undefined, c: { want: string; alt?: string[] }) => !!g && (g === c.want || !!c.alt?.includes(g));
type Row = { q: string; want: string; alt?: string[]; provider: Provider; round: number; intent: string; rawIntent?: string; called: boolean; ms: number; apiMs?: number; inTok?: number; outTok?: number; err?: string; retries?: number; bad?: string };
const rows: Row[] = [];

const once = async (p: Provider, c: { q: string; want: string; alt?: string[] }, round: number) => {
    MODE = p;
    last = { called: false };
    const t0 = performance.now();
    let intent = 'ERR';
    try { intent = ((await routerNode({ messages: [new HumanMessage(c.q)] } as any)) as any).intent; } catch { /* ERR */ }
    const ms = Math.round(performance.now() - t0);
    rows.push({ q: c.q, want: c.want, alt: c.alt, provider: p, round, intent, ms, ...last });
};

for (let round = 0; round < ROUNDS; round++) {
    for (const [i, c] of CASES.entries()) {
        // 순서를 번갈아 — 먼저 부르는 쪽이 늘 유리/불리하지 않게
        const order: Provider[] = (round + i) % 2 === 0 ? ['gemini', 'exaone'] : ['exaone', 'gemini'];
        for (const p of order) await once(p, c, round);
    }
    process.stdout.write(`라운드 ${round + 1}/${ROUNDS} 끝\n`);
}

// 실패·차이 줄
for (const r of rows) if (r.bad) console.log(`  잘못된 JSON(${r.provider}) ${r.bad}`);
for (const r of rows) if (!isRight(r.intent, r)) console.log(`  ${r.provider.padEnd(6)} r${r.round + 1} ✗ 최종 ${r.intent.padEnd(15)} 모델 ${String(r.rawIntent ?? '-').padEnd(15)} ${String(r.apiMs ?? '-').padStart(5)}ms${r.err ? ` [${r.err}]` : ''}  "${r.q}" (기대 ${r.want})`);

const pct = (xs: number[], p: number) => { if (!xs.length) return '-'; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log('');
for (const p of ['gemini', 'exaone'] as Provider[]) {
    const rs = rows.filter(r => r.provider === p);
    const llm = rs.filter(r => r.called);
    const okFinal = rs.filter(r => isRight(r.intent, r)).length;
    const okRaw = llm.filter(r => isRight(r.rawIntent, r)).length;
    const api = llm.filter(r => !r.err).map(r => r.apiMs!);
    const sum = (k: 'inTok' | 'outTok') => llm.reduce((a, r) => a + (r[k] ?? 0), 0);
    console.log(`${p.padEnd(6)} 최종 정확도 ${okFinal}/${rs.length} (${(okFinal / rs.length * 100).toFixed(0)}%) · 모델 원래 의도 ${okRaw}/${llm.length} · LLM 호출 ${llm.length} · 오류 ${llm.filter(r => r.err).length} · 잘못된 JSON ${llm.filter(r => r.rawIntent === 'BADJSON').length} · 429 재시도 ${llm.reduce((a, r) => a + (r.retries ?? 0), 0)}`);
    console.log(`       API 지연 p50 ${pct(api, 0.5)}ms · p90 ${pct(api, 0.9)}ms · p95 ${pct(api, 0.95)}ms · 최대 ${api.length ? Math.max(...api) : '-'}ms | 라우터 전체(대기 포함) p50 ${pct(rs.map(r => r.ms), 0.5)}ms · 토큰 입력 ${sum('inTok')} · 출력 ${sum('outTok')}`);
}
// 같은 질의에서 둘의 최종 의도가 갈린 수
const key = (r: Row) => `${r.round}|${r.q}`;
const g = new Map(rows.filter(r => r.provider === 'gemini').map(r => [key(r), r.intent]));
const diff = rows.filter(r => r.provider === 'exaone' && g.get(key(r)) !== r.intent).length;
console.log(`\n최종 의도가 둘이 다른 경우 ${diff}/${N}`);
if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ at: new Date().toISOString(), set: SET, rows }, null, 2));
