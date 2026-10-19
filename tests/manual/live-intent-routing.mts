/**
 * 의도 분류 정확도·지연 측정 — `TIER1=1 npx tsx tests/manual/live-intent-routing.mts [반복수]`
 *
 * 라우터 모델을 바꿀 때 **전후를 같은 자로 재기 위한** 하니스다. 모델은 `server/models.ts` 의
 * `ROUTER_MODEL` 을 그대로 쓴다 — 여기서 프롬프트를 다시 쓰지 않는다(tests/README ⓒ).
 *
 * 계기(2026-09-01): `강아지 사료 추천해줘` 가 `vet_search`, `변호사 비용 얼마나 들어?` 가
 * `law_search` 로 갔다. 규칙 분류기는 둘 다 `general` 로 정확히 판정한다 — 틀린 건 라우터 LLM 이다.
 * `temperature: 0` 이라 3/3 일관되게 틀렸다. 흔들림이 아니라 그 모델의 고정된 답이다.
 *
 * 주의: **지연을 함께 잰다.** 라우터는 매 턴 serial-blocking 이라 모델을 올리면 모든 응답이 그만큼
 * 늦어진다. 정확도만 보고 올리면 안 된다.
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
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
} else {
    console.log('⚠️ TIER1=1 없이 돈다 — 429 가 나면 규칙 폴백으로 떨어져 측정이 오염된다');
}

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { ROUTER_MODEL } = await import('../../server/models.js');
const { classifyIntentByRules } = await import('../../server/agent/intent-rules.js');
const { HumanMessage } = await import('@langchain/core/messages');

const RUNS = Number(process.argv[2] ?? 3);

const { MISROUTED, MUST_KEEP } = await import('./router-cases.mts');
type Case = (typeof MISROUTED)[number];

const latencies: number[] = [];
async function run(q: string): Promise<string> {
    const t0 = Date.now();
    try {
        const out: any = await routerNode({ messages: [new HumanMessage(q)] } as any);
        latencies.push(Date.now() - t0);
        return out.intent;
    } catch (e) { latencies.push(Date.now() - t0); return 'ERR'; }
}

console.log(`\n라우터 모델: ${ROUTER_MODEL} · 질의 ${MISROUTED.length + MUST_KEEP.length}종 × ${RUNS}회\n`);

let wrong = 0, total = 0;
const report = async (title: string, cases: Case[]) => {
    console.log(`── ${title} ──`);
    for (const c of cases) {
        const got: string[] = [];
        for (let i = 0; i < RUNS; i++) got.push(await run(c.q));
        total += RUNS;
        const bad = got.filter(g => g !== c.want).length;
        wrong += bad;
        const rule = classifyIntentByRules(c.q, false);
        console.log(`  ${bad === 0 ? '✅' : '🔴'} ${RUNS - bad}/${RUNS} "${c.q}" → ${[...new Set(got)].join(',')}` +
            `  (기대 ${c.want} · 규칙 ${rule}${c.note ? ` · ${c.note}` : ''})`);
    }
    console.log('');
};
await report('실측 오분류 — general 이어야 한다', MISROUTED);
await report('진짜 조회 — 막으면 회귀다', MUST_KEEP);

const sorted = [...latencies].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
console.log(`정확도 ${total - wrong}/${total} (${((total - wrong) / total * 100).toFixed(0)}%) · 오답 ${wrong}`);
console.log(`지연 중앙값 ${pct(0.5)}ms · p90 ${pct(0.9)}ms · 최대 ${sorted.at(-1)}ms  ← 매 턴 serial-blocking 이다`);
