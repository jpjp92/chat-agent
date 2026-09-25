/**
 * 프롬프트 조립 **골든 스냅샷** — `npx tsx tests/test-prompt-assembly.mts`
 *
 * 이 하니스가 생긴 이유: 프롬프트를 계층별 파일로 재배치하는 작업
 * ([PLAN_PROMPT_LAYERING_260923](../docs/plans/PLAN_PROMPT_LAYERING_260923.md))에서
 * **"구조만 바꿨다"를 증명할 자가 필요**했다. 그 자가 없으면 재배치가 응답을 바꿨는지
 * 알 수 없고, 알 수 없으면 되돌릴 근거도 없다.
 *
 * 🔴 2026-09-24 이전에는 **만들 수 없었다.** 조립 결과가 `generator.ts` 클로저의 지역 변수라
 *    노드를 돌리지 않고는 볼 수 없었고, 돌리면 네트워크를 탔다(§7-6). `prompt-assembly.ts`
 *    로 떼어낸 뒤에야 오프라인으로 잴 수 있게 됐다.
 *
 * 무엇을 지키나:
 *   ① **계층별 해시** — 최종 결과 하나만 보면 "달라졌다"에서 끝난다. base·렌더러·의도 정책을
 *      따로 찍어야 `렌더러 그대로 · 의도 정책 바뀜` 까지 좁혀진다(§10 Step 1).
 *   ② **4개 언어 전부** — 언어별 base 가 다르고(21,208~21,294자), 한국어만 보면 나머지 셋이
 *      조용히 깨진다.
 *   ③ **턴 조건 조합** — 카드 후속·재구성·날씨 후속처럼 규칙이 얹히는 분기가 실제로 얹히는가.
 *
 * ⚠️ **이 파일의 숫자는 "옳은 값"이 아니라 "지금 값"이다.** 프롬프트 문구를 의도적으로 고치면
 *    당연히 깨진다 — 그때는 숫자를 갱신하고 **커밋 메시지에 왜 바뀌었는지 적는다.**
 *    구조만 바꾸는 리팩터링에서 깨지면 그건 리팩터링이 아니다.
 */
import { createHash } from 'node:crypto';
import { HumanMessage } from '@langchain/core/messages';
import { assemblePrompt, resolveCardEntity, type AssemblyState } from '../server/agent/prompt-assembly.js';
import { getSystemInstruction, getRendererSections, getIntentPolicy } from '../server/agent/prompt.js';
import { hasVideoPart } from '../server/agent/video-turn.js';

/**
 * 의도·턴 골든이 보는 base — **두 게이트를 모두 켠 것**. 8단계 전과 바이트가 같아서
 * 골든 숫자를 그대로 비교할 수 있다. 🔴 선언은 **여기**여야 한다 — 아래에 두면
 * 55행에서 먼저 참조해 TDZ(`Cannot access 'FULL' before initialization`)로 죽는다.
 * tsc 는 이걸 안 잡는다(실측: 프로브의 `ARMS` 에서 같은 실수를 했다).
 */
const FULL = { videoTurn: true, sourceTurn: true };
import { buildMovieFollowupRules, buildMovieSearchRules } from '../server/agent/movie-followup.js';
import { buildReformatRules } from '../server/agent/reformat-rules.js';
import { buildDateLadderBlock, buildWeatherFollowupRules } from '../server/agent/weather-followup.js';
import { buildDisplayedCardRules } from '../server/agent/card-followup.js';
import type { LangName } from '../server/agent/lang.js';
import type { IntentType } from '../server/agent/state.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    if (ok) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 시각은 고정한다 — `new Date()` 를 쓰면 해시가 매 실행 달라져 하니스가 무의미해진다. */
const NOW = new Date('2026-09-24T10:00:00+09:00');
const TZ = 'Asia/Seoul';
const DATE_STR = '2026년 9월 24일 목요일 오전 10:00 KST';

const emptyState = (intent: IntentType): AssemblyState => ({
    intent, messages: [new HumanMessage('테스트 질문')],
    webContent: '', contextInfo: '', needsSearch: false,
    cardFollowup: '', cardContexts: {}, paperFollowup: false, reformatTurn: false,
    movieFollowup: false, movieSearchTurn: false, movieContext: '', weatherFollowup: false,
});

/**
 * 게이트를 **state 에서 유도한다** — 프로덕션(`route.ts`)이 하는 것과 같은 방식.
 *
 * 🔴 `FULL` 을 그대로 주면 안 된다. `emptyState` 는 `webContent: ''` 이므로 본문이 **없는** 턴인데
 *    base 에 본문 조항을 실으면 **실제로 나가지 않는 프롬프트**를 골든으로 박는 셈이다.
 *    골든은 진짜 턴을 찍어야 회귀를 잡는다.
 */
const baseFor = (state: AssemblyState, langName: LangName) => getSystemInstruction(langName, {
    sourceTurn: !!state.webContent,
    videoTurn: hasVideoPart(state.messages),
});

const build = (state: AssemblyState, langName: LangName = 'Korean') => assemblePrompt({
    base: baseFor(state, langName), state, langName,
    latestUserText: '테스트 질문', now: NOW, tz: TZ, currentDateStr: DATE_STR,
    cardEntity: { namedEntity: undefined, namedAddress: '' }, hospitalStatus: null,
});

// ── ① 계층별 해시 ────────────────────────────────────────────────────────────
console.log('── 계층별 골든 ──');
const langs: LangName[] = ['Korean', 'English', 'Spanish', 'French'];
const baseHashes = Object.fromEntries(langs.map(l => [l, sha(getSystemInstruction(l, FULL))]));
const baseLens = Object.fromEntries(langs.map(l => [l, getSystemInstruction(l, FULL).length]));
check('base 4개 언어가 모두 비어 있지 않다', langs.every(l => baseLens[l] > 10_000),
    JSON.stringify(baseLens));
check('base 언어별 해시가 서로 다르다 (언어 주입이 실제로 갈린다)',
    new Set(Object.values(baseHashes)).size === 4, JSON.stringify(baseHashes));

for (const intent of ['general', 'paper_search', 'weather'] as IntentType[]) {
    const r = sha(getRendererSections(intent, 'Korean'));
    const p = sha(getIntentPolicy(intent));
    console.log(`   ${intent.padEnd(14)} renderer=${r.slice(0, 8)} policy=${p.slice(0, 8)}`);
}

// ── ② 턴 조건이 실제로 얹히는가 ───────────────────────────────────────────────
console.log('\n── 턴 조건 주입 ──');
const plain = build(emptyState('general'));

const withReformat = build({ ...emptyState('general'), reformatTurn: true });
check('재구성 턴이 규칙을 얹는다', withReformat.includes('[재구성 요청 처리 규칙 — 이번 턴]'));
check('재구성 아닌 턴에는 없다', !plain.includes('[재구성 요청 처리 규칙 — 이번 턴]'));

const withPaper = build({ ...emptyState('paper_search'), paperFollowup: true });
check('논문 후속 턴이 규칙을 얹는다', withPaper.length > build(emptyState('paper_search')).length);

const withWeather = build({ ...emptyState('weather'), weatherFollowup: true });
check('날씨 후속 턴이 날짜 대응표를 얹는다', withWeather.includes('[날짜 대응표 — 이번 턴, 이 값이 정답입니다]'));
check('날짜 대응표는 고정 시각을 쓴다 (해시 안정)', build({ ...emptyState('weather'), weatherFollowup: true }) === withWeather);

const withCard = build({
    ...emptyState('general'), cardFollowup: 'pharmacy',
    cardContexts: { pharmacy: '```json:pharmacy\n{"count":1}\n```' },
});
check('카드 후속 턴이 카드 근거를 얹는다', withCard.includes('[DISPLAYED_CARD_SOURCE: pharmacy]'));
check('카드 없는 턴에는 없다', !plain.includes('[DISPLAYED_CARD_SOURCE'));

// ── ②-2 턴 빌더 계약 — **문구를 직접 검사한다** ────────────────────────────
// 인라인 리터럴이던 시절엔 소스 grep 밖에 없었고, 그건 문구가 이사하면 거짓으로 깨지고
// 문구가 바뀌어도 통과한다(2026-09-24 에 11건이 그렇게 깨졌다). 순수 함수로 빼면
// **하니스가 실물을 임포트해서** 본다 — tests/README §③ 이 요구하는 형태다.
console.log('\n── 턴 빌더 계약 ──');
const movieRules = buildMovieFollowupRules('CTX');
check('영화 후속: 상영표를 앞에 싣는다', movieRules.startsWith('CTX\n\n'));
check('영화 후속: 없는 정보를 지어내지 말라고 한다', movieRules.includes('절대 지어내지 마세요'));
check('영화 후속: 카드 재생성을 막는다', movieRules.includes('json:movie 카드 블록을 다시 생성하지 마세요'));
check('영화 검색: 화면 제목을 부정하지 못하게 한다',
    buildMovieSearchRules().includes('화면에 표시된 제목은 실재하는 상영작'));

const reformatRules = buildReformatRules();
check('재구성: 없던 항목 추가를 금지', reformatRules.includes('추가하지 마세요'));
check('재구성: 빈 칸을 기억으로 채우지 못하게 한다', reformatRules.includes('기억으로 채우지 마세요'));
// 🔴 실측 회귀(DEV_260815_DEPLOY_CHECK): 직전 턴이 빈 응답인데 표를 만들어냈다.
check('재구성: 원본이 없으면 없다고 말하게 한다', reformatRules.includes('재구성할 대상이 없다고 말하세요'));

check('날짜 대응표: 실제 날짜가 박힌다', buildDateLadderBlock(NOW, TZ).includes('2026-09-24'));
check('날짜 대응표: 모델이 직접 계산하지 못하게 한다',
    buildDateLadderBlock(NOW, TZ).includes('직접 날짜를 계산하지 마세요'));
check('날씨 후속: 카드 재생성을 막는다',
    buildWeatherFollowupRules().includes('json:weather` 블록을 다시 생성하지 마세요'));

const cardSearch = buildDisplayedCardRules({ kind: 'vet', cardContext: 'C', cardFacts: '', liveStatusSearch: true });
const cardPlain = buildDisplayedCardRules({ kind: 'vet', cardContext: 'C', cardFacts: '', liveStatusSearch: false });
check('카드 규칙: 검색 턴은 전화 확인을 강제', cardSearch.includes('방문 전 전화 확인이 필요하다'));
check('카드 규칙: 검색 아닌 턴은 추측을 금지', cardPlain.includes('추측하지 마세요'));
// 두 분기가 실제로 갈리는가 — 한쪽 문구가 다른 쪽에 새면 규칙이 무의미해진다.
check('카드 규칙: 두 분기가 섞이지 않는다',
    !cardPlain.includes('웹 검색 결과를 근거로 답할 수 있습니다') && cardSearch.includes('웹 검색 결과를 근거로 답할 수 있습니다'));

// ── ③ 렌더러 / 의도 경계 (Step 4) ───────────────────────────────────────────
// 경계 규칙: **의도 정책이 "json:X 를 만들어라"고 요구하면, 그 턴의 프롬프트에 X 의 스펙이
// 실려 있어야 한다.** 둘은 다른 파일(INTENT_POLICIES / INTENT_RENDERERS)에 살고
// 서로를 모른다 — 한쪽만 고치면 **모델에게 스키마 없이 블록을 만들라고 시키는** 상태가 된다.
// 조용히 깨지는 종류라(응답이 그럴듯한 오류 JSON 이 된다) 하니스로 건다.
console.log('\n── 렌더러/의도 경계 ──');
const ALL_INTENTS: IntentType[] = [
    'drug_id', 'drug_info', 'medical_qa', 'biology', 'chemistry', 'physics', 'astronomy',
    'data_viz', 'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa',
    'movie_search', 'sports', 'weather', 'paper_search', 'arxiv_search', 'general',
];
const orphans: string[] = [];
for (const intent of ALL_INTENTS) {
    const hint = getIntentPolicy(intent);
    const renderers = getRendererSections(intent, 'Korean');
    // 긍정 요구만 센다 — "Do NOT output json:physics" 는 스펙을 필요로 하지 않는다.
    const demanded = [...new Set(
        [...hint.matchAll(/(?:generate|output should be)\s+(?:a\s+)?json:(\w+)/g)].map(m => m[1]),
    )];
    for (const key of demanded) {
        if (!new RegExp(`json:${key}`, 'i').test(renderers)) orphans.push(`${intent} -> json:${key}`);
    }
}
check('요구한 렌더러의 스펙이 모두 실린다', orphans.length === 0, `스펙 없이 요구됨: ${orphans.join(', ')}`);

// `sports` 의 의도 정책이 0자인 것은 **누락이 아니라 배치**다(§10-3).
// 판정 근거: 그 의도에서만 참인 규칙(팀명 한국어 표기, `[NOT_DETERMINED]` 처리)은 존재하지만
// `worldcup-tool.ts` 가 **도구 결과에 실어 보낸다.** 프롬프트로 올리면 중복이 되고,
// 도구를 안 탄 턴에까지 규칙이 걸린다. 그래서 0자를 **고정한다** — 누가 채우면 여기서 깨지고,
// 그때 "도구 출력의 것과 중복 아닌가"를 반드시 되묻게 된다.
check('sports 의도 정책은 비어 있다 (규칙은 도구 출력에 산다)', getIntentPolicy('sports') === '');

// ── ④ 불변 계약 ──────────────────────────────────────────────────────────────
console.log('\n── 불변 계약 ──');
check('시각 블록이 맨 앞이다', plain.startsWith('[CURRENT_SYSTEM_TIME'));
// 🔴 이 순서가 계획의 A/B 대상이다(§7-1). 지금 값을 고정해 두고, 바꿀 때 의도적으로 깬다.
check('base 가 시각 블록 바로 뒤에 온다', plain.indexOf(getSystemInstruction('Korean', FULL).slice(0, 60)) > 0);
check('의도 정책이 마지막에 온다',
    plain.lastIndexOf(getIntentPolicy('general')) + getIntentPolicy('general').length === plain.length);
check('순수하다 — 같은 입력이면 같은 출력', build(emptyState('general')) === plain);

// ── ⑤ 골든 해시 — **찍기만 하면 골든이 아니다** ─────────────────────────────
// 🔴 초안은 해시를 출력만 했다. 그러면 프롬프트가 바뀌어도 **하니스는 초록이다** —
//    레포 규칙 그대로다: "통과하는 테스트는 공짜다. 실패할 수 있는 테스트만 값이 있다."
//    채취 2026-09-24, `prompt-assembly.ts` 분리 직후(PR1). 문구를 의도적으로 고쳤다면
//    이 표를 갱신하고 **커밋 메시지에 왜 바뀌었는지 적는다.**
console.log('\n── 골든 해시 ──');
// 🔴 2026-09-24(Step 4) 5개 -> **19개 전부**로 넓혔다. 5개만 박아 두면 6~8단계에서
//    `paper_search` 를 줄 단위로 가르거나 base 를 2분할할 때 **고정되지 않은 14개 의도가
//    조용히 달라진다** — 그게 바로 그 단계들이 건드리는 전역 블록이다.
//    넓히면서 기존 5개 값은 한 글자도 바뀌지 않았다(= 넓힘 자체는 무해).
// 🔴 2026-09-25(8단계): 전부 **-2,951자**(한국어) — 영상 분석 지시가 조건부가 되어 빠졌다.
//    감소폭이 19개 의도·6개 턴에서 **전부 동일**한 것이 "그 블록만 빠졌다"의 증거다.
//    영상 턴 base 는 바이트 동일하다(아래 BASE_GOLDEN).
const GOLDEN: Record<string, { len: number; sha: string }> = {
    drug_id:         { len: 22746, sha: '275096904c20951c' },
    drug_info:       { len: 23805, sha: '8943ff8a9547feb3' },
    medical_qa:      { len: 26670, sha: 'b2ed171db14a1aaf' },
    biology:         { len: 17656, sha: 'c455a502537a03b5' },
    chemistry:       { len: 20074, sha: 'f80c6f106cb7f51b' },
    physics:         { len: 22437, sha: '401b68f250305ad0' },
    astronomy:       { len: 18431, sha: '16b8271341fda0b0' },
    data_viz:        { len: 19762, sha: 'e23ec6cd3e95b06e' },
    pharmacy_search: { len: 16651, sha: '00a2819656e9f31c' },
    hospital_search: { len: 16345, sha: '4f64b6f9e8f58ccc' },
    vet_search:      { len: 16356, sha: '2c003755d6c94a30' },
    law_search:      { len: 17053, sha: '5172449026051100' },
    law_qa:          { len: 16809, sha: '9a9abd366c14519b' },
    movie_search:    { len: 16541, sha: 'd1966d6fa2d58497' },
    sports:          { len: 19508, sha: 'e6515af14afbdc9d' },
    weather:         { len: 17360, sha: '18ac4d393b5f77b1' },
    paper_search:    { len: 22556, sha: 'd16f8653e2e3896c' },
    arxiv_search:    { len: 20198, sha: '161606016c8f4cdc' },
    general:         { len: 19841, sha: '68dd6361956d4bba' },
};
// 의도가 늘었는데 골든을 안 박으면 하니스는 조용히 초록이다 — 개수 자체를 건다.
check('골든이 모든 의도를 덮는다', Object.keys(GOLDEN).length === ALL_INTENTS.length,
    `골든 ${Object.keys(GOLDEN).length}개 / 의도 ${ALL_INTENTS.length}개 — 누락: ${ALL_INTENTS.filter(i => !(i in GOLDEN)).join(', ')}`);
for (const [intent, want] of Object.entries(GOLDEN)) {
    const out = build(emptyState(intent as IntentType));
    const got = { len: out.length, sha: sha(out) };
    check(`골든  ${intent}`, got.len === want.len && got.sha === want.sha,
        `기대 ${want.len}자/${want.sha}\n     실제 ${got.len}자/${got.sha}`);
}

// 🔴 **턴 조건 골든** — 빈 턴만 고정하면 턴 규칙을 추출할 때 바이트 동일을 증명할 수 없다.
//    규칙이 얹힌 상태의 해시를 함께 박아야 "규칙을 파일로 옮겼을 뿐"이 검사된다(§10 Step 2).
const TURN_GOLDEN: Record<string, { state: AssemblyState; len: number; sha: string }> = {
    reformat: { state: { ...emptyState('general'), reformatTurn: true }, len: 20172, sha: 'ce77d4d966e251d4' },
    weatherFollowup: { state: { ...emptyState('weather'), weatherFollowup: true }, len: 18075, sha: '197c7e9573a98609' },
    paperFollowup: { state: { ...emptyState('paper_search'), paperFollowup: true }, len: 23246, sha: '854178f692080c58' },
    cardFollowup: {
        state: {
            ...emptyState('general'), cardFollowup: 'vet',
            cardContexts: { vet: '```json:vet\n{"count":1}\n```' },
        }, len: 20655, sha: '4b557f67b1fdefd2',
    },
    cardSearchTurn: {
        state: {
            ...emptyState('general'), cardFollowup: 'vet', needsSearch: true,
            cardContexts: { vet: '```json:vet\n{"count":1}\n```' },
        }, len: 20916, sha: '254344114e58ff36',
    },
    movieSearch: {
        state: {
            ...emptyState('general'), movieSearchTurn: true,
            movieContext: '현재 화면에 표시된 영화 상영시간표: 오디세이 / CGV 강남',
        }, len: 20478, sha: '4dd6dfc2d5510a00',
    },
};
for (const [name, want] of Object.entries(TURN_GOLDEN)) {
    const out = build(want.state);
    if (!want.sha) { console.log(`   (미고정) ${name.padEnd(16)} ${String(out.length).padStart(6)}자  ${sha(out)}`); continue; }
    check(`골든  turn/${name}`, out.length === want.len && sha(out) === want.sha,
        `기대 ${want.len}자/${want.sha}\n     실제 ${out.length}자/${sha(out)}`);
}

// 언어별 base 골든 — 한국어만 보면 나머지 셋이 조용히 깨진다.
//
// 🔴 8단계(2026-09-25)부터 base 는 **두 축으로 조건부**다:
//      `videoTurn`  = 영상 턴인가 (`isYoutubeRequest || hasVideoPart`)
//      `sourceTurn` = 이번 턴에 `[PROVIDED_SOURCE_TEXT]` 가 붙는가 (`!!state.webContent`)
//    `full`(둘 다 on) 숫자는 **8단계 이전 값 그대로**이며 한 자도 바꾸지 않았다 —
//    조건부화가 본문·영상이 있는 턴을 건드리지 않았다는 증거다.
//    🔴 이 4개 숫자가 바뀌면 그 턴들의 응답이 바뀐 것이다. 갱신 전에 이유를 확인한다.
// 🔴 자수만으로는 **줄 재배치를 못 잡는다** — M4 돌연변이에서 실측했다. `[PAPER INFO]` 줄을
//    아래로 옮겼더니 자수가 같아 114개가 전부 통과했다. 원인은 sha 를 가진 골든(의도·턴)이
//    전부 `webContent: ''` 여서 **`sourceTurn=true` base 를 아무도 sha 로 보지 않았던** 것이다.
//    그래서 4조합 × 4언어 전부 `자수/sha` 로 박는다.
const BASE_GOLDEN: Record<string, Record<'full' | 'video' | 'source' | 'plain', string>> = {
    Korean:  { full: '21208/5c2e063c4aafe0c9', video: '18826/1846927678476347', source: '17791/5fef38c127b32bc6', plain: '15409/6811d7bd1688934f' },
    English: { full: '21272/f991c13df28f925c', video: '18870/a9b4185f5370faf7', source: '17825/753b5489973de0e9', plain: '15423/9f67eff8e2447eb5' },
    Spanish: { full: '21280/3d5e32205c54674c', video: '18871/03f44ba8b8b603eb', source: '17829/fdf3cead96f023ec', plain: '15420/3a70607a117630e3' },
    French:  { full: '21294/0824b529cc2aa191', video: '18882/77acdc11a9d5dc87', source: '17834/07f5f410542d57a6', plain: '15422/bff4648f9ec483c9' },
};

/**
 * 게이트는 **줄을 빼기만 한다** — 더하거나 순서를 바꾸지 않는다.
 * 자수 골든은 이걸 못 잡는다(자리만 바꾸면 자수가 같다 — M1 돌연변이에서 실측).
 * 줄 부분수열 검사는 **누락·추가·재배치를 한 번에** 잡는다.
 */
const isLineSubsequence = (sub: string, sup: string) => {
    const a = sub.split('\n'), b = sup.split('\n');
    let i = 0;
    for (const line of b) { if (i < a.length && a[i] === line) i++; }
    return i === a.length;
};

for (const [lang, want] of Object.entries(BASE_GOLDEN)) {
    const L = lang as LangName;
    const variants = {
        full:   getSystemInstruction(L, FULL),
        video:  getSystemInstruction(L, { videoTurn: true }),
        source: getSystemInstruction(L, { sourceTurn: true }),
        plain:  getSystemInstruction(L),
    } as const;
    const NAME = { full: 'full(본문+영상)', video: '영상만', source: '본문만', plain: '둘 다 없음' } as const;

    for (const k of ['full', 'video', 'source', 'plain'] as const) {
        const got = `${variants[k].length}/${sha(variants[k])}`;
        check(`골든  base/${lang} ${NAME[k]}`, got === want[k], `기대 ${want[k]} / 실제 ${got}`);
    }

    // 🔴 게이트는 **빼기만** 한다 — 더하거나 순서를 바꾸지 않는다.
    for (const k of ['video', 'source', 'plain'] as const) {
        check(`base/${lang} ${NAME[k]} 은 full 의 줄 부분수열이다 (추가·재배치 없음)`,
            isLineSubsequence(variants[k], variants.full), '줄이 추가되었거나 순서가 바뀌었다');
    }

    check(`base/${lang} 영상 없으면 영상 블록도 영상 전략도 없다`,
        !variants.source.includes('[VIDEO ANALYSIS DIRECTIVE]') && !variants.source.includes('VIDEO ANALYSIS STRATEGY'));
    check(`base/${lang} 본문 없으면 본문 조항이 없다`,
        !variants.video.includes('If PROVIDED_SOURCE_TEXT contains "[URL_CONTENT]"') && !variants.video.includes("it's an Arxiv paper"));

    // 🔴 전역 규칙은 무엇을 끄든 **잃지 않는다.** 하나라도 빠지면 조건부화가 과했다.
    //    - 한 줄 요약 서식: "applies to EVERY analysis path alike" 라고 스스로 못 박은 규칙
    //    - 본문이 **없을 때** 무엇을 하라는 규칙(검색 폴백)은 없는 턴에서 가장 필요하다
    //    - 태그 누설 금지는 무결성 규칙이라 자수를 아끼려고 끄지 않았다
    for (const must of ['[ONE-LINE SUMMARY FORMAT]', '[ANTI-HALLUCINATION DIRECTIVE]', '[TOOL AVAILABILITY]',
        'NEVER mention internal context tag names', 'Do NOT use source-reference phrases', 'is missing, very short']) {
        check(`base/${lang} 둘 다 없어도 전역 유지 — ${must.slice(0, 34)}`, variants.plain.includes(must));
    }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
