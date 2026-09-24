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

const build = (state: AssemblyState, langName: LangName = 'Korean') => assemblePrompt({
    base: getSystemInstruction(langName), state, langName,
    latestUserText: '테스트 질문', now: NOW, tz: TZ, currentDateStr: DATE_STR,
    cardEntity: { namedEntity: undefined, namedAddress: '' }, hospitalStatus: null,
});

// ── ① 계층별 해시 ────────────────────────────────────────────────────────────
console.log('── 계층별 골든 ──');
const langs: LangName[] = ['Korean', 'English', 'Spanish', 'French'];
const baseHashes = Object.fromEntries(langs.map(l => [l, sha(getSystemInstruction(l))]));
const baseLens = Object.fromEntries(langs.map(l => [l, getSystemInstruction(l).length]));
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
check('base 가 시각 블록 바로 뒤에 온다', plain.indexOf(getSystemInstruction('Korean').slice(0, 60)) > 0);
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
const GOLDEN: Record<string, { len: number; sha: string }> = {
    drug_id:         { len: 28545, sha: '8be539e187e1bf7c' },
    drug_info:       { len: 29604, sha: '787e99ac5fac9f09' },
    medical_qa:      { len: 32469, sha: 'aaf359e69a1fe045' },
    biology:         { len: 23455, sha: '5c5277b18c24a645' },
    chemistry:       { len: 25873, sha: '26a75127eb7d4bb1' },
    physics:         { len: 28236, sha: '209ec3352abf4e48' },
    astronomy:       { len: 24230, sha: 'fe887f4aa5fb9623' },
    data_viz:        { len: 25561, sha: '08cea0b72a8ed1f5' },
    pharmacy_search: { len: 22450, sha: 'd63e5b9f2e047d27' },
    hospital_search: { len: 22144, sha: 'a4a7cf86a9ab0ad7' },
    vet_search:      { len: 22155, sha: 'a1c1de7a5565cfc2' },
    law_search:      { len: 22852, sha: 'bdf549f1a3fcdf46' },
    law_qa:          { len: 22608, sha: '36d7d5860bf7405d' },
    movie_search:    { len: 22340, sha: 'da36027b57ea81c3' },
    sports:          { len: 25307, sha: '19be0ed1e2887f82' },
    weather:         { len: 23159, sha: '04c21be30012ecf9' },
    paper_search:    { len: 28355, sha: 'e950bc5a7f73c365' },
    arxiv_search:    { len: 25997, sha: '36fbf81403237bb6' },
    general:         { len: 25640, sha: '1d9e0175597739a7' },
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
    reformat: { state: { ...emptyState('general'), reformatTurn: true }, len: 25971, sha: '88a12fe7f9e99bd4' },
    weatherFollowup: { state: { ...emptyState('weather'), weatherFollowup: true }, len: 23874, sha: '8ba507f3e704a8aa' },
    paperFollowup: { state: { ...emptyState('paper_search'), paperFollowup: true }, len: 29045, sha: '148e7031e8779bec' },
    cardFollowup: {
        state: {
            ...emptyState('general'), cardFollowup: 'vet',
            cardContexts: { vet: '```json:vet\n{"count":1}\n```' },
        }, len: 26454, sha: '0d0a0027e755ca59',
    },
    cardSearchTurn: {
        state: {
            ...emptyState('general'), cardFollowup: 'vet', needsSearch: true,
            cardContexts: { vet: '```json:vet\n{"count":1}\n```' },
        }, len: 26715, sha: '07101655cd9d8f33',
    },
    movieSearch: {
        state: {
            ...emptyState('general'), movieSearchTurn: true,
            movieContext: '현재 화면에 표시된 영화 상영시간표: 오디세이 / CGV 강남',
        }, len: 26277, sha: '9951b680616e8fb6',
    },
};
for (const [name, want] of Object.entries(TURN_GOLDEN)) {
    const out = build(want.state);
    if (!want.sha) { console.log(`   (미고정) ${name.padEnd(16)} ${String(out.length).padStart(6)}자  ${sha(out)}`); continue; }
    check(`골든  turn/${name}`, out.length === want.len && sha(out) === want.sha,
        `기대 ${want.len}자/${want.sha}\n     실제 ${out.length}자/${sha(out)}`);
}

// 언어별 base 골든 — 한국어만 보면 나머지 셋이 조용히 깨진다.
const BASE_GOLDEN: Record<string, number> = {
    Korean: 21208, English: 21272, Spanish: 21280, French: 21294,
};
for (const [lang, len] of Object.entries(BASE_GOLDEN)) {
    check(`골든  base/${lang}`, getSystemInstruction(lang as LangName).length === len,
        `기대 ${len}자 / 실제 ${getSystemInstruction(lang as LangName).length}자`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
