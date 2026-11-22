/**
 * Decisions(GA) 재측정 — 10-19 문구 vs 공식 가이드 원칙 문구. `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-decisions-guide.mts [라운드=2]`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §3 T3 · 이전 측정 PLAN_DECISION_ROUTER_261019.md §14-1
 * 가이드: https://developers.openai.com/api/docs/guides/decisions
 *
 *   old   10-19 v2 의도 문구 + 검색 predicate 1개(조건 나열) · 입력 문자열
 *   guide 같은 의도 선택지 + 검색을 관찰 가능한 predicate 4개로 분리 · 입력은 developer + user 메시지 배열
 *   f     guide 의 검색 질문 + 입력은 old 처럼 문자열(11-23 — guide 에서 의도 오답이 고확신으로 바뀐 원인이 입력 형식인지 본다)
 *   세트: 골든 v1 · SEARCH_GRAY · SEARCH_HOLDOUT(11-23, 문구 고정 뒤 작성)
 *
 * guide 문구와 조합 규칙은 실행 전에 고정했다 — 결과를 보고 이 세트에 맞춰 고치지 않는다(과적합).
 * 최종 검색 = 운영과 같이 규칙(classifySearchNeed) on/off 우선, gray 일 때만 Decisions.
 * 합성 문장·유료 키(TIER1)만. 출력은 판정·지연·오류 코드만.
 * 호출: (골든 89 + 검색 15 + 검증 16) × 라운드 × 3팔
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
const ROUNDS = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? 2);
const { INTENT_QUESTIONS_V2, callDecisions, resolveIntent } = await import('./decisions-client.mts');
const { GOLDEN_V1 } = await import('./router-golden.mts');
const { SEARCH_GRAY, SEARCH_HOLDOUT } = await import('./router-cases.mts');
const { classifySearchNeed } = await import('../../server/agent/intent-rules.js');

// 10-19 §14-1 문구 그대로
const OLD_SEARCH = {
    type: 'predicate', name: 'needs_search',
    instructions: 'Answering the latest user message needs up-to-date web search: real-time or current information (news, prices, stocks, latest, today, now, recent events), a person\'s current status or role, rankings, company metrics, an explicit request to search or cite sources, or a specific named product, model, or version that may be recent. Timeless knowledge, well-established concepts, code, translation, writing, math, recipes, or general advice do not.',
};
// 가이드: 관찰 가능한 기준 · 관심사마다 질문 하나
const GUIDE_SEARCH = [
    { type: 'predicate', name: 'current_info', instructions: 'Does a correct answer depend on facts that change over weeks or months, such as news, prices, schedules, rankings, releases, or a person\'s current status?' },
    { type: 'predicate', name: 'asks_sources', instructions: 'Does the user explicitly ask to search the web, look something up online, or cite sources?' },
    { type: 'predicate', name: 'recent_product', instructions: 'Does the message name or ask about a specific product, model, service, or version that may have been released or updated in the last two years?' },
    { type: 'predicate', name: 'timeless', instructions: 'Is the message about stable knowledge or a method that does not change over time, such as a concept, how-to, recipe, code, math, writing, or general advice?' },
];
const DEV_MSG = 'You classify one chat message for an assistant app. The latest user message is the evidence. Judge what the user wants, not which words appear.';

const p = (call: any, name: string): number | null => { const a = call.answers?.[name]; return a && a !== 'REFUSAL' && typeof a.probability === 'number' ? a.probability : null; };
// 조합 규칙(고정): 명시 요청이나 시점 의존이면 검색, 최신 제품은 안정 지식 질문이 아닐 때만
const guideSearch = (call: any): boolean | null => {
    const cur = p(call, 'current_info'), src = p(call, 'asks_sources'), prod = p(call, 'recent_product'), stable = p(call, 'timeless');
    if (cur === null || src === null || prod === null || stable === null) return null;
    return src >= 0.5 || cur >= 0.5 || (prod >= 0.5 && stable < 0.5);
};

type Arm = 'old' | 'guide' | 'f';
const ask = (arm: Arm, q: string) => arm === 'old'
    ? callDecisions(q, [...INTENT_QUESTIONS_V2, OLD_SEARCH])
    : arm === 'f' ? callDecisions(q, [...INTENT_QUESTIONS_V2, ...GUIDE_SEARCH])
    : callDecisions([{ role: 'developer', content: DEV_MSG }, { role: 'user', content: q }] as any, [...INTENT_QUESTIONS_V2, ...GUIDE_SEARCH]);
const searchOf = (arm: Arm, call: any) => arm === 'old' ? (p(call, 'needs_search') === null ? null : p(call, 'needs_search')! >= 0.5) : guideSearch(call);
const isRight = (got: string, c: { want: string; alt?: string[] }) => got === c.want || !!c.alt?.includes(got);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

const ARMS = (process.env.ARMS ?? 'old,guide,f').split(',') as Arm[];
const grayCheck = SEARCH_HOLDOUT.filter(c => classifySearchNeed(c.q) !== 'gray').map(c => `${c.q}→${classifySearchNeed(c.q)}`);
console.log(`검증 세트 규칙 판정: ${grayCheck.length ? '⚠ gray 아님 ' + grayCheck.join(' · ') : '전부 gray'}`);
for (const arm of ARMS) {
    let iOk = 0, iN = 0, lowWrong = 0, wrong = 0, sOk = 0, sLlmOk = 0, sN = 0, errs = 0, hOk = 0, hLlmOk = 0, hN = 0;
    const ms: number[] = []; const misses: string[] = [];
    for (let r = 0; r < ROUNDS; r++) {
        for (const c of GOLDEN_V1 as any[]) {
            const call = await ask(arm, c.q); ms.push(call.ms); iN++;
            if (call.error) { errs++; continue; }
            const { intent, confidence } = resolveIntent(call);
            if (isRight(intent, c)) iOk++; else { wrong++; if ((confidence ?? 0) < 0.7) lowWrong++; if (r === 0) misses.push(`의도 ${intent}(${confidence?.toFixed(2)}) 기대 ${c.want} "${c.q}"`); }
        }
        for (const c of SEARCH_GRAY as any[]) {
            const call = await ask(arm, c.q); ms.push(call.ms); sN++;
            if (call.error) { errs++; continue; }
            const llm = searchOf(arm, call);
            const rule = classifySearchNeed(c.q);
            const fin = rule === 'on' ? true : rule === 'off' ? false : (llm ?? true);
            if (llm === c.wantSearch) sLlmOk++;
            if (fin === c.wantSearch) sOk++; else if (r === 0) misses.push(`검색 ${fin ? 'on' : 'off'} 기대 ${c.wantSearch ? 'on' : 'off'} "${c.q}"`);
        }
        for (const c of SEARCH_HOLDOUT as any[]) {
            const call = await ask(arm, c.q); ms.push(call.ms); hN++;
            if (call.error) { errs++; continue; }
            const llm = searchOf(arm, call);
            const rule = classifySearchNeed(c.q);
            const fin = rule === 'on' ? true : rule === 'off' ? false : (llm ?? true);
            if (llm === c.wantSearch) hLlmOk++;
            if (fin === c.wantSearch) hOk++; else if (r === 0) misses.push(`검증 ${fin ? 'on' : 'off'} 기대 ${c.wantSearch ? 'on' : 'off'} "${c.q}"`);
        }
    }
    console.log(`\n■ Decisions ${arm} · ${ROUNDS}라운드`);
    console.log(`  의도 ${iOk}/${iN} (${(iOk / iN * 100).toFixed(1)}%) · 오답 ${wrong} 중 저확신(<0.7) ${lowWrong}`);
    console.log(`  검색 최종 ${sOk}/${sN} · LLM 원판정 ${sLlmOk}/${sN}`);
    console.log(`  검증 세트 최종 ${hOk}/${hN} · LLM 원판정 ${hLlmOk}/${hN}`);
    console.log(`  지연 p50 ${pct(ms, 0.5)}ms · p90 ${pct(ms, 0.9)}ms · 최대 ${Math.max(...ms)}ms · 오류 ${errs}`);
    console.log(`  1라운드 오답 ${misses.length}건`);
    for (const m of misses) console.log(`    ✗ ${m}`);
}
