/**
 * 라우터 변형 `reformat` 회귀 — `ROUTER_VARIANT=reformat npx tsx --conditions=react-server tests/manual/probe-router-reformat-regression.mts [라운드=2] [out.json]`
 * 계획: docs/plans/PLAN_RECENCY_SEARCH_261120.md §7
 *
 * 변형은 needs_search false 줄만 고친다. 그래서 보는 것:
 *   ① 골든셋 의도 정확도(동결 세트) ② 골든셋 needsSearch 가 현행과 달라진 문장 ③ SEARCH_GRAY 검색 판정
 *   ④ 직전 턴 검색 뒤 "새 사실" 후속 — 변형이 이 검색까지 끄면 안 된다
 * 팔은 프로세스마다 하나(변형 모듈이 import 시 env 를 읽는다). 현행·변형을 각각 돌리고 out.json 두 개를 비교한다.
 * 유료 호출 = (골든 + SEARCH_GRAY + 후속) × 라운드. 합성 문장만.
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
const { variantStats } = await import('./router-prompt-variant.mts');
const { runWithKeyTier } = await import('../../server/key-tier');
const { routerNode } = await import('../../server/agent/nodes/router');
const { HumanMessage, AIMessage } = await import('@langchain/core/messages');
const { GOLDEN_V1 } = await import('./router-golden.mts');
const { SEARCH_GRAY } = await import('./router-cases.mts');

const args = process.argv.slice(2);
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 2);
const OUT = args.find(a => a.endsWith('.json'));
const ARM = process.env.ROUTER_VARIANT || 'base';

// 직전 턴이 검색 답일 때 새 사실을 묻는 후속 — 검색 on 이어야 한다
const PREV_Q = '아이폰 18 출시 소식 알려줘', PREV_A = '애플은 아이폰 18 시리즈를 공개했습니다 [1][2]. 카메라와 칩 성능이 개선됐습니다 [3].';
const FOLLOWUPS = [
    { q: '그럼 가격은 얼마야?', want: true }, { q: '국내 출시일은 언제야?', want: true }, { q: '사전예약 혜택도 있어?', want: true },
    { q: 'How much does it cost?', want: true }, { q: 'When is it available in Korea?', want: true }, { q: '¿Cuánto cuesta?', want: true },
];

const quiet = async <T,>(f: () => Promise<T>) => { const o = console.log; console.log = () => {}; try { return await f(); } finally { console.log = o; } };
const call = (messages: any[]) => quiet(() => runWithKeyTier('paid-first', () => routerNode({ messages, activeCards: {} } as any))) as Promise<any>;

const rows: any[] = [];
for (let r = 0; r < ROUNDS; r++) {
    for (const c of GOLDEN_V1) {
        const out = await call([new HumanMessage(c.q)]);
        rows.push({ set: 'golden', id: c.id, q: c.q, r, intent: out?.intent, ok: out?.intent === c.want || (c.alt ?? []).includes(out?.intent), needsSearch: out?.needsSearch, from: out?.intentFrom });
    }
    for (const c of SEARCH_GRAY) {
        const out = await call([new HumanMessage(c.q)]);
        rows.push({ set: 'gray', q: c.q, r, needsSearch: out?.needsSearch, ok: out?.needsSearch === c.wantSearch, from: out?.intentFrom });
    }
    for (const c of FOLLOWUPS) {
        const out = await call([new HumanMessage(PREV_Q), new AIMessage(PREV_A), new HumanMessage(c.q)]);
        rows.push({ set: 'followup', q: c.q, r, needsSearch: out?.needsSearch, ok: out?.needsSearch === c.want, from: out?.intentFrom });
    }
    console.log(`라운드 ${r + 1}/${ROUNDS} 끝`);
}

const llm = rows.filter(x => x.from === 'router').length;
console.log(`\n팔 ${ARM} · 라운드 ${ROUNDS} · 호출 ${rows.length} · LLM 판정 ${llm} · 변형 적용 ${variantStats.calls}`);
for (const set of ['golden', 'gray', 'followup']) {
    const rs = rows.filter(x => x.set === set);
    console.log(`${set.padEnd(9)} ${rs.filter(x => x.ok).length}/${rs.length}`);
}
for (const x of rows.filter(x => !x.ok)) console.log(`  ✗ ${x.set} r${x.r} ${x.q}${x.intent ? ` → ${x.intent}` : ''}${x.set !== 'golden' ? ` needsSearch=${x.needsSearch}` : ''}`);
if (ARM !== 'base' && variantStats.calls === 0) { console.log('❌ 변형 미적용'); process.exitCode = 1; }
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ arm: ARM, rows }, null, 1));
