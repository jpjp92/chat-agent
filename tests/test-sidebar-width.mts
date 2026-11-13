/**
 * 사이드바 폭 하니스 — `npx tsx tests/test-sidebar-width.mts`
 * 감시 대상: 폭은 범위 안 정수 · 저장값이 이상하면 기본값(스크립트·음수·빈 값이 style 로 가지 않게)
 */
import { SIDEBAR_WIDTH, clampSidebarWidth, parseStoredSidebarWidth } from '../src/lib/sidebar-width.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

check('범위 안은 그대로(정수로)', clampSidebarWidth(300.6) === 301);
check('작으면 최소·크면 최대', clampSidebarWidth(10) === SIDEBAR_WIDTH.min && clampSidebarWidth(5000) === SIDEBAR_WIDTH.max);
check('NaN·Infinity → 기본값', clampSidebarWidth(NaN) === SIDEBAR_WIDTH.initial && clampSidebarWidth(Infinity) === SIDEBAR_WIDTH.initial);
check('저장값 없음 → 기본값', parseStoredSidebarWidth(null) === SIDEBAR_WIDTH.initial && parseStoredSidebarWidth('') === SIDEBAR_WIDTH.initial);
check('저장값 숫자 → 그 폭', parseStoredSidebarWidth('320') === 320);
check('저장값 범위 밖 → 범위 안', parseStoredSidebarWidth('99999') === SIDEBAR_WIDTH.max && parseStoredSidebarWidth('1') === SIDEBAR_WIDTH.min);
check('숫자가 아닌 저장값 → 기본값', ['300px', '-300', '3e2', '300;color:red', 'abc', '300.5'].every(v => parseStoredSidebarWidth(v) === SIDEBAR_WIDTH.initial));
check('기본값은 범위 안', SIDEBAR_WIDTH.initial >= SIDEBAR_WIDTH.min && SIDEBAR_WIDTH.initial <= SIDEBAR_WIDTH.max);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
