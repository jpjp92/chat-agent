/**
 * Decisions 의도 문구 v3 · gemini-decision-1 비교 — `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-decisions-v3.mts`
 * 계획: docs/plans/PLAN_DECISION_ROUTER_261019.md §21 · 이전: probe-decisions-guide.mts(§20)
 *
 *   f2  OpenAI gpt-6-luna · 의도 v2(10-19) + 검색 4문항 · 입력 문자열 (§20 의 f)
 *   f3  OpenAI gpt-6-luna · 의도 v3 + 보조 2문항 + 검색 4문항
 *   g2  gemini-decision-1 · f2 와 같은 문구
 *   g3  gemini-decision-1 · f3 와 같은 문구
 *   f4·g4  v4 — 튜닝 세트 오답(§21)으로 고친 문구. 검증은 고치기 전에 쓴 DECISIONS_HOLDOUT_V4 와 골든
 *
 * v3 는 정답 기준 문서(docs/guide/REF_ROUTER_LABELS.md)와 두 공식 가이드 원칙(관심사마다 질문 하나 · 짧고 겹치지 않는 설명)으로
 * **한 번에** 썼다. 골든 문장을 보고 쓰지 않았고, 결과를 보고 고치지 않는다.
 * 세트: 튜닝(router-cases 단일 턴 17종, 1라운드) · 골든 v1 · SEARCH_GRAY · SEARCH_HOLDOUT(2라운드).
 * 합성 문장·유료 키(TIER1)만. 출력은 판정·지연·오류 코드만.
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
const { INTENT_QUESTIONS_V2, callDecisions } = await import('./decisions-client.mts');
const cases = await import('./router-cases.mts');
const { GOLDEN_V1 } = await import('./router-golden.mts');
const { classifySearchNeed } = await import('../../server/agent/intent-rules.js');

const TUNING_SETS = ['MISROUTED', 'MUST_KEEP', 'HOLDOUT', 'HOLDOUT2', 'HOLDOUT3', 'ROUTER_FRESH', 'ROUTER_FINAL', 'ROUTER_DOMAINS', 'ROUTER_DOMAINS2', 'ROUTER_CAUSES', 'ROUTER_LAW_BOUNDARY', 'ROUTER_WOBBLE', 'ROUTER_PET', 'ROUTER_BIO_EXPLAIN', 'ROUTER_ORG_ACTIVITY', 'ROUTER_VISUAL_EXPLAIN', 'ROUTER_PHYSICS_CONCEPTS'];
const TUNING = TUNING_SETS.flatMap(n => (cases as any)[n] as { q: string; want: string; alt?: string[] }[]);

// §20 f 와 같은 검색 문항
const SEARCH_Q = [
    { type: 'predicate', name: 'current_info', instructions: 'Does a correct answer depend on facts that change over weeks or months, such as news, prices, schedules, rankings, releases, or a person\'s current status?' },
    { type: 'predicate', name: 'asks_sources', instructions: 'Does the user explicitly ask to search the web, look something up online, or cite sources?' },
    { type: 'predicate', name: 'recent_product', instructions: 'Does the message name or ask about a specific product, model, service, or version that may have been released or updated in the last two years?' },
    { type: 'predicate', name: 'timeless', instructions: 'Is the message about stable knowledge or a method that does not change over time, such as a concept, how-to, recipe, code, math, writing, or general advice?' },
];

// v3 — REF_ROUTER_LABELS 의 "정답일 때 / 아닐 때" 를 짧게. 기준은 "사용자가 무엇을 받고 싶은가"
const V3_CHOICES: [string, string][] = [
    ['drug_info', 'Facts about a specific named drug: effects, side effects, dose, interactions, or whether it can be taken.'],
    ['medical_qa', 'A person\'s own health: symptoms, illness, injury, treatment, how a disease works, or health guideline amounts.'],
    ['pharmacy_search', 'Find a pharmacy: location or opening hours.'],
    ['hospital_search', 'Find a hospital or clinic for people: location, hours, ER, or department.'],
    ['vet_search', 'Find an animal hospital: location or hours.'],
    ['law_search', 'Show the text or list of a Korean statute or article.'],
    ['law_qa', 'What Korean law says about rights, duties, permission, penalties, or handling a dispute.'],
    ['paper_search', 'Find research papers or studies.'],
    ['movie_search', 'Theater showtimes or what is playing now.'],
    ['weather', 'Current weather or a short-term forecast for a place.'],
    ['biology', 'See a 3D structure of a molecule, protein, DNA, or cell.'],
    ['chemistry', 'See a molecule or reaction as a structure or model.'],
    ['physics', 'See a physics simulation of motion, force, waves, or circuits.'],
    ['astronomy', 'See a sky map or where stars, constellations, or planets are in the sky.'],
    ['data_viz', 'See a chart or graph of numbers.'],
    ['general', 'Everything else: explanations, advice, recommendations, procedures, code, writing, chat, and animal care.'],
];
const V3_INTENT = { type: 'choice', name: 'intent', instructions: 'What does the user want to receive from the latest message? Field words such as pharmacy, law, weather, movie, paper, or star alone do not decide it.', choices: V3_CHOICES.map(([value, description]) => ({ value, description })) };
const V3_AUX = [
    { type: 'predicate', name: 'subject_animal', instructions: 'Is the health or care question about an animal rather than a person?' },
    { type: 'predicate', name: 'wants_visual', instructions: 'Does the user ask to see a picture, 3D structure, simulation, sky map, or chart?' },
];
const PAPER_Q = (INTENT_QUESTIONS_V2 as any[]).find(q => q.name === 'paper_source');
// v4 — §21 튜닝 오답 대응: 날씨 현상·행정 절차·육아 일상을 general 로 명시, 시각 질문은 설명과 함께여도 포함, 내리는 기준 0.3
const V4_DESC: Record<string, string> = {
    medical_qa: 'A person\'s own symptoms, illness, injury, or treatment, how a disease works, or adult health guideline amounts.',
    law_qa: 'What Korean law says about rights, duties, permission, penalties, or how to report or respond to a dispute or fraud.',
    weather: 'Current conditions or a forecast for the next few days at a place. Not air quality, typhoons, or seasonal outlooks.',
    biology: 'See the structure of a molecule, protein, DNA, or cell, including when asked to explain that structure.',
    general: 'Everything else: explanations, advice, recommendations, code, writing, chat, animal health and care, baby care routines, insurance and administrative procedures, air quality, typhoons, and seasonal outlooks.',
};
const V4_INTENT = { ...V3_INTENT, choices: V3_CHOICES.map(([value, description]) => ({ value, description: V4_DESC[value] ?? description })) };
const V4_AUX = [
    V3_AUX[0],
    { type: 'predicate', name: 'wants_visual', instructions: 'Does the user want something drawn, modeled, shown in 3D, simulated, located in the sky, or charted, even together with an explanation?' },
];
const RENDERERS = new Set(['biology', 'chemistry', 'physics', 'astronomy', 'data_viz']);

type Arm = 'f2' | 'f3' | 'g2' | 'g3' | 'f4' | 'g4';
const qsOf = (arm: Arm) => arm.endsWith('2') ? [...INTENT_QUESTIONS_V2, ...SEARCH_Q] : arm.endsWith('4') ? [V4_INTENT, PAPER_Q, ...V4_AUX, ...SEARCH_Q] : [V3_INTENT, PAPER_Q, ...V3_AUX, ...SEARCH_Q];

// gemini-decision-1 — questions 는 이름 키 맵, choice 는 criteria 맵, predicate 는 noul
async function callGemini(input: string, questions: any[]) {
    const t0 = Date.now();
    const qmap: Record<string, unknown> = {};
    for (const q of questions) qmap[q.name] = q.type === 'choice'
        ? { type: 'choice', instructions: q.instructions, criteria: Object.fromEntries(q.choices.map((c: any) => [c.value, c.description ?? ''])) }
        : { type: 'noul', instructions: q.instructions };
    try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
            method: 'POST', headers: { 'x-goog-api-key': process.env.API_KEY_TIER1!, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-decision-1', input, questions: qmap }), signal: AbortSignal.timeout(15_000),
        });
        const ms = Date.now() - t0; const body: any = await res.json().catch(() => null);
        if (!res.ok) return { answers: {}, ms, status: res.status, error: `HTTP ${res.status}` };
        const answers: Record<string, any> = {};
        for (const [k, a] of Object.entries<any>(body?.answers ?? {})) answers[k] = a.type === 'choice' ? { choice: a.choice, confidence: a.confidence } : { probability: a.noul, confidence: a.confidence };
        return { answers, ms, status: res.status };
    } catch (e: any) { return { answers: {}, ms: Date.now() - t0, status: 0, error: e?.name ?? 'ERR' }; }
}
const ask = (arm: Arm, q: string): Promise<any> => arm.startsWith('g') ? callGemini(q, qsOf(arm)) : callDecisions(q, qsOf(arm));

const prob = (c: any, n: string): number | null => typeof c.answers?.[n]?.probability === 'number' ? c.answers[n].probability : null;
// 조합(실행 전 고정): paper_search → DB 판정 파생(라우터와 같음) · v3 만 보조 문항 적용
function intentOf(arm: Arm, c: any): { intent: string; conf: number } {
    const ia = c.answers?.intent; if (!ia?.choice) return { intent: 'ERR', conf: 0 };
    let intent = ia.choice as string; let conf = ia.confidence ?? 0;
    if (intent === 'paper_search') { const s = c.answers?.paper_source?.choice; intent = s === 'arxiv' ? 'arxiv_search' : s === 'pubmed' ? 'paper_search' : 'general'; }
    if (!arm.endsWith('2')) {
        const vcut = arm.endsWith('4') ? 0.3 : 0.5;
        const animal = prob(c, 'subject_animal') ?? 0, visual = prob(c, 'wants_visual') ?? 0;
        if (intent === 'medical_qa' && animal >= 0.5) { intent = 'general'; conf = Math.min(conf, animal); }
        if (RENDERERS.has(intent) && visual < vcut) { intent = 'general'; conf = Math.min(conf, 1 - visual); }
    }
    return { intent, conf };
}
const searchOf = (c: any) => {
    const cur = prob(c, 'current_info'), src = prob(c, 'asks_sources'), prod = prob(c, 'recent_product'), st = prob(c, 'timeless');
    if (cur === null || src === null || prod === null || st === null) return null;
    return src >= 0.5 || cur >= 0.5 || (prod >= 0.5 && st < 0.5);
};
const isRight = (got: string, c: { want: string; alt?: string[] }) => got === c.want || !!c.alt?.includes(got);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

const ARMS = (process.env.ARMS ?? 'f2,f3,g2,g3').split(',') as Arm[];
console.log(`튜닝 ${TUNING.length} · 골든 ${GOLDEN_V1.length} · 검색 ${cases.SEARCH_GRAY.length}+${cases.SEARCH_HOLDOUT.length}`);
for (const arm of ARMS) {
    const ms: number[] = []; let errs = 0;
    const intentSet = async (set: any[], rounds: number) => {
        let ok = 0, n = 0, low = 0, lowRight = 0, wrongHigh = 0; const miss: string[] = [];
        for (let r = 0; r < rounds; r++) for (const c of set) {
            const call = await ask(arm, c.q); ms.push(call.ms); n++;
            if (call.error) { errs++; continue; }
            const { intent, conf } = intentOf(arm, call); const right = isRight(intent, c);
            if (right) ok++; if (conf < 0.7) { low++; if (right) lowRight++; } else if (!right) wrongHigh++;
            if (!right && r === 0) miss.push(`${intent}(${conf.toFixed(2)}) 기대 ${c.want} "${c.q}"`);
        }
        return { ok, n, low, lowRight, wrongHigh, miss };
    };
    const tun = await intentSet(TUNING, 1);
    const gold = await intentSet(GOLDEN_V1 as any[], 2);
    const hold = await intentSet(cases.DECISIONS_HOLDOUT_V4 as any[], 2);
    let sOk = 0, sN = 0;
    for (let r = 0; r < 2; r++) for (const c of [...cases.SEARCH_GRAY, ...cases.SEARCH_HOLDOUT]) {
        const call = await ask(arm, c.q); ms.push(call.ms); sN++;
        if (call.error) { errs++; continue; }
        if (searchOf(call) === c.wantSearch) sOk++;
    }
    const line = (name: string, x: typeof tun) => `  ${name} ${x.ok}/${x.n} (${(x.ok / x.n * 100).toFixed(1)}%) · 저확신 넘김 ${x.low}(${(x.low / x.n * 100).toFixed(0)}%, 그중 원래 맞음 ${x.lowRight}) · 고확신 오답 ${x.wrongHigh}`;
    console.log(`\n■ ${arm}`);
    console.log(line('튜닝', tun)); console.log(line('골든', gold)); console.log(line('v4검증', hold));
    console.log(`  검색 원판정 ${sOk}/${sN}`);
    console.log(`  지연 p50 ${pct(ms, 0.5)}ms · p90 ${pct(ms, 0.9)}ms · 최대 ${Math.max(...ms)}ms · 오류 ${errs}`);
    console.log(`  골든 오답(1라운드): ${gold.miss.join(' | ') || '없음'}`);
    console.log(`  v4검증 오답(1라운드): ${hold.miss.join(' | ') || '없음'}`);
    console.log(`  튜닝 오답: ${tun.miss.length}건`); for (const m of tun.miss) console.log(`    ✗ ${m}`);
}
