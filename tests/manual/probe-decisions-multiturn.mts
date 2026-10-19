/**
 * 카드 후속 멀티턴 — 현행 라우터 LLM 판정 vs OpenAI Decisions vs 하이브리드.
 * 계획: docs/plans/PLAN_DECISION_ROUTER_261019.md §8
 *
 *   npx tsx tests/manual/probe-decisions-multiturn.mts --dry [--set=more|holdout|holdout2] [--q=v2]
 *   --decisions-only : 현행 라우터를 부르지 않는다(문구 비교·회귀용, Decisions 호출만)
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-decisions-multiturn.mts [라운드=2]
 *
 * 비교 층: **라우터 LLM 의 판정(intent + follow_up)**. 운영 라우터는 이 위에 규칙(card-followup·날씨 고정 등)을
 * 덧씌우는데, 그 규칙은 어느 분류기를 쓰든 똑같이 돈다. 그래서 LLM 층만 바꿔 비교한다.
 * 현행 쪽은 routerNode 를 그대로 부르고, LLM 이 낸 값은 라우터 로그에서 읽는다
 * ("parsed intent from LLM" · "llmFollowUp="). 프로덕션 코드는 건드리지 않는다.
 *
 * Decisions 입력은 라우터가 LLM 에 넘기는 맥락과 같은 형식이다(직전 답변 300자 + 화면 카드 NOTE + 사용자 메시지).
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
const DEC_ONLY = args.includes('--decisions-only');
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 2);

const { DECISIONS_MODEL, LOW_CONF, INTENT_QUESTIONS, INTENT_QUESTIONS_V2, FOLLOW_UP_V1, FOLLOW_UP_V2, callDecisions, resolveIntent } = await import('./decisions-client.mts');
const { MULTITURN, MULTITURN_MORE, MULTITURN_HOLDOUT, MULTITURN_HOLDOUT2 } = await import('./router-cases.mts');
type MultiturnCase = (typeof MULTITURN)[number];
const SET = args.find(a => a.startsWith('--set='))?.slice(6) ?? 'cards';
const CASES: MultiturnCase[] = SET === 'more' ? MULTITURN_MORE : SET === 'holdout' ? MULTITURN_HOLDOUT : SET === 'holdout2' ? MULTITURN_HOLDOUT2 : MULTITURN;

const QV = args.find(a => a.startsWith('--q='))?.slice(4) ?? 'v1';
const FOLLOW_UP_QUESTION = QV === 'v2' ? FOLLOW_UP_V2 : FOLLOW_UP_V1;
const BASE_QUESTIONS = QV === 'v2' ? INTENT_QUESTIONS_V2 : INTENT_QUESTIONS;
const questionsFor = (c: MultiturnCase) => (c.card === 'none' ? BASE_QUESTIONS : [...BASE_QUESTIONS, FOLLOW_UP_QUESTION]);

// 화면 카드 재현 — 라우터는 직전 AI 메시지의 ```json:<kind> 블록, activeCards, movieContext 로 카드를 안다.
const CARD_HINT: Record<Exclude<MultiturnCase['card'], 'none'>, string> = {
    weather: 'a WEATHER CARD (current conditions + 5-day forecast for the city already asked)',
    movie: "a MOVIE SHOWTIMES CARD (today's showtimes at the theaters already asked)",
    pharmacy: 'a PHARMACY RESULTS CARD',
    hospital: 'a HOSPITAL RESULTS CARD',
    vet: 'a VETERINARY HOSPITAL RESULTS CARD',
    law: 'a KOREAN LAW ARTICLE CARD',
};
const MOVIE_CONTEXT = '[CGV 강남] 영화A(12세) 2D 3회 14:00·16:40·19:20 잔여 41/120 · 영화B(15세) IMAX 2회 15:10·20:00 잔여 12/300';
function aiContent(c: MultiturnCase): string {
    if (c.ai) return c.ai;
    switch (c.card) {
        case 'weather': return '```json:weather\n{"location":{"name":"서울"},"current":{"temp":18,"condition":"맑음"}}\n```\n서울은 지금 맑고 18도예요.';
        case 'movie': return '강남 CGV 오늘 상영표를 카드로 보여드렸어요.';
        case 'law': return '```json:law\n{"law":"근로기준법","articles":[{"no":"제60조","title":"연차 유급휴가"}]}\n```\n근로기준법 제60조(연차 유급휴가) 조문입니다.';
        default: return `\`\`\`json:${c.card}\n{"region":"서초구","items":[{"name":"샘플","address":"서울 서초구"}]}\n\`\`\`\n서초구 결과입니다.`;
    }
}
function decisionsInput(c: MultiturnCase): string {
    const note = c.card === 'none' ? '' : `\nNOTE: ${CARD_HINT[c.card]} is currently displayed on screen.`;
    return `Previous assistant response (for follow-up context, first 300 chars): "${aiContent(c).slice(0, 300)}"${note}\n\nUser Message: "${c.q}"`;
}

if (DRY) {
    console.log('Decisions 입력 예시:\n' + decisionsInput(CASES[0]));
    console.log(`\n질문: ${questionsFor(CASES[0]).map((q: any) => q.name).join(', ')}`);
    console.log(`계획: 세트 ${SET} · 질의 ${CASES.length}종 × ${ROUNDS}라운드 = Decisions ${CASES.length * ROUNDS}회 + 현행 라우터 ${CASES.length * ROUNDS}회. 호출 0회로 종료.`);
    process.exit(0);
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
const { HumanMessage, AIMessage } = await import('@langchain/core/messages');

type Judged = { intent: string; followUp: string; ms: number; finalIntent?: string; intentConf?: number | null; followConf?: number | null };

async function callRouter(c: MultiturnCase): Promise<Judged> {
    if (DEC_ONLY) return { intent: 'SKIP', followUp: 'SKIP', ms: 0 };
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    const t0 = Date.now();
    let out: any;
    try {
        out = await routerNode({
            messages: [new HumanMessage(c.prev), new AIMessage(aiContent(c)), new HumanMessage(c.q)],
            activeCards: c.card === 'movie' || c.card === 'none' ? {} : { [c.card]: true, latest: c.card },
            movieContext: c.card === 'movie' ? MOVIE_CONTEXT : undefined,
        } as any);
    } catch { /* 아래에서 ERR 처리 */ } finally { console.log = orig; }
    const ms = Date.now() - t0;
    const parsed = logs.map(l => l.match(/parsed intent from LLM: (\S+)/)?.[1]).find(Boolean);
    const follow = logs.map(l => l.match(/llmFollowUp=([^,\s]+)/)?.[1]).find(Boolean);
    return { intent: parsed ?? 'ERR', followUp: follow && follow !== '-' ? follow : 'ERR', ms, finalIntent: out?.intent };
}

async function callDec(c: MultiturnCase): Promise<Judged> {
    const call = await callDecisions(decisionsInput(c), questionsFor(c));
    const { intent, confidence } = resolveIntent(call);
    const f = call.answers.follow_up;
    return {
        intent, followUp: c.card === 'none' ? '-' : f && f !== 'REFUSAL' ? f.choice : (call.error ? 'ERR' : 'REFUSAL'),
        ms: call.ms, intentConf: confidence, followConf: f && f !== 'REFUSAL' ? f.confidence : null,
    };
}

console.log(`\n현행 ${ROUTER_MODEL} vs Decisions ${DECISIONS_MODEL} · 세트 ${SET} · 문구 ${QV} · 멀티턴 ${CASES.length}종 × ${ROUNDS}라운드`);
console.log(`호출: Decisions ${CASES.length * ROUNDS}회 · 현행 ${CASES.length * ROUNDS}회 · 하이브리드 기준 ${LOW_CONF}\n`);

// 날씨 카드 refine 은 라우터 규칙이 intent 를 general 로 바꾼다(router.ts "Weather follow-up (refine)") —
// 그 턴의 LLM intent 가 weather 든 general 이든 최종 동작이 같으므로 둘 다 정답으로 친다.
const intentOk = (c: MultiturnCase, got: string) =>
    got === c.want || (c.card === 'weather' && c.wantFollowUp === 'refine' && (got === 'general' || got === 'weather'));
type Row = { c: MultiturnCase; round: number; router: Judged; dec: Judged };
const rows: Row[] = [];
for (let round = 0; round < ROUNDS; round++) {
    for (const c of CASES) {
        let router, dec;
        if (round % 2 === 0) { dec = await callDec(c); router = await callRouter(c); }
        else { router = await callRouter(c); dec = await callDec(c); }
        rows.push({ c, round, router, dec });
        const ok = (j: Judged) => (intentOk(c, j.intent) && (!c.wantFollowUp || j.followUp === c.wantFollowUp) ? '✓' : '✗');
        console.log(`  r${round + 1} [${c.card}] ${ok(router)}현행 ${router.intent}/${router.followUp} ${router.ms}ms │ ` +
            `${ok(dec)}Dec ${dec.intent}/${dec.followUp} ${dec.ms}ms conf ${dec.intentConf?.toFixed(2) ?? '-'}/${dec.followConf?.toFixed(2) ?? '-'}` +
            `  "${c.q}" (기대 ${c.want}/${c.wantFollowUp})`);
    }
}

// 카드 없는 턴은 follow_up 을 묻지 않으므로 intent 확신도만 본다.
const confident = (j: Judged, c?: MultiturnCase) => (j.intentConf ?? 0) >= LOW_CONF && (c?.card === 'none' || (j.followConf ?? 0) >= LOW_CONF);
const hybrid = (r: Row): Judged => confident(r.dec, r.c) ? r.dec : { ...r.router, ms: r.dec.ms + r.router.ms };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const summarize = (name: string, pick: (r: Row) => Judged) => {
    const both = rows.filter(r => intentOk(r.c, pick(r).intent) && (!r.c.wantFollowUp || pick(r).followUp === r.c.wantFollowUp)).length;
    const intentHits = rows.filter(r => intentOk(r.c, pick(r).intent)).length;
    const followOk = rows.filter(r => r.c.wantFollowUp && pick(r).followUp === r.c.wantFollowUp).length;
    const followN = rows.filter(r => r.c.wantFollowUp).length;
    const ms = rows.map(r => pick(r).ms);
    console.log(`${name.padEnd(12)} 둘 다 ${both}/${rows.length} · intent ${intentHits} · follow_up ${followOk}/${followN} · p50 ${pct(ms, 0.5)}ms · p90 ${pct(ms, 0.9)}ms`);
};
console.log('\n── 요약 ──');
summarize('현행', r => r.router);
summarize('Decisions', r => r.dec);
summarize(`하이브리드<${LOW_CONF}`, hybrid);
console.log(`  └ 현행으로 넘긴 턴 ${rows.filter(r => !confident(r.dec, r.c)).length}/${rows.length}`);
const decWrong = rows.filter(r => !(intentOk(r.c, r.dec.intent) && (!r.c.wantFollowUp || r.dec.followUp === r.c.wantFollowUp)));
console.log(`Decisions 오답 ${decWrong.length}건 중 하이브리드가 넘긴 것 ${decWrong.filter(r => !confident(r.dec, r.c)).length}`);

console.log('\n어느 한쪽이라도 틀린 문장(1라운드):');
for (const r of rows.filter(r => r.round === 0)) {
    const bad = (j: Judged) => !intentOk(r.c, j.intent) || (!!r.c.wantFollowUp && j.followUp !== r.c.wantFollowUp);
    if (bad(r.router) || bad(r.dec)) console.log(`  [${r.c.card}] "${r.c.q}" 기대 ${r.c.want}/${r.c.wantFollowUp} · 현행 ${r.router.intent}/${r.router.followUp}(최종 ${r.router.finalIntent}) · Dec ${r.dec.intent}/${r.dec.followUp} (${r.dec.intentConf?.toFixed(2)}/${r.dec.followConf?.toFixed(2)})`);
}

if (process.env.PROBE_OUT) {
    fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ at: new Date().toISOString(), set: SET, questions: QV, lowConf: LOW_CONF, routerModel: ROUTER_MODEL, decisionsModel: DECISIONS_MODEL, rows }, null, 2));
    console.log(`\n원자료 → ${process.env.PROBE_OUT}`);
}
