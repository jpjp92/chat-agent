/**
 * Storage 키 정규화 하니스 — `npx tsx scripts/test-storage-name.mts`
 *
 * 프로덕션을 **임포트**한다(정규식 복사 금지). test-intent-rules.mts 와 같은 규약.
 *
 * 케이스는 대부분 **실제 Storage 에서 관측한 이름**이다(2026-08-17):
 *   `-2024--ai---------.hwp` · `multiagent-----------------.pdf`
 * 확장자 보존이 특히 중요하다 — `parse-document` 의 `STORAGE_PATH_RE` 가 `.hwp|.hwpx|…` 를 요구한다.
 */

import { safeStorageName } from '../lib/storage-name.js';

const CASES: { input: string; expect: string; note: string }[] = [
    // ── 실측 (뭉개졌던 이름들) ────────────────────────────────────────
    { input: '2024년 AI바우처 지원사업.hwp', expect: '2024-ai.hwp', note: '실측: `-2024--ai---------.hwp` 였다' },
    { input: '멀티에이전트 시스템 설계.pdf', expect: 'file.pdf', note: '전부 한글 → base 가 비어 폴백' },
    { input: '(서식1호) 사업계획서(일반분과).hwp', expect: '1.hwp', note: '숫자만 남는다 — 정보 손실은 남지만 읽을 수는 있다' },

    // ── 이미 안전한 이름은 그대로 ─────────────────────────────────────
    { input: 'img-1661.jpeg', expect: 'img-1661.jpeg', note: '변형 없음' },
    { input: 'prompt-engineering.pdf', expect: 'prompt-engineering.pdf', note: '변형 없음' },
    { input: 'Report_2024_FINAL.HWPX', expect: 'report-2024-final.hwpx', note: '언더스코어→대시, 소문자화' },

    // ── 경계 ─────────────────────────────────────────────────────────
    { input: '한글만.hwp', expect: 'file.hwp', note: '🔴 확장자는 반드시 살아야 한다(parse-document 정규식)' },
    { input: 'noext', expect: 'noext', note: '확장자 없음 → 점 붙이지 않는다' },
    { input: '.gitignore', expect: 'gitignore', note: '점으로 시작 = 확장자가 아니라 본문' },
    { input: 'a..b.hwp', expect: 'a-b.hwp', note: '연속 점도 축약된다' },
    { input: '   .hwp', expect: 'file.hwp', note: '공백만 → 폴백' },
    { input: '....', expect: 'file', note: '점뿐 — 빈 키가 되면 안 된다' },
];

let pass = 0, fail = 0;
for (const c of CASES) {
    const got = safeStorageName(c.input);
    if (got === c.expect) { pass++; console.log(`✅ ${JSON.stringify(c.input).padEnd(34)} → ${got}`); }
    else { fail++; console.log(`❌ ${JSON.stringify(c.input).padEnd(34)} → ${got}  (기대 ${c.expect}) — ${c.note}`); }
}

// 확장자 보존은 parse-document 가 의존하는 계약이라 따로 못 박는다.
const HWP_RE = /^[a-z0-9._-]+\.(hwp|hwpx|hwp3|hwpml)$/i;
for (const n of ['한글 문서.hwp', '계획서.hwpx', '보고서 v2.HWP']) {
    const got = safeStorageName(n);
    if (HWP_RE.test(got)) { pass++; console.log(`✅ 계약    ${JSON.stringify(n).padEnd(28)} → ${got}`); }
    else { fail++; console.log(`❌ 계약    ${JSON.stringify(n)} → ${got} — parse-document STORAGE_PATH_RE 불일치`); }
}

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
