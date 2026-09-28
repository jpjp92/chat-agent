/**
 * 9단계 Q2 선행 — **노출 구간 확인**(오프라인·무비용, PLAN §10-11).
 *
 * Q2 는 "Runtime Context(본문·카드) vs Turn Policy(턴 규칙)" 의 **순서**를 A/B 하려는 것이다.
 * 그런데 두 층이 **같은 턴에 함께 실리지 않으면 순서라는 변수 자체가 없다.**
 * → 실험을 설계하기 전에 공존 조합을 센다. 드물면 Q2 는 값이 없다.
 */
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { assemblePrompt, type AssemblyState } from '../../server/agent/prompt-assembly.js';
import { getSystemInstruction } from '../../server/agent/prompt.js';
import { buildEmptyCardRules, buildPaperFollowupRules, buildDisplayedCardRules } from '../../server/agent/card-followup.js';
import { buildWeatherFollowupRules } from '../../server/agent/weather-followup.js';
import { buildMovieFollowupRules } from '../../server/agent/movie-followup.js';
import { buildReformatRules } from '../../server/agent/reformat-rules.js';

const base = getSystemInstruction('Korean');
const empty: AssemblyState = {
    intent: 'general', messages: [new HumanMessage('질문')], webContent: '', contextInfo: '',
    needsSearch: false, cardFollowup: '', cardContexts: {}, paperFollowup: false,
    reformatTurn: false, movieFollowup: false, movieSearchTurn: false, movieContext: '',
    weatherFollowup: false,
} as AssemblyState;

const build = (patch: Partial<AssemblyState>) => assemblePrompt({
    base, langName: 'Korean', latestUserText: '질문',
    now: new Date('2026-09-28T14:00:00+09:00'), tz: 'Asia/Seoul',
    currentDateStr: '2026년 9월 28일 월요일 오후 2:00 KST',
    cardEntity: { namedEntity: undefined, namedAddress: '' }, hospitalStatus: null,
    state: { ...empty, ...patch } as AssemblyState,
});

/**
 * 🔴 표지를 **문자열 상수로 고르면 안 된다.** 처음엔 `'REFORMAT REQUEST'`·`'PAPER'` 로 잡았는데
 *    **base 에 이미 그 문자열이 있어** 모든 행이 참으로 나왔다(`일반` 조합까지). 골든이 아니라
 *    substring 매칭이라 조용히 통과한 것 — 길이·마커는 내용의 대리지표가 아니다(§10-2 계열).
 *    → **빌더의 실제 출력 첫 줄**을 표지로 쓰고, 그것이 **base 에는 없는지** 먼저 검증한다.
 */
const head = (text: string) => text.split('\n').find(l => l.trim())!.trim();

const RUNTIME: Array<readonly [string, string]> = [
    ['본문', '[PROVIDED_SOURCE_TEXT]'],
    ['화면 카드', head(buildDisplayedCardRules({ kind: 'paper', cardContext: 'X', cardFacts: '', liveStatusSearch: false } as any))],
];
const TURN: Array<readonly [string, string]> = [
    ['영화 후속', head(buildMovieFollowupRules('상영표'))],
    ['날씨 후속', head(buildWeatherFollowupRules())],
    ['빈 카드', head(buildEmptyCardRules())],
    ['논문 후속', head(buildPaperFollowupRules())],
    ['재구성', head(buildReformatRules())],
];

// 🔴 선행 검증: 표지가 base 에 이미 있으면 그 표지는 못 쓴다.
const contaminated = [...RUNTIME, ...TURN].filter(([, m]) => base.includes(m));
if (contaminated.length > 0) {
    console.error('🔴 표지가 base 와 겹친다 — 이 표지로는 공존을 셀 수 없다:');
    for (const [n, m] of contaminated) console.error(`   ${n}: ${JSON.stringify(m.slice(0, 60))}`);
    process.exit(1);
}
console.log(`표지 ${RUNTIME.length + TURN.length}개, base 오염 없음 ✅\n`);

const layers = (text: string) => ({
    rc: RUNTIME.filter(([, m]) => text.includes(m)).map(([n]) => n),
    tp: TURN.filter(([, m]) => text.includes(m)).map(([n]) => n),
});

const emptyCardMsg = new ToolMessage({ content: '```json:paper\n{"papers":[]}\n```', tool_call_id: 't' });
const cases: Array<[string, Partial<AssemblyState>]> = [
    ['일반', {}],
    ['URL 요약(본문만)', { webContent: '기사 본문' }],
    ['논문 후속(카드만)', { paperFollowup: true }],
    ['🔴 본문 + 논문 후속', { webContent: '기사 본문', paperFollowup: true }],
    ['재구성', { reformatTurn: true }],
    ['🔴 본문 + 재구성', { webContent: '기사 본문', reformatTurn: true }],
    ['날씨 후속', { weatherFollowup: true }],
    ['🔴 본문 + 날씨 후속', { webContent: '기사 본문', weatherFollowup: true }],
    ['영화 후속', { movieFollowup: true, movieContext: '상영표' }],
    ['🔴 본문 + 영화 후속', { webContent: '기사 본문', movieFollowup: true, movieContext: '상영표' }],
    ['빈 카드', { messages: [new HumanMessage('q'), emptyCardMsg] }],
    ['🔴 본문 + 빈 카드', { webContent: '기사 본문', messages: [new HumanMessage('q'), emptyCardMsg] }],
    ['화면 카드(논문)', { cardContexts: { paper: '논문 카드 문맥' }, cardFollowup: 'paper' }],
    ['🔴 화면 카드 + 논문 후속', { cardContexts: { paper: '논문 카드 문맥' }, cardFollowup: 'paper', paperFollowup: true }],
    ['🔴 화면 카드 + 재구성', { cardContexts: { paper: '논문 카드 문맥' }, cardFollowup: 'paper', reformatTurn: true }],
];

let both = 0;
console.log('조합                          Runtime Context            Turn Policy               공존');
console.log('─'.repeat(96));
for (const [name, patch] of cases) {
    const { rc, tp } = layers(build(patch));
    const co = rc.length > 0 && tp.length > 0;
    if (co) both++;
    console.log(`${name.padEnd(28)}  ${(rc.join(',') || '—').padEnd(24)}  ${(tp.join(',') || '—').padEnd(24)}  ${co ? '✅' : '·'}`);
}
console.log(`\n공존 조합 ${both}/${cases.length}`);
console.log(both === 0
    ? '\n🔴 두 층이 함께 실리는 조합이 없다 → **Q2 는 값이 없다. 실험을 취소한다.**'
    : `\n→ 공존이 ${both}건 있다. Q2 의 팔은 이 조합 중에서 고른다(날짜 팔 재활용 금지).`);
