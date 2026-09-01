/**
 * 날씨 카드 후속 판정 하니스 — `npx tsx tests/test-weather-followup.mts`
 *
 * 프로덕션 로직을 **임포트**한다(정규식 복사 금지 — 복사하면 하니스가 프로덕션과
 * 따로 늙는다). tests/test-intent-rules.mts와 같은 규약.
 *
 * ## 무엇을 재는가
 * 화면에 날씨 카드가 떠 있을 때 사용자가 이어 말했을 때,
 *   · new    = 카드를 다시 그린다 (다른 도시)
 *   · refine = 떠 있는 카드로 **설명**한다 (질문에 문장으로 답)
 * 를 옳게 가르는지.
 *
 * 결함의 성격: `new`로 새면 카드만 또 뜨고 **질문에 답하지 않는다.**
 * 사용자가 같은 걸 세 번 물어도 카드만 세 번 나온다 → refine 쪽이 기본값이어야 한다.
 */

import { decideWeatherFollowup, buildDateLadder, type WeatherFollowupDecision } from '../server/agent/weather-followup.js';

type Case = {
    text: string;
    expect: WeatherFollowupDecision;
    note: string;
    /** 착수 시점에 이미 틀린 케이스. 고치면 태그를 지운다(하니스가 알려준다). */
    red?: true;
    /** 라우터 LLM이 내놓은 판정(회색지대 케이스 재현용) */
    llm?: 'new' | 'refine' | 'unrelated';
    /** 화면에 떠 있는 카드의 도시 — 미지정 시 부산 카드로 가정 */
    shown?: string[];
};

/** 카드가 떠 있는 상태에서 intent=weather로 분류된 발화들 */
const CASES: Case[] = [
    // ── 새 조회여야 하는 것 (도시가 바뀐다) ────────────────────────────
    { text: '부산 날씨', expect: 'new', note: '도시명 + 날씨 — 가장 명확한 새 조회' },
    { text: '부산 날씨 알려줘', expect: 'new', note: '도시명 + 요청' },
    { text: '제주도 날씨도 알려줘', expect: 'new', note: '추가 도시' },
    { text: '전주, 서울 날씨 알려줘', expect: 'new', note: '멀티 도시' },
    { text: '도쿄 날씨', expect: 'new', note: '해외 도시' },
    { text: '부산은?', expect: 'new', note: '도시 단독 재질의' },

    // ── 설명이어야 하는 것 (카드는 이미 있다) ──────────────────────────
    // 🔴 이번 스크린샷 3턴 — 사용자가 같은 걸 세 번 묻는데 카드만 세 번 떴다
    { text: '아니 날씨 추세알려주라고', expect: 'refine', note: '추세 설명 요청. `아니`가 도시로 오인되던 자리' },
    { text: '날씨 추세 알려줘', expect: 'refine', note: '`날씨`+`알려` 명시요청 규칙에 걸려 new로 샘' },
    { text: '아니 오늘 이제 월욜이잖아 내일 부산 비오냐고', expect: 'refine', note: '카드 5일치에 내일이 이미 있다. 재조회해도 같은 데이터' },
    { text: '내일 비와?', expect: 'refine', note: '시점이동+날씨어휘 → new로 샜다. 카드에 내일이 있음' },
    { text: '이번 주 날씨 어때?', expect: 'refine', note: '카드 예보 범위 안' },

    // ── 틀린 카드로 답하면 안 되는 것 (`날씨` 없이 도시만 나온 발화) ──────
    // refine으로 새면 **서울 카드로 부산을 답한다** — 카드가 하나 더 뜨는 것보다 나쁘다.
    { text: '내일 부산 비와?', expect: 'new', shown: ['서울'], note: '화면에 없는 도시 → 새 조회' },
    { text: '내일 부산 비와?', expect: 'refine', shown: ['부산광역시'], note: '같은 도시 → 카드로 설명. 라벨(부산광역시) vs 입력(부산) 정합' },
    { text: '전주가 서울보다 기온이 높네?', expect: 'refine', shown: ['전주', '서울'], note: '둘 다 떠 있음 → 비교 설명' },
    { text: '거기 제주도는 더 더워?', expect: 'new', shown: ['부산광역시'], note: '화면에 없는 도시' },

    // 기존에도 통과하던 해석형 (회귀 감시)
    { text: '우산 챙겨야 할까?', expect: 'refine', note: '해석형 어휘' },
    { text: '습도가 높은 편이야?', expect: 'refine', note: '카드 수치 해석' },
    { text: '왜 이렇게 더워?', expect: 'refine', note: '이유 질문' },
    { text: '이런 날씨엔 뭐 먹을까?', expect: 'refine', note: '지시어+날씨 = 코멘트' },
    { text: '요즘 날씨 왜 이래', expect: 'refine', note: '수식어+날씨' },
    { text: '가장 더운 요일은?', expect: 'refine', note: '카드 예보 스트립 해석' },

    // ── 회색지대 — LLM 판정에 맡겨야 하는 것 ───────────────────────────
    { text: '구미는 어때', expect: 'new', note: 'CITY_ALIASES에 없는 도시 → LLM이 new로 판정', llm: 'new' },
    { text: '거기 미세먼지는?', expect: 'refine', note: 'LLM이 refine으로 판정', llm: 'refine' },
];

let pass = 0, red = 0, fixed = 0, regress = 0;
const lines: string[] = [];

for (const c of CASES) {
    const { decision, why } = decideWeatherFollowup({
        text: c.text,
        intentIsWeather: true,
        llmFollowUp: c.llm ?? null,
        useLlm: true,
        shownCities: c.shown ?? ['부산광역시'],
    });
    const ok = decision === c.expect;
    if (ok && c.red) { fixed++; lines.push(`🎉 FIXED  "${c.text}" → ${decision} (${why}) — red 태그를 지우세요`); }
    else if (ok) { pass++; lines.push(`✅ ${String(decision).padEnd(9)} "${c.text}"`); }
    else if (c.red) { red++; lines.push(`🔴 알려진결함 "${c.text}" → ${decision} (${why}), 기대 ${c.expect} — ${c.note}`); }
    else { regress++; lines.push(`❌ 회귀    "${c.text}" → ${decision} (${why}), 기대 ${c.expect} — ${c.note}`); }
}

// ── 날짜 대응표 ────────────────────────────────────────────────────────────
// 모델이 `내일`에 **오늘** 값을 답하고 18일을 "모레"라 부른 실측(2026-08-17) 때문에 만든 표다.
// 모델 산문은 여기서 못 재지만, **표 자체가 맞는지**는 결정론이라 잴 수 있다.
const LADDER: { now: string; tz: string; expect: string[]; note: string }[] = [
    {
        now: '2026-08-17T01:00:00+09:00', tz: 'Asia/Seoul', note: '실측 시나리오 — 오늘 17일(월)',
        expect: ['- 오늘 = 2026-08-17(월)', '- 내일 = 2026-08-18(화)', '- 모레 = 2026-08-19(수)', '- 글피 = 2026-08-20(목)'],
    },
    {
        now: '2026-08-31T23:30:00+09:00', tz: 'Asia/Seoul', note: '월말 경계',
        expect: ['- 오늘 = 2026-08-31(월)', '- 내일 = 2026-09-01(화)', '- 모레 = 2026-09-02(수)', '- 글피 = 2026-09-03(목)'],
    },
    {
        now: '2026-12-31T20:00:00+09:00', tz: 'Asia/Seoul', note: '연말 경계',
        expect: ['- 오늘 = 2026-12-31(목)', '- 내일 = 2027-01-01(금)', '- 모레 = 2027-01-02(토)', '- 글피 = 2027-01-03(일)'],
    },
    {
        // UTC 15:00 = KST 익일 00:00. 서버 로컬 타임존이 아니라 **tz 기준**으로 끊겨야 한다.
        now: '2026-08-17T15:00:00Z', tz: 'Asia/Seoul', note: 'KST 자정 직후 — 날짜가 넘어가야 함',
        expect: ['- 오늘 = 2026-08-18(화)', '- 내일 = 2026-08-19(수)', '- 모레 = 2026-08-20(목)', '- 글피 = 2026-08-21(금)'],
    },
];

for (const c of LADDER) {
    const got = buildDateLadder(new Date(c.now), c.tz).split('\n');
    const want = c.expect;
    if (got.join('|') === want.join('|')) { pass++; lines.push(`✅ 날짜표    ${c.note}`); }
    else { regress++; lines.push(`❌ 날짜표   ${c.note}\n     got : ${got.join(' / ')}\n     want: ${want.join(' / ')}`); }
}

console.log(lines.join('\n'));
console.log(`\n통과 ${pass} · 알려진 결함 ${red} · 신규통과 ${fixed} · 회귀 ${regress}`);

if (regress > 0) { console.error('\n❌ 회귀가 있습니다.'); process.exit(1); }
if (fixed > 0) { console.error(`\n⚠️  ${fixed}건이 고쳐졌습니다 — 케이스의 red 태그를 지우세요.`); process.exit(1); }
console.log('\n기준선 유지.');

// 🔴 "내일은?" 이 카드를 다시 그렸다(실측 2026-08-31, 사용자 로컬). 규칙 신호가 하나도 없어
//   LLM 판정으로 떨어지고, LLM 이 'new' 라고 하면 재조회된다. 그런데 이 파일이 스스로 정한
//   원칙은 **"새 조회의 유일한 근거는 다른 지역이 지목됐는가"** 다 — 시점만 옮긴 재질의는
//   카드에 이미 +5일 예보가 있으므로 재조회해도 같은 데이터가 온다(화면이 그대로다).
{
    let bad = 0;
    const t = (text: string, llm: any, want: string) => {
        const r = decideWeatherFollowup({ text, intentIsWeather: true, llmFollowUp: llm,
                                          useLlm: true, shownCities: ['부산광역시'] });
        if (r.decision !== want) { bad++; console.log(`  🔴 ${r.decision}(${r.why}) 기대 ${want} ← "${text}" llm=${llm}`); }
    };
    // 시점만 옮긴 단독 재질의 — LLM 이 new 라고 해도 규칙이 이긴다
    for (const q of ['내일은?', '모레는?', '주말은?', '오후는?', '내일은'])
        t(q, 'new', 'refine');
    // 지역 재질의는 그대로 새 조회여야 한다 (가드가 이걸 삼키면 날씨 멀티턴이 죽는다)
    for (const q of ['서울은?', '부산은?', '제주도는?']) t(q, 'refine', 'new');
    console.log(bad ? `🚨 시점 재질의 가드 ${bad}건 실패` : '✅ 시점 재질의 가드 통과');
    if (bad) process.exit(1);
}
