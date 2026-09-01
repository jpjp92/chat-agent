/**
 * 상영관 지역 매칭 하니스 — `npx tsx tests/test-theaters.mts`
 *
 * 프로덕션(`lib/theaters.ts`)을 **임포트**한다. 매칭 규칙을 여기에 다시 쓰지 않는다.
 *
 * 이 파일이 생긴 이유: 사용자가 "성남" 상영표를 물었는데 CGV 칸에 **울산성남**(울산 남구)이
 * 떴다. `nm.includes(q)` 는 다른 도시의 지점이 질의를 부분문자열로 품고 있어도 맞다고 본다.
 *
 * 전수 측정(2026-08-31, 실제 질의형 지명 106종 × 3체인 = 318회): 비접두 매칭은 22건이었고
 * 그중 **4건만** 실제 오답이었다. 나머지 18건(동수원·북포항·프리미엄안동·강남역→강남 …)은
 * 같은 도시 안이거나 의도된 별칭이다. 그래서 규칙이 아니라 **관측된 4건의 배제 목록**으로 간다 —
 * 구조만으로는 `북포항`(정답)과 `남양주`(오답)를 가를 수 없다. 둘 다 `방위+질의` 모양이다.
 */

import { resolveBranch, defaultsForRegion, type ChainKey } from '../lib/theaters.js';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${label}`); }
    else { fail++; console.log(`❌ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const got = (chain: ChainKey, q: string) => {
    const r = resolveBranch(chain, q);
    return r.matched ? r.branch.nm : null;
};
/** 매칭이 되면 안 되는 자리 — null 이어야 카드가 "이 지역엔 지점이 없습니다"로 안내한다. */
const none = (chain: ChainKey, q: string, why: string) =>
    ok(got(chain, q) === null, `${q} × ${chain} → 지점 없음`, `${got(chain, q)} 이 나왔다 (${why})`);
const is = (chain: ChainKey, q: string, want: string) =>
    ok(got(chain, q) === want, `${q} × ${chain} → ${want}`, `${got(chain, q)}`);

console.log('\n── ① 다른 도시 지점을 물어오면 안 된다 (실측 오답 4건) ──');
none('cgv', '성남', 'CGV 는 성남시에 지점이 없다 — 울산 남구의 울산성남이다');
none('cgv', '하남', '광주하남은 광주광역시 하남산단 — 경기 하남시가 아니다');
none('mega', '양주', '평내호평역(구.남양주) — 남양주시 ≠ 양주시');
none('lotte', '성동', '마산(합성동) — 창원 마산 ≠ 서울 성동구');

console.log('\n── ② 같은 도시 안의 비접두 매칭은 살아 있어야 한다 ──');
is('cgv', '수원', '동수원');            // CGV 수원 지점은 없다. 동수원이 정답이다
is('cgv', '포항', '북포항');
is('lotte', '안동', '프리미엄안동');
is('lotte', '해운대', '프리미엄해운대(장산역)');
is('lotte', '명동', '에비뉴엘(명동)');
is('cgv', '영등포역', '영등포타임스퀘어');

console.log('\n── ③ 별칭은 그대로 (REGION_ALIASES) ──');
is('cgv', '강남역', '강남');
is('cgv', '홍대입구', '홍대');
is('lotte', '잠실', '월드타워');
is('mega', '삼성역', '코엑스');

console.log('\n── ④ 접두 매칭은 손대지 않는다 ──');
is('lotte', '성남', '성남중앙(신흥역)');   // 🔴 ①과 같은 질의다 — 배제는 체인별로 갈려야 한다
is('mega', '성남', '성남모란');
is('cgv', '광주', '광주상무');              // 광주광역시. 4자 경기광주를 고르면 회귀다(DEV_260801 §3-3)
is('cgv', '서면', '서면');

console.log('\n── ⑤ 시·도 단위 질의는 지점 이름으로 풀 수 없다 ──');
// "경기" 가 상암월드컵**경기장**을 물어왔다. 도 안의 아무 지점을 주는 것도 답이 아니다 —
// "경기 상영표" 에 경기광주(광주시) 회차를 주면 사용자는 그걸 자기 지역 것으로 읽는다.
none('mega', '경기', '상암월드컵경기장 — 경기도가 아니라 경기장이다');
none('cgv', '경기', '경기광주는 경기도 광주시의 한 지점일 뿐이다');
none('cgv', '충북', '충북혁신(진천)');
none('mega', '경북', '경북도청(안동)');
none('lotte', '경남', '프리미엄경남대 — 대학 이름이다');
none('mega', '경남', '마산(경남대)');
is('cgv', '제주', '제주');                  // 제주는 도이면서 시다 — 막으면 안 된다

console.log('\n── ⑥ defaultsForRegion 계약 ──');
const 성남 = defaultsForRegion('성남');
ok(성남.cgv === null, '성남 → cgv null (카드가 "지점 없음"을 표시한다)', String(성남.cgv?.nm));
ok(성남.lotte?.nm === '성남중앙(신흥역)' && 성남.mega?.nm === '성남모란',
    '성남 → lotte·mega 는 살아 있다', `${성남.lotte?.nm} / ${성남.mega?.nm}`);
// 지역을 말하지 않으면 매칭 실패가 아니라 "기본값 사용"이다 — 세 칸 모두 채워야 한다
const 무지역 = defaultsForRegion(undefined);
ok(!!(무지역.cgv && 무지역.lotte && 무지역.mega), '지역 미지정 → 기본 지점 3종 유지');

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
