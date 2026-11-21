/**
 * 정정 턴 재검색 — `npx tsx --conditions=react-server tests/manual/probe-correction-research.mts`
 * 계획: docs/plans/PLAN_RECENCY_SEARCH_261120.md §3-6
 *
 * 직전 턴이 검색해 (낡은) 답을 낸 뒤 사용자가 "오래된 거 아냐?" 처럼 정정하면 검색이 다시 켜지는가.
 * 실제 routerNode(유료 Gemini 라우터) → decideGoogleSearch(규칙) 순서로 운영과 같게 판정한다. 답 생성은 안 한다.
 * 유료 호출 = 문장 수 × RUNS(기본 3). 합성 대화만. `LANG_CASES=en|es|fr` 로 다른 언어.
 */
import fs from 'node:fs';
// 라우터가 키를 못 읽으면 LLM 을 건너뛰고 default-on 으로 판정한다 — 측정이 무효가 되므로 env 를 먼저 싣고 아래에서 호출 수를 검사한다
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
const { runWithKeyTier } = await import('../../server/key-tier');
const { routerNode } = await import('../../server/agent/nodes/router');
const { decideGoogleSearch } = await import('../../server/agent/nodes/search-gate');
const { HumanMessage, AIMessage } = await import('@langchain/core/messages');

const RUNS = Number(process.env.RUNS ?? 3);
const PREV_Q = '제미나이 최신 모델들 정리';
const PREV_A = '구글 제미나이는 Gemini 2.0 및 2.5 라인업을 중심으로 고도화되었습니다 [1][2]. Gemini 2.5 Pro는 복잡한 추론, 2.5 Flash는 빠른 응답, 2.5 Flash-Lite는 저지연 분류에 쓰입니다 [3].';
// 정정(재검색 기대) vs 가공(재검색 불필요 — 대조군)
const CASES: { q: string; expect: 'on' | 'off' }[] = [
    { q: '오래된 모델인데?', expect: 'on' },
    { q: '그거 옛날 정보 아니야?', expect: 'on' },
    { q: '2.5는 예전 모델이잖아', expect: 'on' },
    { q: '최신 아닌데?', expect: 'on' },
    { q: '지금은 4 나오지 않았어?', expect: 'on' },
    { q: '틀린 것 같은데', expect: 'on' },
    { q: '표로 다시 정리해줘', expect: 'off' },
    { q: '한 줄로 요약해줘', expect: 'off' },
];

// LANG=en|es|fr 면 그 언어의 대화·정정 문장으로 바꾼다(가드 표지어는 한국어 위주라 다른 언어는 라우터 판단에 맡겨지는지 본다)
const L10N: Record<string, { prevQ: string; prevA: string; cases: { q: string; expect: 'on' | 'off' }[] }> = {
    en: { prevQ: 'Summarize the latest Gemini models', prevA: 'Google Gemini is centered on the Gemini 2.0 and 2.5 lineup [1][2]. Gemini 2.5 Pro handles complex reasoning and 2.5 Flash is for fast responses [3].', cases: [
        { q: 'Those are old models, no?', expect: 'on' }, { q: "Isn't that outdated info?", expect: 'on' }, { q: "That's wrong, isn't Gemini 4 out?", expect: 'on' }, { q: "That's not the latest", expect: 'on' },
        { q: 'Put that in a table', expect: 'off' }, { q: 'Summarize it in one line', expect: 'off' } ] },
    es: { prevQ: 'Resume los modelos más recientes de Gemini', prevA: 'Google Gemini se centra en la línea Gemini 2.0 y 2.5 [1][2]. Gemini 2.5 Pro sirve para razonamiento complejo y 2.5 Flash para respuestas rápidas [3].', cases: [
        { q: '¿No son modelos viejos?', expect: 'on' }, { q: '¿Esa información no está desactualizada?', expect: 'on' }, { q: 'Eso está mal, ¿no salió Gemini 4?', expect: 'on' }, { q: 'Eso no es lo más reciente', expect: 'on' },
        { q: 'Ponlo en una tabla', expect: 'off' }, { q: 'Resúmelo en una línea', expect: 'off' } ] },
    fr: { prevQ: 'Résume les derniers modèles Gemini', prevA: 'Google Gemini est centré sur la gamme Gemini 2.0 et 2.5 [1][2]. Gemini 2.5 Pro sert au raisonnement complexe et 2.5 Flash aux réponses rapides [3].', cases: [
        { q: 'Ce sont de vieux modèles, non ?', expect: 'on' }, { q: "Ce n'est pas une info dépassée ?", expect: 'on' }, { q: "C'est faux, Gemini 4 n'est pas sorti ?", expect: 'on' }, { q: "Ce n'est pas le plus récent", expect: 'on' },
        { q: 'Mets ça dans un tableau', expect: 'off' }, { q: 'Résume-le en une ligne', expect: 'off' } ] },
};
const LANG = process.env.LANG_CASES;
const ACTIVE = LANG ? L10N[LANG] : { prevQ: PREV_Q, prevA: PREV_A, cases: CASES };

const quiet = async <T,>(f: () => Promise<T>) => { const o = console.log; console.log = () => {}; try { return await f(); } finally { console.log = o; } };
let pass = 0, total = 0;
for (const c of ACTIVE.cases) {
    const cells: string[] = [];
    for (let r = 0; r < RUNS; r++) {
        const messages = [new HumanMessage(ACTIVE.prevQ), new AIMessage(ACTIVE.prevA), new HumanMessage(c.q)];
        // 실측은 유료 키로(무료 키 소진 방지)
        const out: any = await quiet(() => runWithKeyTier('paid-first', () => routerNode({ messages, activeCards: {} } as any)));
        const gate = await quiet(async () => decideGoogleSearch({
            webContent: '', messages, intent: out?.intent ?? 'general', needsSearch: !!out?.needsSearch,
            hasMultimodalContent: false, isYoutubeRequest: false, hasVideoData: false,
            latestUserText: c.q, lastTurnSearched: true, provider: 'gemini',
        }));
        const got = gate.useGoogleSearch ? 'on' : 'off';
        total++; if (got === c.expect) pass++;
        // reformat: 라우터의 '형식만 바꾸기' 판정 — 가공 턴은 true, 정정 턴은 false 여야 검색 억제 신호로 쓸 수 있다
        cells.push(`${got === c.expect ? '✅' : '❌'}${got}(router=${out?.needsSearch ? 'on' : 'off'},by=${gate.searchBy},reformat=${out?.reformatTurn ? 'Y' : 'n'},from=${out?.intentFrom ?? '?'})`);
    }
    console.log(`${c.q.padEnd(18)} 기대=${c.expect}  ${cells.join('  ')}`);
}
console.log(`\n일치 ${pass}/${total}`);
if (process.env.ROUTER_VARIANT && variantStats.calls === 0) { console.log('❌ 변형이 한 번도 적용되지 않았다 — 라우터 LLM 미호출(키?)'); process.exitCode = 1; }
