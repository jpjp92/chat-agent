// tests/test-search-policy.mts
//
// 검색 판정 재설계(증거→정책 2단 분리) 테스트 하니스.
// 기획: docs/plans/PLAN_SEARCH_POLICY_260815.md
// 진단: docs/logs/2026/08/DEV_260815.md
//
// 실행: npx tsx tests/test-search-policy.mts     (API 키 불필요 — 판정은 전부 결정론)
//
// ⚠️ 설계 원칙: 정규식을 이 파일에 복사하지 않는다. 프로덕션 모듈을 직접 import한다.
//    scripts/test-search-rules.mjs 는 정규식을 복사해 둔 탓에, 프로덕션이 바뀐 뒤에도
//    22/22 초록을 유지하며 드리프트를 숨겼다(기획 §4 C5). 같은 실수를 반복하지 않는다.
//
// 구성:
//   Part A — 현행 파이프라인 회귀. 지금 실행하면 버그 케이스가 RED로 뜬다(정상).
//   Part B — 정책 엔진 계약 테스트. search-policy.ts 구현 전에는 SKIP, 구현되면 자동 활성.

import {
    classifySearchNeed,
    detectExplicitSearchRequest,
} from '../server/agent/intentRules.js';
import { collectTextSearchSignals } from '../server/agent/search-signals.js';
import { decideSearch } from '../server/agent/search-policy.js';

// ============================================================
// general 경로의 실효 판정 — 프로덕션 함수를 그대로 실행한다
//   router.ts   needsSearch = rule on→true / off→false / gray→(LLM ?? true)
//   search-gate → collectTextSearchSignals() → decideSearch()   ← 아래와 동일 경로
//   ※ LLM은 이 하니스 범위 밖 → 최악조건인 "판정 없음(=default-on)"으로 고정.
//     LLM이 무료티어 503으로 실패하는 실제 상황과 같다.
//   ※ 컨텍스트 증거(멀티모달·URL·문서)는 messages가 필요하므로 여기 범위 밖.
// ============================================================
const currentEffectiveSearch = (text: string, prevSearched: boolean): boolean => {
    const rule = classifySearchNeed(text);
    const needsSearch = rule === 'on' ? true : rule === 'off' ? false : true; // gray → default-on
    const signals = collectTextSearchSignals({
        latestUserText: text,
        prevSearched,
        needsSearch,
        isGeneralIntent: true,
    });
    return decideSearch(signals).useGoogleSearch;
};

type Case = {
    grp: string;
    msg: string;
    prevSearched: boolean;
    want: boolean;
    why: string;
};

const CASES: Case[] = [
    // ── 🔴 이번 버그 (RED 예상) ────────────────────────────────────────────
    // 공통 구조: 새 검색 요구 + "정리/비교" 같은 가공 어휘 동반 → 가드가 오발한다.
    {
        grp: 'BUG', msg: '그럼 모티프 모델 구체적으로 찾아서 정리해보자',
        prevSearched: true, want: true,
        why: '실사용 재현. "찾아서"=새 검색 요구인데 "정리"에 걸려 억제됨',
    },
    {
        grp: 'BUG', msg: '검색해서 정리해줘',
        prevSearched: true, want: true,
        why: '명시적 검색 요청. 시스템이 뒤집을 권리 없음(tier 300)',
    },
    {
        grp: 'BUG', msg: '출처 찾아서 정리해줘',
        prevSearched: true, want: true,
        why: '출처 요구는 grounding 없이 충족 불가',
    },
    {
        grp: 'BUG', msg: '구글에 찾아보고 비교해줘',
        prevSearched: true, want: true,
        why: '"구글"·"찾아보"를 explicit 정규식이 아예 못 잡음',
    },

    // ── 🟡 정규식 갭 (explicit 미포착) ────────────────────────────────────
    // prevSearched=false라 가드가 안 걸려 default-on으로 "우연히" 통과한다.
    // 즉 지금 GREEN인 것은 explicit이 동작해서가 아니다 — 안전판에 기대고 있을 뿐.
    { grp: 'GAP', msg: '모티프 모델 찾아줘', prevSearched: false, want: true, why: '"찾아줘"(붙여쓰기) 미포착' },
    { grp: 'GAP', msg: '모티프 모델 조사해줘', prevSearched: false, want: true, why: '"조사" 미포착' },
    { grp: 'GAP', msg: 'AI 모델 알아보자', prevSearched: false, want: true, why: '"알아보자" 미포착' },

    // ── ✅ 멀티턴 가드 정상 동작 (회귀 방어 — 반드시 유지) ──────────────
    { grp: 'GUARD', msg: '방금 알려준 거 표로 정리해줘', prevSearched: true, want: false, why: '순수 가공형 — 재검색 불필요' },
    { grp: 'GUARD', msg: '아까 검색 결과 다시 요약', prevSearched: true, want: false, why: '과거참조' },
    { grp: 'GUARD', msg: '기존개념부터 최근 검색한 내용 비교 요약해줘', prevSearched: true, want: false, why: '과거참조("최근 검색한")' },
    { grp: 'GUARD', msg: '아까보다 더 최신 걸로 다시 알려줘', prevSearched: true, want: true, why: '새 최신요구 — 억제하면 안 됨' },
    { grp: 'GUARD', msg: '방금 알려준 거 정리해줘', prevSearched: false, want: true, why: '직전 검색 없었으면 억제 안 함' },

    // ── ✅ 강한 OFF (회귀 방어) ───────────────────────────────────────────
    { grp: 'OFF', msg: '퀵소트 알고리즘 파이썬으로 구현해줘', prevSearched: false, want: false, why: '코드 생성' },
    { grp: 'OFF', msg: '이 문장 영어로 번역해줘', prevSearched: false, want: false, why: '번역' },
    { grp: 'OFF', msg: '정중한 사과 이메일 작성해줘', prevSearched: false, want: false, why: '창작' },
    { grp: 'OFF', msg: '123 곱하기 456은?', prevSearched: false, want: false, why: '계산' },

    // ── ✅ 강한 ON (회귀 방어) ────────────────────────────────────────────
    { grp: 'ON', msg: '오늘 서울 날씨 어때?', prevSearched: false, want: true, why: 'temporal + domain' },
    { grp: 'ON', msg: '지금 비트코인 가격 얼마야?', prevSearched: false, want: true, why: '실시간 시세' },
    { grp: 'ON', msg: '현재 대한민국 대통령이 누구야?', prevSearched: false, want: true, why: '인물 근황' },
];

// ============================================================
// Part A — 현행 회귀
// ============================================================
console.log('='.repeat(72));
console.log('Part A — 현행 파이프라인 회귀 (프로덕션 intentRules 직접 import)');
console.log('='.repeat(72));

const failures: Case[] = [];
const byGroup = new Map<string, { pass: number; total: number }>();

for (const c of CASES) {
    const got = currentEffectiveSearch(c.msg, c.prevSearched);
    const ok = got === c.want;
    if (!ok) failures.push(c);

    const g = byGroup.get(c.grp) ?? { pass: 0, total: 0 };
    g.total++;
    if (ok) g.pass++;
    byGroup.set(c.grp, g);

    const mark = ok ? '✅' : '❌';
    const prev = c.prevSearched ? 'prev=검색됨' : 'prev=없음';
    console.log(`${mark} [${c.grp}] want=${c.want ? 'ON ' : 'OFF'} got=${got ? 'ON ' : 'OFF'} (${prev}) | ${c.msg}`);
    if (!ok) console.log(`      └─ ${c.why}`);
}

console.log('\n--- 그룹별 ---');
for (const [grp, g] of byGroup) {
    const pct = Math.round((g.pass / g.total) * 100);
    console.log(`${grp.padEnd(6)}: ${g.pass}/${g.total} (${pct}%)`);
}
const passed = CASES.length - failures.length;
console.log(`TOTAL : ${passed}/${CASES.length}`);

// 회귀 그룹(GUARD/OFF/ON)은 지금도 GREEN이어야 한다. 여기가 깨지면 판단 기준이 무너진 것.
const regressionFailures = failures.filter(f => ['GUARD', 'OFF', 'ON'].includes(f.grp));
const bugFailures = failures.filter(f => ['BUG', 'GAP'].includes(f.grp));

console.log('\n--- 해석 ---');
if (regressionFailures.length > 0) {
    console.log(`🔴 회귀 ${regressionFailures.length}건 — 기존 동작이 깨졌다. 먼저 확인할 것.`);
    for (const f of regressionFailures) console.log(`   · [${f.grp}] ${f.msg}`);
}
if (bugFailures.length > 0) {
    console.log(`🔴 미해결 결함 ${bugFailures.length}건 — 재설계(tier 300 신설)로 해소 예정. 구현 전에는 RED가 정상.`);
} else {
    console.log('🟢 결함 케이스 전부 해소됨.');
}

// ============================================================
// Part A2 — detectExplicitSearchRequest 단위 (기획 Step 2)
//   이 함수가 tier 300 신호를 낼지 말지를 혼자 결정한다. 오탐 하나가 멀티턴 가드를
//   통째로 무력화하므로("아까 검색 결과 다시 요약"이 YES면 재검색 폭주) 양방향으로 조인다.
// ============================================================
console.log('\n' + '='.repeat(72));
console.log('Part A2 — 명시 검색 요청 탐지 (단일 출처)');
console.log('='.repeat(72));

const EXPLICIT_CASES: Array<[string, boolean, string]> = [
    // 잡아야 하는 것 — 기존 좁은 정규식이 놓치던 어형
    ['그럼 모티프 모델 구체적으로 찾아서 정리해보자', true, '실사용 결함 재현'],
    ['검색해서 정리해줘', true, '명시 요청'],
    ['출처 찾아서 정리해줘', true, '출처 요구'],
    ['구글에 찾아보고 비교해줘', true, '"구글"·"찾아보"'],
    ['모티프 모델 찾아줘', true, '"찾아줘" 붙여쓰기'],
    ['모티프 모델 조사해줘', true, '"조사해"'],
    ['AI 모델 알아보자', true, '"알아보자"'],
    // 잡으면 안 되는 것 — 과거참조는 새 요청이 아니다
    ['방금 알려준 거 표로 정리해줘', false, '가공형 — "알려"는 검색어가 아님'],
    ['아까 검색 결과 다시 요약', false, '🔴 과거참조. YES면 가드가 무력화된다'],
    ['기존개념부터 최근 검색한 내용 비교 요약해줘', false, '🔴 과거참조'],
    ['아까보다 더 최신 걸로 다시 알려줘', false, '시의성 신호지 명시 요청이 아님(tier 100 담당)'],
    ['퀵소트 알고리즘 파이썬으로 구현해줘', false, '코드'],
    ['이 문장 영어로 번역해줘', false, '번역'],
    ['정중한 사과 이메일 작성해줘', false, '창작'],
    ['123 곱하기 456은?', false, '계산'],
    ['오늘 서울 날씨 어때?', false, '시의성 ON이지만 명시 요청은 아님'],
];

let expPass = 0;
for (const [msg, want, why] of EXPLICIT_CASES) {
    const got = detectExplicitSearchRequest(msg);
    const ok = got === want;
    if (ok) expPass++;
    console.log(`${ok ? '✅' : '❌'} want=${want ? 'YES' : 'NO '} got=${got ? 'YES' : 'NO '} | ${msg}`);
    if (!ok) console.log(`      └─ ${why}`);
}
console.log(`\n명시요청 탐지: ${expPass}/${EXPLICIT_CASES.length}`);
if (expPass !== EXPLICIT_CASES.length) process.exitCode = 1;

// ============================================================
// Part B — 정책 엔진 계약 테스트 (구현 전에는 SKIP)
// ============================================================
console.log('\n' + '='.repeat(72));
console.log('Part B — 정책 엔진 계약 (search-policy.ts)');
console.log('='.repeat(72));

type Tier = number;
const TIER: Record<string, Tier> = {
    HARD_CONSTRAINT: 400,
    USER_EXPLICIT: 300,
    CONTEXT_GROUNDED: 200,
    CLASSIFIER: 100,
    DEFAULT: 0,
};

// 계층 우선순위가 실제로 지켜지는지 — 신호 조합만으로 검증한다(텍스트 무관).
const CONTRACT = [
    {
        name: '물리 제약(400)이 사용자 명시 요청(300)을 이긴다',
        signals: [
            { tier: TIER.HARD_CONSTRAINT, verdict: 'off', source: 'multimodal' },
            { tier: TIER.USER_EXPLICIT, verdict: 'on', source: 'user-explicit' },
        ],
        want: false,
    },
    {
        name: '사용자 명시 요청(300)이 문서 컨텍스트(200)를 이긴다',
        signals: [
            { tier: TIER.USER_EXPLICIT, verdict: 'on', source: 'user-explicit' },
            { tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'doc-content' },
        ],
        want: true,
    },
    {
        name: '★ 사용자 명시 요청(300)이 멀티턴 가드(100)를 이긴다 — 이번 버그',
        signals: [
            { tier: TIER.USER_EXPLICIT, verdict: 'on', source: 'user-explicit' },
            { tier: TIER.CLASSIFIER, verdict: 'off', source: 'followup-guard' },
        ],
        want: true,
    },
    {
        name: 'URL 컨텍스트(200)가 분류기 판정(100)을 이긴다',
        signals: [
            { tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'url-content' },
            { tier: TIER.CLASSIFIER, verdict: 'on', source: 'router-llm' },
        ],
        want: false,
    },
    {
        name: '신호가 기본값뿐이면 default-on',
        signals: [{ tier: TIER.DEFAULT, verdict: 'on', source: 'default' }],
        want: true,
    },
    {
        // ⚠️ 처음엔 "rule-on이 이긴다"로 적었다가 뒤집었다.
        // 가드의 존재 이유가 바로 이것이다 — "최근 검색한 내용 요약해줘"는 "최근" 때문에
        // rule이 temporal ON을 내지만, 실제로는 과거참조다. 가드가 rule을 정정하지 못하면
        // 가드가 무의미해지고 기존 회귀(GUARD 그룹)가 깨진다.
        // 이번 버그를 막는 건 동 tier 순서가 아니라 tier 300(USER_EXPLICIT)이다.
        name: '동 tier 충돌: followup-guard가 rule-on을 이긴다(과거참조 정정)',
        signals: [
            { tier: TIER.CLASSIFIER, verdict: 'on', source: 'rule' },
            { tier: TIER.CLASSIFIER, verdict: 'off', source: 'followup-guard' },
        ],
        want: false,
    },
    {
        name: '동 tier 충돌: rule이 router-llm을 이긴다(강한 룰 우선)',
        signals: [
            { tier: TIER.CLASSIFIER, verdict: 'off', source: 'rule' },
            { tier: TIER.CLASSIFIER, verdict: 'on', source: 'router-llm' },
        ],
        want: false,
    },
];

let policyMod: any = null;
try {
    policyMod = await import('../server/agent/search-policy.js');
} catch {
    policyMod = null;
}

if (!policyMod?.decideSearch) {
    console.log('⏭  SKIP — server/agent/search-policy.ts 미구현 (기획 Step 3).');
    console.log(`   구현 후 계약 ${CONTRACT.length}건이 자동 활성됩니다.`);
} else {
    let cPass = 0;
    for (const t of CONTRACT) {
        const got = policyMod.decideSearch(t.signals).useGoogleSearch;
        const ok = got === t.want;
        if (ok) cPass++;
        console.log(`${ok ? '✅' : '❌'} want=${t.want ? 'ON ' : 'OFF'} got=${got ? 'ON ' : 'OFF'} | ${t.name}`);
    }
    console.log(`\n계약: ${cPass}/${CONTRACT.length}`);
    if (cPass !== CONTRACT.length) process.exitCode = 1;
}

// ============================================================
// Part C — 게이트 통합 회귀 (decideGoogleSearch 직접 호출)
//   Step 4에서 실제로 바뀐 곳이 여기다. 기획 §5의 "보존해야 할 동작" 목록을 그대로 케이스화한다.
//   Part A는 텍스트 신호만 본다 — 컨텍스트 증거(멀티모달·URL·영상·문서·렌더러)는 여기서만 검증된다.
// ============================================================
console.log('\n' + '='.repeat(72));
console.log('Part C — 게이트 통합 회귀 (컨텍스트 증거 포함)');
console.log('='.repeat(72));

const { decideGoogleSearch } = await import('../server/agent/nodes/search-gate.js');

const human = (text: string, parts: any[] = []) => ({
    _getType: () => 'human',
    content: [{ type: 'text', text }, ...parts],
});
const ai = (text: string) => ({ _getType: () => 'ai', content: [{ type: 'text', text }] });
// 🔴 production 의 state.messages 에는 `inlineData` 가 **없다** — buildHistoryMessages 는
//    인라인 이미지를 `type:'image_url'`(data: URI) 로 만든다(history.ts). 예전 픽스처가
//    `inlineData` 였던 탓에, 죽은 `historyHasImage` 신호가 초록을 유지하고 있었다(DEV_260902 §9.4).
const IMAGE_PART = { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } };

type GateCase = {
    name: string;
    want: boolean;
    ctx: Partial<Parameters<typeof decideGoogleSearch>[0]> & { latestUserText: string };
};

const base = {
    webContent: '',
    messages: [] as any[],
    intent: 'general',
    needsSearch: true,
    hasMultimodalContent: false,
    dropImageForSearch: false,
    isYoutubeRequest: false,
    hasVideoData: false,
};

const GATE_CASES: GateCase[] = [
    {
        name: '멀티모달(400)은 명시 요청(300)도 이긴다 — API 물리 제약',
        want: false,
        ctx: { hasMultimodalContent: true, latestUserText: '검색해서 알려줘', messages: [human('검색해서 알려줘')] },
    },
    {
        // production 은 히스토리에 이미지가 남아 있으면 buildSdkContents 가 hasMultimodalContent=true 를
        // 낸다 — 하니스는 그 체인을 건너뛰므로 같은 값을 직접 준다.
        name: '히스토리 이미지 → off (multimodal 신호로)',
        want: false,
        ctx: { hasMultimodalContent: true, messages: [human('이 사진 뭐야', [IMAGE_PART]), ai('...'), human('표로 정리해줘')], latestUserText: '표로 정리해줘' },
    },
    {
        // 가드가 서면 generator 가 forceTextOnly 로 미디어를 빼므로 hasMultimodalContent 도 false 가 된다.
        name: 'dropImageForSearch=true면 히스토리 이미지 신호 없음',
        want: true,
        ctx: { dropImageForSearch: true, messages: [human('이 사진 뭐야', [IMAGE_PART]), ai('...'), human('오늘 날씨는?')], latestUserText: '오늘 날씨는?' },
    },
    {
        name: 'YouTube + transcript → off',
        want: false,
        ctx: { isYoutubeRequest: true, webContent: '[TRANSCRIPT] ...', messages: [human('이 영상 요약해줘')], latestUserText: '이 영상 요약해줘' },
    },
    {
        name: 'YouTube 2턴 + VIDEO_ANALYSIS_SUMMARY → off',
        want: false,
        ctx: { isYoutubeRequest: true, webContent: '[VIDEO_ANALYSIS_SUMMARY] ...', messages: [human('핵심만 정리해줘')], latestUserText: '핵심만 정리해줘' },
    },
    {
        name: 'URL_CONTENT → off',
        want: false,
        ctx: { webContent: '[URL_CONTENT: ...]', messages: [human('요약해줘')], latestUserText: '요약해줘' },
    },
    {
        name: '현재 메시지에 non-YT URL → off',
        want: false,
        ctx: { messages: [human('https://example.com/a 요약해줘')], latestUserText: 'https://example.com/a 요약해줘' },
    },
    {
        name: 'Fix A: history URL + 가공형 follow-up → off',
        want: false,
        ctx: { messages: [human('https://example.com/a 요약'), ai('...'), human('그거 표로 정리해줘')], latestUserText: '그거 표로 정리해줘' },
    },
    {
        name: 'Fix A: history URL + 새 검색 질의 → on (영구 억제 금지)',
        want: true,
        ctx: { messages: [human('https://example.com/a 요약'), ai('...'), human('오늘 환율 얼마야?')], latestUserText: '오늘 환율 얼마야?' },
    },
    {
        name: 'renderer intent → off (구조화 출력 보존)',
        want: false,
        ctx: { intent: 'astronomy', messages: [human('오리온자리 보여줘')], latestUserText: '오리온자리 보여줘' },
    },
    {
        name: 'renderer intent + 명시 검색 요청 → on',
        want: true,
        ctx: { intent: 'astronomy', messages: [human('오리온자리 최신 관측 검색해서 알려줘')], latestUserText: '오리온자리 최신 관측 검색해서 알려줘' },
    },
    {
        name: '첨부 문서 → off',
        want: false,
        ctx: { webContent: '[EXTRACTED_CONTENT: ...]', messages: [human('이 문서 요약해줘')], latestUserText: '이 문서 요약해줘' },
    },
    {
        name: '이전 업로드 문서(후속 턴) → off',
        want: false,
        ctx: { webContent: '[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT: ...]', messages: [human('3장만 정리해줘')], latestUserText: '3장만 정리해줘' },
    },
    {
        name: '첨부 문서 + 외부 검증 명시 요청 → on',
        want: true,
        ctx: { webContent: '[EXTRACTED_CONTENT: ...]', messages: [human('이 문서 내용 검색해서 검증해줘')], latestUserText: '이 문서 내용 검색해서 검증해줘' },
    },
    {
        name: 'medical_qa → 강제 on',
        want: true,
        ctx: { intent: 'medical_qa', needsSearch: false, messages: [human('타이레놀 부작용 알려줘')], latestUserText: '타이레놀 부작용 알려줘' },
    },
    {
        name: 'medical_qa + 이미지 → off (API 제약 우선)',
        want: false,
        ctx: { intent: 'medical_qa', hasMultimodalContent: true, messages: [human('이 약 뭐야')], latestUserText: '이 약 뭐야' },
    },
    {
        name: 'general + 라우터 off → off',
        want: false,
        ctx: { needsSearch: false, messages: [human('퀵소트 구현해줘')], latestUserText: '퀵소트 구현해줘' },
    },
    {
        name: '★ 실사용 결함: 직전 턴 검색됨 + "찾아서 정리" → on',
        want: true,
        ctx: {
            messages: [human('오늘 AI 뉴스 알려줘'), ai('...'), human('그럼 모티프 모델 구체적으로 찾아서 정리해보자')],
            latestUserText: '그럼 모티프 모델 구체적으로 찾아서 정리해보자',
        },
    },
    {
        name: '멀티턴 가드 보존: 직전 턴 검색됨 + 순수 가공형 → off',
        want: false,
        ctx: {
            messages: [human('오늘 AI 뉴스 알려줘'), ai('...'), human('방금 알려준 거 표로 정리해줘')],
            latestUserText: '방금 알려준 거 표로 정리해줘',
        },
    },
];

// ── Step 6: lastTurnSearched(실제 검색 여부) 우선 · 근사 폴백 ─────────────────
// 핵심 결함: medical_qa는 tier로 검색이 강제되므로 직전 발화 정규식은 gray를 낸다.
//   → 근사 prevSearched=false → 가공형 후속에 가드가 아예 서지 못했다.
GATE_CASES.push(
    {
        name: '★ Step6: medical_qa 뒤 가공형 후속 — lastTurnSearched=true면 억제',
        want: false,
        ctx: {
            lastTurnSearched: true,
            messages: [human('인공타액제 알려줘'), ai('...'), human('표로 정리해줘')],
            latestUserText: '표로 정리해줘',
        } as any,
    },
    {
        name: 'Step6 대조: 같은 대화에서 lastTurnSearched 없으면 근사가 놓친다(기존 결함)',
        want: true,
        ctx: {
            messages: [human('인공타액제 알려줘'), ai('...'), human('표로 정리해줘')],
            latestUserText: '표로 정리해줘',
        },
    },
    {
        name: 'Step6: 직전 턴 검색 없었으면(lastTurnSearched=false) 억제하지 않는다',
        want: true,
        ctx: {
            lastTurnSearched: false,
            messages: [human('오늘 AI 뉴스 알려줘'), ai('...'), human('표로 정리해줘')],
            latestUserText: '표로 정리해줘',
        } as any,
    },
    {
        name: 'Step6: 명시 요청(300)은 lastTurnSearched=true도 이긴다',
        want: true,
        ctx: {
            lastTurnSearched: true,
            messages: [human('인공타액제 알려줘'), ai('...'), human('검색해서 정리해줘')],
            latestUserText: '검색해서 정리해줘',
        } as any,
    },
);

// ── Step 7: provider 인지 — TIER 400 은 Gemini 의 제약이다 ────────────────────
// 🔴 실사용 결함(2026-09-02, GPT-5.4 mini): 앞 턴에 이미지를 붙인 대화에서
//   "저기 저장소 검색해서 확인해봐" 에 검색이 안 붙어 "실시간 검색 없이 답할 수 있어요" 가 나왔다.
//   400 은 "Gemini 는 이미지와 grounding 을 함께 못 보낸다" 는 **물리 사실**인데,
//   OpenAI Responses 는 input_image 와 web_search 를 같이 보낸다 — 없는 제약에 눌린 것이다.
GATE_CASES.push(
    {
        name: '★ Step7: OpenAI + 히스토리 이미지 + 명시 검색 요청 → on',
        want: true,
        ctx: {
            provider: 'openai',
            hasMultimodalContent: true,
            messages: [human('이 이미지 설명해줘', [IMAGE_PART]), ai('...'), human('저기 저장소 검색해서 확인해봐')],
            latestUserText: '저기 저장소 검색해서 확인해봐',
        } as any,
    },
    {
        name: 'Step7: OpenAI + 이미지 + 검색 요청 아님 → 분류기 판정대로',
        want: false,
        ctx: {
            provider: 'openai',
            needsSearch: false,
            hasMultimodalContent: true,
            messages: [human('이 이미지 설명해줘', [IMAGE_PART]), ai('...'), human('표로 정리해줘')],
            latestUserText: '표로 정리해줘',
        } as any,
    },
    {
        name: 'Step7: OpenAI 라도 URL 본문(200)은 그대로 off — 400 만 걷어낸다',
        want: false,
        ctx: {
            provider: 'openai',
            webContent: '[URL_CONTENT: ...]',
            messages: [human('요약해줘')],
            latestUserText: '요약해줘',
        } as any,
    },
    {
        name: 'Step7 대조: provider 미지정(기본 gemini)은 기존대로 off',
        want: false,
        ctx: {
            hasMultimodalContent: true,
            messages: [human('이 이미지 설명해줘', [IMAGE_PART]), ai('...'), human('저기 저장소 검색해서 확인해봐')],
            latestUserText: '저기 저장소 검색해서 확인해봐',
        },
    },
);

let gatePass = 0;
const origLog = console.log;
for (const c of GATE_CASES) {
    const captured: string[] = [];
    console.log = (...a: any[]) => { captured.push(a.join(' ')); };
    let got: boolean;
    try {
        got = decideGoogleSearch({ ...base, ...c.ctx } as any).useGoogleSearch;
    } finally {
        console.log = origLog;
    }
    const ok = got === c.want;
    if (ok) gatePass++;
    console.log(`${ok ? '✅' : '❌'} want=${c.want ? 'ON ' : 'OFF'} got=${got ? 'ON ' : 'OFF'} | ${c.name}`);
    if (!ok) for (const line of captured) console.log(`      └─ ${line}`);
}
console.log(`\n게이트 회귀: ${gatePass}/${GATE_CASES.length}`);
if (gatePass !== GATE_CASES.length) process.exitCode = 1;

// 회귀가 깨졌을 때만 실패로 종료한다.
// BUG/GAP는 구현 전 RED가 정상이므로 종료코드를 오염시키지 않는다.
if (regressionFailures.length > 0) process.exitCode = 1;

// ============================================================
// Part D — deriveLastTurnSearched (Step 6 증거 추출)
//   클라이언트 history의 grounding 출처를 읽는다. 근사를 대체하는 값이므로 여기가 틀리면
//   가드 전체가 틀어진다. undefined(판단 불가)와 false(검색 안 함)를 반드시 구분할 것.
// ============================================================
console.log('\n' + '='.repeat(72));
console.log('Part D — deriveLastTurnSearched (history 증거)');
console.log('='.repeat(72));

const { deriveLastTurnSearched } = await import('../server/agent/history.js');

const SRC = [{ title: 't', uri: 'https://a.com' }];
const D_CASES: Array<[string, any[], boolean | undefined]> = [
    ['빈 히스토리 → undefined(판단 불가)', [], undefined],
    ['사용자 발화만 → undefined', [{ role: 'user', content: 'hi' }], undefined],
    ['봇 답변에 출처 있음 → true', [{ role: 'user', content: 'q' }, { role: 'model', content: 'a', groundingSources: SRC }], true],
    ['봇 답변에 출처 없음 → false', [{ role: 'user', content: 'q' }, { role: 'model', content: 'a' }], false],
    ['빈 배열 출처 → false', [{ role: 'model', content: 'a', groundingSources: [] }], false],
    ['DB 표기 assistant도 인식', [{ role: 'assistant', content: 'a', groundingSources: SRC }], true],
    ['최근 봇 답변 기준(과거 출처에 속지 않음)', [
        { role: 'model', content: 'old', groundingSources: SRC },
        { role: 'user', content: 'q' },
        { role: 'model', content: 'new' },
    ], false],
];

let dPass = 0;
for (const [name, hist, want] of D_CASES) {
    const got = deriveLastTurnSearched(hist);
    const ok = got === want;
    if (ok) dPass++;
    console.log(`${ok ? '✅' : '❌'} want=${String(want).padEnd(9)} got=${String(got).padEnd(9)} | ${name}`);
}
console.log(`\nhistory 증거: ${dPass}/${D_CASES.length}`);
if (dPass !== D_CASES.length) process.exitCode = 1;


// ============================================================
// Part E — 멀티턴 재점검 후속 (DEV_260902 §9)
//   순수 함수 2종. 둘 다 호출부가 무거운 모듈(generator/langchain-path)에 있어
//   여기로 빼 두었다 — 하니스가 프로덕션 판정을 그대로 실행하기 위해서다.
// ============================================================
console.log('\n' + '='.repeat(72));
console.log('Part E — 이미지 드롭 가드 · 논문 종합단계 웹검색 (§9)');
console.log('='.repeat(72));

const { shouldDropImageForSearch, shouldAddWebSearchToPaperFollowup } =
    await import('../server/agent/search-signals.js');

let ePass = 0, eFail = 0;
const e = (name: string, got: boolean, want: boolean) => {
    if (got === want) { ePass++; console.log(`✅ want=${String(want).padEnd(5)} | ${name}`); }
    else { eFail++; console.log(`❌ want=${String(want).padEnd(5)} got=${String(got).padEnd(5)} | ${name}`); }
};

// ── shouldDropImageForSearch ────────────────────────────────────────────────
const drop = (intent: string, cur: boolean, hist: boolean, explicit: boolean) =>
    shouldDropImageForSearch({ intent, currentTurnHasImage: cur, historyHasImage: hist, explicitSearchSignal: explicit });

e('general + 히스토리 이미지 + 명시 요청 → 드롭', drop('general', false, true, true), true);
// 🔴 §9.2: medical_qa 는 tier 100 검색 강제 ON 인데 400 에 눌려 정책이 무효였다
e('medical_qa 도 드롭 대상 (검색 강제 정책 보호)', drop('medical_qa', false, true, true), true);
e('현재 턴에 이미지가 있으면 드롭 금지 (그게 질문 대상)', drop('general', true, true, true), false);
e('히스토리에 이미지가 없으면 드롭할 것도 없음', drop('general', false, false, true), false);
e('명시 검색 신호가 없으면 드롭 금지 (이미지 보존 우선)', drop('general', false, true, false), false);
// 렌더러는 일부러 제외 — 히스토리 이미지가 답의 대상일 수 있고 tier 200 으로 어차피 off
e('astronomy 는 대상 아님 (렌더러 — 이미지가 답의 대상)', drop('astronomy', false, true, true), false);
e('data_viz 는 대상 아님', drop('data_viz', false, true, true), false);
e('카드 intent 는 SDK 경로가 아니라 무관', drop('movie_search', false, true, true), false);

// ── shouldAddWebSearchToPaperFollowup ───────────────────────────────────────
// §9.3: LangChain(Gemini) 논문 경로는 웹 탈출구가 아예 없었다.
// ⚠️ 1차 호출에 도구를 둘 주면 forceDomainTool(allTools.length===1)이 풀려 논문 도구를
//    아예 안 부를 수 있다 → ToolMessage 이후 종합 단계에서만 더한다.
const web = shouldAddWebSearchToPaperFollowup;
e('arxiv + 종합단계 + 명시 요청 → 웹 도구 추가', web('arxiv_search', true, '레포 검색해줘'), true);
e('paper_search 도 동일', web('paper_search', true, '관련 자료 검색해줘'), true);
e('🔴 1차 호출(조회 단계)에는 추가 금지 — 강제 도구가 풀린다', web('arxiv_search', false, '레포 검색해줘'), false);
e('명시 요청이 없으면 추가 금지 (불필요한 웹 호출)', web('arxiv_search', true, '두번째 논문 설명해줘'), false);
e('과거참조는 새 검색 요청이 아니다', web('arxiv_search', true, '아까 검색한 거 정리해줘'), false);
e('논문 외 intent 는 대상 아님', web('drug_info', true, '검색해줘'), false);

// ── 배선: 호출부가 실제로 이 함수를 쓰는가 ──────────────────────────────────
// 🔴 DEV_260830 §6.25 의 교훈 — "순수 함수를 새로 빼면 호출부 연결을 같은 커밋에서 검사한다".
//    판정은 맞는데 아무 일도 안 일어나는 실수를 이 레포에서 두 번 냈다.
const { readFileSync } = await import('node:fs');
const genSrc = readFileSync(new URL('../server/agent/nodes/generator.ts', import.meta.url), 'utf8');
const lcSrc = readFileSync(new URL('../server/agent/nodes/langchain-path.ts', import.meta.url), 'utf8');
e('배선: generator 가 shouldDropImageForSearch 를 호출한다',
    /shouldDropImageForSearch\s*\(/.test(genSrc), true);
e('배선: generator 에 옛 인라인 조건이 남아 있지 않다',
    /state\.intent === 'general' && !_currentTurnHasImage/.test(genSrc), false);
e('배선: langchain-path 가 shouldAddWebSearchToPaperFollowup 를 호출한다',
    /shouldAddWebSearchToPaperFollowup\s*\(/.test(lcSrc), true);
e('배선: langchain-path 가 searchWebTool 을 논문 경로에 연결한다',
    /paper_search[\s\S]{0,400}searchWebTool/.test(lcSrc), true);

console.log(`\nPart E: ${ePass}/${ePass + eFail}`);
if (eFail > 0) process.exitCode = 1;
