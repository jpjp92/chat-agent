/**
 * Decisions 추가 검토 — 검색 필요 판정 · 프롬프트 인젝션 · 긴 입력 지연. 계획: PLAN_DECISION_ROUTER_261019 §14
 *
 *   npx tsx tests/manual/probe-decisions-extra.mts --dry
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-decisions-extra.mts --search [라운드=2]
 *   TIER1=1 ... --inject [라운드=2]
 *   TIER1=1 ... --latency [반복=3]
 *
 * --search : 규칙이 gray 를 내는 문장에서 검색 필요 판정을 비교한다. 운영과 같이 의도·검색을 한 번에 묻는다.
 *            Decisions 쪽 최종값 = 규칙 on/off 우선, gray 면 needs_search 확률 ≥ 0.5. 0.3~0.7 은 저확신(측정 전 고정).
 * --inject : 메시지 안에 분류 조작 지시를 넣은 문장. 의도는 실제 요청을 따라야 한다.
 * --latency: 질문 앞에 0 · 2,000 · 8,000자 본문을 붙여 두 쪽 지연을 잰다.
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
const MODE = args.includes('--search') ? 'search' : args.includes('--inject') ? 'inject' : args.includes('--latency') ? 'latency' : 'dry';
const N = Number(args.find(a => /^\d+$/.test(a)) ?? (MODE === 'latency' ? 3 : 2));

const { DECISIONS_MODEL, LOW_CONF, INTENT_QUESTIONS_V2, callDecisions, resolveIntent } = await import('./decisions-client.mts');
const { SEARCH_GRAY, INJECTION } = await import('./router-cases.mts');
const { classifySearchNeed } = await import('../../server/agent/intent-rules.js');

const NEEDS_SEARCH_Q = {
    type: 'predicate', name: 'needs_search',
    instructions: 'Answering the latest user message needs up-to-date web search: real-time or current information (news, prices, stocks, latest, today, now, recent events), a person\'s current status or role, rankings, company metrics, an explicit request to search or cite sources, or a specific named product, model, or version that may be recent. Timeless knowledge, well-established concepts, code, translation, writing, math, recipes, or general advice do not.',
};
const FILLER = '인공지능은 데이터에서 규칙을 학습해 예측하거나 생성하는 기술이다. 최근에는 대규모 언어 모델이 등장해 문서 요약, 번역, 코드 작성 같은 일을 사람처럼 처리한다. ';
const LENGTHS = [0, 2_000, 8_000];

if (MODE === 'dry') {
    console.log(`--search: ${SEARCH_GRAY.length}문장 × ${N}라운드 × 2팔 = ${SEARCH_GRAY.length * N * 2}회`);
    console.log(`--inject: ${INJECTION.length}문장 × ${N}라운드 × 2팔 = ${INJECTION.length * N * 2}회`);
    console.log(`--latency: 길이 ${LENGTHS.join('/')}자 × 반복 3 × 2팔 = ${LENGTHS.length * 3 * 2}회`);
    console.log('규칙 gray 확인:', SEARCH_GRAY.map(c => classifySearchNeed(c.q)).every(r => r === 'gray') ? '전부 gray' : '⚠ gray 아닌 문장 있음');
    process.exit(0);
}

const tier1 = process.env.API_KEY_TIER1;
if (process.env.TIER1 !== '1' || !tier1) { console.error('TIER1=1 과 API_KEY_TIER1 이 필요하다'); process.exit(1); }
for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
process.env.API_KEY = tier1;

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');

async function router(q: string) {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    const t0 = Date.now();
    let out: any;
    try { out = await routerNode({ messages: [new HumanMessage(q)] } as any); } catch { /* ERR */ } finally { console.log = orig; }
    return { intent: out?.intent ?? 'ERR', needsSearch: out?.needsSearch as boolean | undefined, ms: Date.now() - t0 };
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

if (MODE === 'search') {
    const rows: any[] = [];
    for (let round = 0; round < N; round++) for (const c of SEARCH_GRAY) {
        const cur = await router(c.q);
        const call = await callDecisions(c.q, [...INTENT_QUESTIONS_V2, NEEDS_SEARCH_Q]);
        const { intent, confidence } = resolveIntent(call);
        const ns = call.answers.needs_search as any;
        const p: number | null = ns && ns !== 'REFUSAL' ? (ns.probability ?? null) : null;
        const rule = classifySearchNeed(c.q);
        const decSearch = rule === 'on' ? true : rule === 'off' ? false : p === null ? true : p >= 0.5;
        const low = p === null || (p > 0.3 && p < 0.7);
        rows.push({ q: c.q, want: c.wantSearch, round, cur, dec: { intent, confidence, p, search: decSearch, ms: call.ms }, low });
        console.log(`  r${round + 1} ${cur.needsSearch === c.wantSearch ? '✓' : '✗'}현행 ${String(cur.needsSearch).padEnd(5)} ${cur.intent.padEnd(8)} │ ` +
            `${decSearch === c.wantSearch ? '✓' : '✗'}Dec ${String(decSearch).padEnd(5)} p=${p?.toFixed(2) ?? '-'} ${intent}${low ? ' (저확신)' : ''}  "${c.q}"`);
    }
    const acc = (f: (r: any) => boolean) => rows.filter(r => f(r) === r.want).length;
    console.log(`\n검색 판정 정확도 — 현행 ${acc(r => r.cur.needsSearch)}/${rows.length} · Decisions ${acc(r => r.dec.search)}/${rows.length} · 하이브리드(저확신이면 현행) ${acc(r => (r.low ? r.cur.needsSearch : r.dec.search))}/${rows.length} · 저확신 ${rows.filter(r => r.low).length}`);
    console.log(`intent general 유지 — 현행 ${rows.filter(r => r.cur.intent === 'general').length}/${rows.length} · Decisions ${rows.filter(r => r.dec.intent === 'general').length}/${rows.length}`);
    if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ mode: MODE, rows }, null, 2));
}

if (MODE === 'inject') {
    const rows: any[] = [];
    for (let round = 0; round < N; round++) for (const c of INJECTION) {
        const cur = await router(c.q);
        const call = await callDecisions(c.q, INTENT_QUESTIONS_V2);
        const d = resolveIntent(call);
        rows.push({ q: c.q, want: c.want, cur: cur.intent, dec: d.intent, conf: d.confidence });
        console.log(`  r${round + 1} ${cur.intent === c.want ? '✓' : '✗'}현행 ${cur.intent.padEnd(14)} │ ${d.intent === c.want ? '✓' : '✗'}Dec ${d.intent.padEnd(14)} conf ${d.confidence?.toFixed(2) ?? '-'}  "${c.q}"`);
    }
    const hy = rows.filter(r => ((r.conf ?? 0) >= LOW_CONF ? r.dec : r.cur) === r.want).length;
    console.log(`\n인젝션 — 현행 ${rows.filter(r => r.cur === r.want).length}/${rows.length} · Decisions ${rows.filter(r => r.dec === r.want).length}/${rows.length} · 하이브리드 ${hy}/${rows.length}`);
    if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ mode: MODE, rows }, null, 2));
}

if (MODE === 'latency') {
    const q = '위 글을 세 줄로 요약해줘';
    for (const len of LENGTHS) {
        const text = (len ? FILLER.repeat(Math.ceil(len / FILLER.length)).slice(0, len) + '\n\n' : '') + q;
        const cur: number[] = [], dec: number[] = [], got: string[] = [];
        for (let i = 0; i < N; i++) {
            const r = await router(text); cur.push(r.ms);
            const call = await callDecisions(text, INTENT_QUESTIONS_V2); dec.push(call.ms); got.push(resolveIntent(call).intent);
        }
        console.log(`  ${String(len).padStart(5)}자 — 현행 p50 ${pct(cur, 0.5)}ms (최대 ${Math.max(...cur)}) · Decisions p50 ${pct(dec, 0.5)}ms (최대 ${Math.max(...dec)}) · Dec 의도 ${[...new Set(got)].join(',')}`);
    }
}
console.log(`\n(Decisions ${DECISIONS_MODEL} · 문구 v2)`);
