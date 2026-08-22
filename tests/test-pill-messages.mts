/**
 * 알약 후보 문구 하니스 — `npx tsx tests/test-pill-messages.mts`
 *
 * 프로덕션을 **임포트**한다(문구 복사 금지). test-storage-name.mts 와 같은 규약.
 *
 * 🔴 왜 있는가 (2026-08-18 실측):
 *   `similar`(3단계 = 색상+모양만)이 `imprint_only` 와 **똑같은 문장**을 써서
 *   *"각인: OG37 …을 바탕으로 검색한 후보"* 로 나왔다. 각인은 쓰이지도 않았다.
 *   표의 `식별표시` 는 전부 `-` 였는데 **문장이 그 사실을 부정**했다 — 조용히 틀린 답(S등급).
 *
 * 🔴 **이건 드문 경우가 아니다.** dev 실측상 각인 텍스트를 가진 행은 25,345 중 2,214 = **8.7%**
 *   (상류 MFDS 낱알식별 API 한계). 즉 **약 91% 의 질의가 `similar` 로 떨어진다.**
 *   그래서 이 문구가 사실상 **기본 응답**이고, 회귀하면 대부분의 사용자가 틀린 문장을 본다.
 */

import { pillCandidateTableMessage, shouldTryPillWebFallback, buildPillWebQuery } from '../server/agent/nodes/pill-messages.js';
import { shouldFastPathPillId, hasNewImageAttachment, historyHasImage } from '../server/agent/nodes/image-flags.js';

/**
 * 실제 tool 출력 형식(`tools.ts` 의 [PROVIDED_PILL_DATA])을 **그대로** 흉내낸다.
 * 🔴 각인이 없어도 `tools.ts` 는 줄을 지우지 않는다 — `- Imprint: ` 로 **빈 값**을 남긴다
 *   (`r.mark_codes.join(', ')`). 그 빈 줄이 2026-08-18 파싱 버그를 만들었으므로
 *   여기서도 **줄을 지우지 않고 빈 값으로** 둬야 한다. 지우면 버그가 재현되지 않는다.
 */
const toolText = (imprint: string) => `match_type: similar
Candidate 1:
- Name: 알메텍정(세티리진염산염)
- Company: (주)에이프로젠바이오로직스
- Imprint: ${imprint}
- Color: 하양
- Shape: 장방형
- Form: 필름코팅정
- Image: 
- Detail URL: https://nedrug.mfds.go.kr/x
`;

const OG37 = { imprint_front: 'OG37', color: '하양', shape: '장방형' };
const NO_IMPRINT = { color: '하양', shape: '장방형' };

type Case = { name: string; pill: any; matchType: string; text: string;
              must: { s: string; why: string }[]; mustNot: { s: string; why: string }[] };

const CASES: Case[] = [
    {
        name: 'similar + 각인 읽음 — 각인을 못 찾았다고 말해야 한다',
        pill: OG37, matchType: 'similar', text: toolText('-'),
        must: [
            { s: '찾지 못했습니다', why: '🔴 각인 불일치를 명시하지 않으면 각인 기준 결과로 읽힌다' },
            { s: 'OG37', why: '읽은 각인은 숨기지 않는다 — 사용자가 화면에서 이미 봤다' },
            { s: '각인이 다를 수 있습니다', why: '후보의 각인이 검증되지 않았음을 경고' },
            { s: '8.7%', why: '왜 각인이 안 쓰였는지 — 없으면 "무시했다"로 읽힌다' },
        ],
        mustNot: [
            { s: '을 바탕으로 식품의약품안전처 DB에서 검색한 후보', why: '🔴 회귀 지점: imprint_only 전용 문장' },
            { s: `앞면 각인: OG37, 색상`, why: '🔴 각인을 검색 특징 목록에 섞으면 안 된다 — 쓰이지 않았다' },
        ],
    },
    {
        name: 'similar + 각인 못 읽음 — 읽지 못했다고 말해야 한다',
        pill: NO_IMPRINT, matchType: 'similar', text: toolText('-'),
        must: [
            { s: '각인을 읽지 못했습니다', why: '"DB에 없음"과 "못 읽음"은 사용자에게 다른 사실이다' },
            { s: '각인이 다를 수 있습니다', why: '동일 경고' },
        ],
        mustNot: [
            { s: '찾지 못했습니다', why: '읽지도 않은 각인을 "못 찾았다"고 하면 거짓이다' },
        ],
    },
    {
        name: 'imprint_only — 기존 문장 유지 (회귀 방지)',
        pill: OG37, matchType: 'imprint_only', text: toolText('OG37'),
        must: [
            { s: '을 바탕으로 식품의약품안전처 DB에서 검색한 후보', why: '각인이 실제로 쓰인 경로' },
            { s: '앞면 각인: OG37', why: '특징 목록에 각인 포함이 맞다' },
        ],
        mustNot: [
            { s: '찾지 못했습니다', why: '찾았는데 못 찾았다고 하면 안 된다' },
            { s: '8.7%', why: '각인이 쓰인 경우엔 커버리지 설명이 불필요하다' },
        ],
    },
];

let pass = 0, fail = 0;
for (const c of CASES) {
    const out = pillCandidateTableMessage(c.pill, c.matchType, c.text);
    const errs: string[] = [];
    for (const m of c.must)    if (!out.includes(m.s)) errs.push(`빠짐 "${m.s}" — ${m.why}`);
    for (const m of c.mustNot) if (out.includes(m.s))  errs.push(`있으면 안 됨 "${m.s}" — ${m.why}`);
    if (errs.length === 0) { pass++; console.log(`✅ ${c.name}`); }
    else { fail++; console.log(`❌ ${c.name}`); errs.forEach(e => console.log(`     ${e}`)); console.log('   --- 실제 출력 ---'); console.log(out.split('\n').map(l => '   ' + l).join('\n')); }
}

// 표는 항상 남아야 한다 — 문구를 고치다 표를 날리면 후보가 사라진다
const t = pillCandidateTableMessage(OG37, 'similar', toolText('-'));
if (t.includes('| 제품명 |') && t.includes('알메텍정')) { pass++; console.log('✅ 계약  후보 표가 유지된다'); }
else { fail++; console.log('❌ 계약  후보 표가 사라졌다 — 문구만 고쳐야 한다'); }

// ── 파싱: 빈 필드가 다음 줄을 삼키면 안 된다 (2026-08-18 실측 버그) ──────────────
//   `^- Imprint:\s*(.*)$` 의 `\s*` 가 개행을 먹어 `식별표시` 칸에 `- Color: 하양` 이 찍혔다.
//   각인이 있는 행은 8.7% 뿐이라 **나머지 91% 가 전부 이 버그를 탔다.**
const empty = pillCandidateTableMessage(OG37, 'similar', toolText(''));
const emptyRow = empty.split('\n').find(l => l.startsWith('| 알메텍정')) ?? '';
if (!emptyRow) { fail++; console.log('❌ 파싱  빈 각인 행이 표에서 사라졌다'); }
else if (emptyRow.includes('Color:') || emptyRow.includes('Shape:') || emptyRow.includes('Detail URL:')) {
    fail++; console.log(`❌ 파싱  빈 필드가 다음 줄을 삼켰다 — \\s* 회귀\n     ${emptyRow}`);
} else if (emptyRow.split('|')[3].trim() !== '정보 없음') {
    fail++; console.log(`❌ 파싱  빈 각인은 '정보 없음' 이어야 한다\n     ${emptyRow}`);
} else { pass++; console.log('✅ 파싱  빈 각인이 다음 줄을 삼키지 않는다'); }

// 🔴 "각인 없음"과 "정보 없음"은 다른 주장이다 — 우리는 전자를 알 수 없다.
//   실측: 25,345행 중 23,121행이 각인 텍스트·이미지 둘 다 없어 무각인/미등록 구분 불가.
if (empty.includes('| DB 등록 각인 |')) { pass++; console.log("✅ 표기  칸 이름이 '후보의 DB 각인' 임을 밝힌다"); }
else { fail++; console.log("❌ 표기  '식별표시' 로는 사진에서 읽은 각인과 구분되지 않는다"); }
if (!emptyRow.split('|')[3].includes('-') || emptyRow.split('|')[3].trim() === '정보 없음') { pass++; console.log("✅ 표기  빈 각인을 '각인 없음' 으로 단정하지 않는다"); }
else { fail++; console.log("❌ 표기  '-' 는 '이 약은 각인이 없다' 로 읽힌다"); }

// 색상·모양은 **빈 각인 뒤에도** 정상이어야 한다 — 삼킴이 나면 여기부터 어긋난다
if (emptyRow.includes('| 하양 |') && emptyRow.includes('| 장방형 |')) { pass++; console.log('✅ 파싱  빈 각인 뒤 색상·모양이 밀리지 않는다'); }
else { fail++; console.log(`❌ 파싱  빈 각인 뒤 칸이 밀렸다\n     ${emptyRow}`); }

// 스크래핑 폴백 형식: 앞뒤 각인이 모두 비면 `/` 만 남는다 → 각인으로 찍으면 안 된다
const slashOnly = pillCandidateTableMessage(OG37, 'similar', toolText(' / '));
const slashRow = slashOnly.split('\n').find(l => l.startsWith('| 알메텍정')) ?? '';
if (slashRow.split('|')[3].trim() === '정보 없음') { pass++; console.log("✅ 파싱  구분자뿐인 각인(' / ')은 '정보 없음' 으로 표시된다"); }
else { fail++; console.log(`❌ 파싱  구분자를 각인으로 표시했다 — 없는 각인을 있다고 보여준다\n     ${slashRow}`); }



// ── 웹 폴백 게이트 ────────────────────────────────────────────────────────
//   🔴 여기가 할루시네이션 최악 지점("시각적 유사성을 기반으로…")이라 **언제 도는지**를 못 박는다.
//   실증 2026-08-18: 각인 OG37 은 식약처 DB 에 없지만 웹 검색은 무코스타서방정150mg(레바미피드)을
//   정확히 찾아온다 — 웹은 각인으로 색인돼 있다. 그래서 이 경로가 정당하다.
const gate: { name: string; matchType: string; pill: any; expect: boolean; why: string }[] = [
    { name: 'similar + 각인 있음', matchType: 'similar', pill: { imprint_front: 'OG37' }, expect: true,
      why: '검색 키가 있고 DB 가 못 찾았다 — 웹이 더 나은 소스인 유일한 경우' },
    { name: 'none + 각인 있음', matchType: 'none', pill: { imprint_front: 'OG37' }, expect: true,
      why: '후보조차 없을 때야말로 웹이 필요하다' },
    { name: 'similar + 각인 없음', matchType: 'similar', pill: { color: '하양', shape: '원형' }, expect: false,
      why: '🔴 검색 키가 없다 — 색상·모양으로 웹 검색하면 소음뿐이고 그게 날조로 이어진다' },
    { name: 'exact', matchType: 'exact', pill: { imprint_front: 'OG37' }, expect: false,
      why: 'DB 가 확정했다 — 웹을 볼 이유가 없다' },
    { name: 'imprint_only', matchType: 'imprint_only', pill: { imprint_front: 'OG37' }, expect: false,
      why: '각인으로 이미 찾았다' },
    { name: '각인이 공백뿐', matchType: 'similar', pill: { imprint_front: '   ' }, expect: false,
      why: '공백은 검색 키가 아니다' },
];
for (const g of gate) {
    const got = shouldTryPillWebFallback(g.matchType, g.pill);
    if (got === g.expect) { pass++; console.log(`✅ 폴백게이트  ${g.name} → ${got}`); }
    else { fail++; console.log(`❌ 폴백게이트  ${g.name} → ${got} (기대 ${g.expect}) — ${g.why}`); }
}

// 검색어: 각인을 따옴표로 묶고 '알약 각인' 을 넣어야 약품 페이지가 올라온다
//   (그냥 "OG37" 은 부품번호·차량코드가 나온다. 실측으로 확인한 형태다.)
const q = buildPillWebQuery({ imprint_front: 'OG37', color: '하양', shape: '타원형' });
if (q.includes('"OG37"')) { pass++; console.log('✅ 검색어  각인을 따옴표로 묶는다'); }
else { fail++; console.log(`❌ 검색어  각인이 따옴표로 안 묶였다 — 부분일치로 흩어진다: ${q}`); }
if (q.includes('알약') && q.includes('각인')) { pass++; console.log('✅ 검색어  약품 도메인 보조어가 있다'); }
else { fail++; console.log(`❌ 검색어  '알약 각인' 이 없으면 부품번호가 나온다: ${q}`); }
if (q.includes('하양') && q.includes('타원형')) { pass++; console.log('✅ 검색어  색상·모양을 보조어로 붙인다'); }
else { fail++; console.log(`❌ 검색어  색상·모양 누락: ${q}`); }
const qNoExtra = buildPillWebQuery({ imprint_front: 'OG37' });
if (qNoExtra.trim() === qNoExtra && !qNoExtra.includes('  ')) { pass++; console.log('✅ 검색어  색상·모양이 없어도 공백이 남지 않는다'); }
else { fail++; console.log(`❌ 검색어  빈 보조어로 공백이 남았다: ${JSON.stringify(qNoExtra)}`); }

// ── 라우터 지름길: 후속 턴을 가로채면 안 된다 ────────────────────────────────
//   🔴 실측 2026-08-18: 1턴에 알약 사진 → 2턴에 *"이미지 특징 기반으로 검색해서 찾아볼래?"*
//   라고 **명시적으로 요청**했는데 이전 답이 글자 하나 안 틀리고 반복됐다.
//   원인: 지름길 조건이 `hasImage`(= attachments **또는 히스토리**)라 2턴에도 성립했고,
//   **라우터 LLM 이 호출조차 되지 않아** 그 요청이 전달될 통로가 없었다.
//   DEV_260808 *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"* 의 네 번째 사례다.
const IMG = { mimeType: 'image/jpeg', data: 'x' };
const historyWithImage = [{ content: [{ type: 'image_url', image_url: { url: 'x' } }] }];

const routerCases: { name: string; attachments: any; kw: boolean; expect: boolean; why: string }[] = [
    { name: '1턴 — 새 사진 + 약 키워드', attachments: [IMG], kw: true, expect: true,
      why: '이번 턴에 붙였으면 알약 식별이 거의 확실하다 — 결정론적으로 간다' },
    { name: '2턴 — 새 첨부 없음 + 약 키워드', attachments: [], kw: true, expect: false,
      why: '🔴 회귀 지점: 후속 발화는 라우터 LLM 이 판단해야 한다("검색해서 찾아줘"가 전달될 통로)' },
    { name: '2턴 — attachments 자체가 없음', attachments: undefined, kw: true, expect: false,
      why: '같은 이유. undefined 도 "새 첨부 없음" 이다' },
    { name: '새 사진 + 약 키워드 없음', attachments: [IMG], kw: false, expect: false,
      why: '일반 사진("이거 뭐야?")은 알약 식별이 아니다 — 기존 오분류 버그 방지' },
    { name: '새 첨부가 이미지가 아님(PDF)', attachments: [{ mimeType: 'application/pdf' }], kw: true, expect: false,
      why: '문서는 알약 사진이 아니다' },
];
for (const c of routerCases) {
    const got = shouldFastPathPillId(c.attachments, c.kw);
    if (got === c.expect) { pass++; console.log(`✅ 라우터지름길  ${c.name} → ${got}`); }
    else { fail++; console.log(`❌ 라우터지름길  ${c.name} → ${got} (기대 ${c.expect}) — ${c.why}`); }
}

// 두 판정이 **서로 다른 것을 재는지** 못 박는다 — 섞이면 위 버그가 그대로 돌아온다
if (!hasNewImageAttachment([]) && historyHasImage(historyWithImage)) {
    pass++; console.log('✅ 라우터지름길  신규첨부 판정과 히스토리 판정이 분리돼 있다');
} else {
    fail++; console.log('🔴 라우터지름길  두 판정이 같은 값을 낸다 — 후속 턴이 첫 턴처럼 처리된다');
}
// 히스토리 판정은 계속 넓어야 한다(:373 이 이걸로 vision 을 태운다)
if (historyHasImage(historyWithImage) && !historyHasImage([{ content: [{ type: 'text', text: 'hi' }] }])) {
    pass++; console.log('✅ 라우터지름길  히스토리 판정은 넓게 유지된다(drug_id 확정 후 vision 라우팅용)');
} else { fail++; console.log('❌ 라우터지름길  히스토리 이미지 판정이 깨졌다'); }

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
