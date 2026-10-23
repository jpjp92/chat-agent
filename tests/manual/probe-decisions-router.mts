/**
 * 라우터 의도 분류 — 현행(Gemini 라우터) vs OpenAI Decisions API 비교 프로브.
 * 계획: docs/plans/PLAN_DECISION_ROUTER_261019.md
 *
 *   npx tsx tests/manual/probe-decisions-router.mts --dry      # 호출 0회 — 요청 본문과 호출 계획만
 *   ... --set=holdout|holdout2|holdout3|fresh|final|domains|domains2|causes|law|wobble|golden|pet|bio                                # 검증용 세트(router-cases.mts)
 *   ... --q=v2                                                 # 개선 문구(decisions-client INTENT_QUESTIONS_V2)
 *   ... --decisions-only                                       # 현행 라우터를 부르지 않는다(문구 비교·회귀용)
 *   ... --router-only                                          # Decisions 를 부르지 않는다(현행 라우터 검증용)
 *   npx tsx tests/manual/probe-decisions-router.mts --one      # Decisions 1회 — 응답 형식 확인용
 *   TIER1=1 npx tsx tests/manual/probe-decisions-router.mts [라운드=3]
 *   PROBE_OUT=out.json ...                                     # 원자료 저장
 *
 * 현행 쪽은 `routerNode` 를 그대로 부른다(규칙·후처리 포함, 사용자가 실제로 겪는 지연).
 * Decisions 쪽은 분류 질문만 보낸다 — 이 프로브가 재는 것은 "분류기 교체 후보로서의 정확도·지연"이다.
 * 질의 세트는 live-intent-routing 과 공용(router-cases.mts).
 *
 * 순서 편향을 줄이려고 라운드마다 두 팔의 호출 순서를 바꾼다.
 * 키: Gemini 는 TIER1=1 이면 API_KEY_TIER1, OpenAI 는 OPENAI_API_KEY_TIER1(채팅 경로와 같은 env).
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

// ROUTER_VARIANT 가 있으면 라우터 프롬프트 변형(라우터 import 전에 fetch 를 감싼다)
const { variantStats } = await import('./router-prompt-variant.mts');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const DEC_ONLY = args.includes('--decisions-only');
const ONE = args.includes('--one');
const ROUTER_ONLY = args.includes('--router-only');
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const { DECISIONS_MODEL, LOW_CONF, INTENT_QUESTIONS, INTENT_QUESTIONS_V2, callDecisions: rawCall, resolveIntent } = await import('./decisions-client.mts');
const QV = args.find(a => a.startsWith('--q='))?.slice(4) ?? 'v1';
const questions = QV === 'v2' ? INTENT_QUESTIONS_V2 : INTENT_QUESTIONS;

const { MISROUTED, MUST_KEEP, HOLDOUT, HOLDOUT2, HOLDOUT3, ROUTER_FRESH, ROUTER_FINAL, ROUTER_DOMAINS, ROUTER_DOMAINS2, ROUTER_CAUSES, ROUTER_LAW_BOUNDARY, ROUTER_WOBBLE, ROUTER_PET, ROUTER_BIO_EXPLAIN } = await import('./router-cases.mts');
const SET = args.find(a => a.startsWith('--set='))?.slice(6) ?? 'base';
const { GOLDEN_V1 } = await import('./router-golden.mts');
const CASES = SET === 'holdout' ? HOLDOUT : SET === 'holdout2' ? HOLDOUT2 : SET === 'holdout3' ? HOLDOUT3 : SET === 'fresh' ? ROUTER_FRESH : SET === 'final' ? ROUTER_FINAL : SET === 'domains' ? ROUTER_DOMAINS : SET === 'domains2' ? ROUTER_DOMAINS2 : SET === 'causes' ? ROUTER_CAUSES : SET === 'law' ? ROUTER_LAW_BOUNDARY : SET === 'wobble' ? ROUTER_WOBBLE : SET === 'golden' ? GOLDEN_V1 : SET === 'pet' ? ROUTER_PET : SET === 'bio' ? ROUTER_BIO_EXPLAIN : [...MISROUTED, ...MUST_KEEP];

// 라벨이 애매한 문장은 alt 도 정답으로 센다(router-cases.mts RouterCase.alt)
const isRight = (g: string, c: { want: string; alt?: string[] }) => g === c.want || !!c.alt?.includes(g);

type DecisionResult = { intent: string; confidence: number | null; ms: number; status: number; raw?: unknown; error?: string };

async function callDecisions(q: string, keepRaw = false): Promise<DecisionResult> {
    if (ROUTER_ONLY) return { intent: 'SKIP', confidence: null, ms: 0, status: 0 };
    const call = await rawCall(q, questions, keepRaw);
    const { intent, confidence } = resolveIntent(call);
    return { intent, confidence, ms: call.ms, status: call.status, raw: call.raw, error: call.error };
}

if (DRY) {
    console.log('요청 본문(질의 1건 예시):');
    console.log(JSON.stringify({ model: DECISIONS_MODEL, input: CASES[0].q, questions }, null, 2));
    console.log(`\n계획: 질의 ${CASES.length}종 × ${ROUNDS}라운드 = Decisions ${ROUTER_ONLY ? 0 : CASES.length * ROUNDS}회 + 현행 라우터 ${CASES.length * ROUNDS}회. 호출 0회로 종료.`);
    process.exit(0);
}

if (ONE) {
    const r = await callDecisions(CASES[0].q, true);
    console.log(`"${CASES[0].q}" → ${r.intent} (conf ${r.confidence ?? '-'}) · ${r.ms}ms · HTTP ${r.status}${r.error ? ` · ${r.error}` : ''}`);
    console.log(JSON.stringify(r.raw, null, 2));
    process.exit(r.status === 200 ? 0 : 1);
}

if (DEC_ONLY) {
    console.log('--decisions-only: 현행 라우터를 부르지 않는다 — 현행·하이브리드 줄은 의미 없음');
} else if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
} else {
    console.error('TIER1=1 이 필요하다 — 무료 키는 429 로 규칙 폴백에 떨어져 현행 쪽 측정이 오염된다');
    process.exit(1);
}

const { routerNode } = DEC_ONLY ? { routerNode: null as any } : await import('../../server/agent/nodes/router.js');
const { ROUTER_MODEL } = DEC_ONLY ? { ROUTER_MODEL: '(skip)' } : await import('../../server/models.js');
const { HumanMessage } = await import('@langchain/core/messages');

async function callRouter(q: string): Promise<{ intent: string; ms: number }> {
    if (DEC_ONLY) return { intent: 'SKIP', ms: 0 };
    const t0 = Date.now();
    try {
        const out: any = await routerNode({ messages: [new HumanMessage(q)] } as any);
        return { intent: out.intent, ms: Date.now() - t0 };
    } catch { return { intent: 'ERR', ms: Date.now() - t0 }; }
}

console.log(`\n현행 ${ROUTER_MODEL} vs Decisions ${DECISIONS_MODEL} · 세트 ${SET} · 문구 ${QV} · 질의 ${CASES.length}종 × ${ROUNDS}라운드`);
console.log(`호출: Decisions ${ROUTER_ONLY ? 0 : CASES.length * ROUNDS}회 · 현행 ${CASES.length * ROUNDS}회\n`);

type Row = { q: string; want: string; alt?: string[]; round: number; router: { intent: string; ms: number }; decisions: DecisionResult };
const rows: Row[] = [];
for (let round = 0; round < ROUNDS; round++) {
    for (const c of CASES) {
        let router, decisions;
        if (round % 2 === 0) { decisions = await callDecisions(c.q); router = await callRouter(c.q); }
        else { router = await callRouter(c.q); decisions = await callDecisions(c.q); }
        rows.push({ q: c.q, want: c.want, alt: c.alt, round, router, decisions });
        const mark = (g: string) => (isRight(g, c) ? '✓' : '✗');
        console.log(`  r${round + 1} ${mark(router.intent)}현행 ${router.intent.padEnd(15)} ${String(router.ms).padStart(5)}ms │ ` +
            `${mark(decisions.intent)}Dec ${decisions.intent.padEnd(15)} ${String(decisions.ms).padStart(5)}ms conf ${decisions.confidence?.toFixed(2) ?? ' -  '}` +
            `  "${c.q}"${decisions.error ? ` · ${decisions.error}` : ''}`);
    }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const summarize = (name: string, pick: (r: Row) => { intent: string; ms: number }) => {
    const ok = rows.filter(r => isRight(pick(r).intent, r)).length;
    const errs = rows.filter(r => ['ERR', 'REFUSAL'].includes(pick(r).intent)).length;
    const ms = rows.map(r => pick(r).ms);
    console.log(`${name.padEnd(12)} 정확도 ${ok}/${rows.length} (${(ok / rows.length * 100).toFixed(0)}%) · 오류 ${errs} · 지연 p50 ${pct(ms, 0.5)}ms · p90 ${pct(ms, 0.9)}ms · 최대 ${Math.max(...ms)}ms`);
};
console.log('\n── 요약 ──');
summarize('현행', r => r.router);
summarize('Decisions', r => r.decisions);
// 하이브리드: Decisions 확신도가 LOW_CONF 미만이면 현행 라우터 답을 쓴다. 운영에서는 Decisions 를 기다린 뒤
// 라우터를 부르는 직렬이므로 지연은 두 값의 합이다. 기준값은 측정 전에 고정한다(결과를 보고 바꾸지 않는다).
const hybrid = (r: Row) => (r.decisions.confidence !== null && r.decisions.confidence >= LOW_CONF)
    ? { intent: r.decisions.intent, ms: r.decisions.ms }
    : { intent: r.router.intent, ms: r.decisions.ms + r.router.ms };
summarize(`하이브리드<${LOW_CONF}`, hybrid);
console.log(`  └ 현행으로 넘긴 턴 ${rows.filter(r => !(r.decisions.confidence !== null && r.decisions.confidence >= LOW_CONF)).length}/${rows.length}`);

// 확신도가 운영 신호로 쓸모 있는가 — 틀린 답이 낮은 확신으로 나오면 그 구간만 기존 라우터로 넘길 수 있다.
const withConf = rows.filter(r => r.decisions.confidence !== null);
if (withConf.length) {
    const right = withConf.filter(r => isRight(r.decisions.intent, r)).map(r => r.decisions.confidence!);
    const wrong = withConf.filter(r => !isRight(r.decisions.intent, r)).map(r => r.decisions.confidence!);
    const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-');
    const low = withConf.filter(r => r.decisions.confidence! < LOW_CONF);
    const caught = wrong.filter(c => c < LOW_CONF).length;
    console.log(`Decisions 확신도: 정답 평균 ${avg(right)} · 오답 평균 ${avg(wrong)} · <${LOW_CONF} 비율 ${low.length}/${withConf.length} · 오답 중 <${LOW_CONF} ${caught}/${wrong.length}`);
}
const disagree = rows.filter(r => r.round === 0 && ((!DEC_ONLY && !isRight(r.router.intent, r)) || (!ROUTER_ONLY && !isRight(r.decisions.intent, r))));
if (disagree.length) {
    console.log(`\n어느 한쪽이라도 틀린 문장 ${disagree.length}건(1라운드 기준):`);
    for (const r of disagree) console.log(`  "${r.q}" 기대 ${r.want} · 현행 ${r.router.intent} · Dec ${r.decisions.intent} (conf ${r.decisions.confidence?.toFixed(2) ?? '-'})`);
}

if (process.env.PROBE_OUT) {
    fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ at: new Date().toISOString(), set: SET, questions: QV, lowConf: LOW_CONF, routerModel: ROUTER_MODEL, decisionsModel: DECISIONS_MODEL, rows }, null, 2));
    console.log(`\n원자료 → ${process.env.PROBE_OUT}`);
}
if (process.env.ROUTER_VARIANT) console.log(`[variant] 변형 호출 ${variantStats.calls} · 출력 토큰 ${variantStats.outputTokens} (호출당 약 ${Math.round(variantStats.outputTokens / Math.max(1, variantStats.calls))})`);
