/**
 * MFDS 각인 정리 — `npx tsx tests/test-drug-imprint.mts` (server/agent/drug-imprint.ts)
 * 마그네스정: PRINT_BACK "마크" + MARK_CODE_BACK_ANAL "dHP,dP,d-P,cHP" 인데 카드가 "마크(로고)" 만 보였다(2026-10-18).
 */
import { resolveImprints, imprintWithMarkCode, firstMarkCode } from '../server/agent/drug-imprint';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: string) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok || got === undefined ? '' : `  → ${got}`}`); };

const magnes = resolveImprints({ PRINT_FRONT: null, PRINT_BACK: '마크', MARK_CODE_FRONT_ANAL: '', MARK_CODE_BACK_ANAL: 'dHP,dP,d-P,cHP' });
check('마크 + 분석값 → "마크(dHP)"', magnes.back === '마크(dHP)', String(magnes.back));
check('분석값으로 채우면 비전 불필요', !magnes.visionNeeded.front && !magnes.visionNeeded.back);
check('한 면만 각인', magnes.onlyOneSide);
check('없는 면은 null', magnes.front === null, String(magnes.front));

const noAnal = resolveImprints({ PRINT_FRONT: '마크', PRINT_BACK: null, MARK_CODE_FRONT_ANAL: '' });
check('분석값 없는 마크는 비전 대상', noAnal.visionNeeded.front && noAnal.front === '마크');

const tylenol = resolveImprints({ PRINT_FRONT: 'TYLENOL', PRINT_BACK: '500' });
check('글자 각인은 그대로', tylenol.front === 'TYLENOL' && tylenol.back === '500');
check('양면 각인은 onlyOneSide 아님', !tylenol.onlyOneSide);
check('글자 각인엔 비전 안 부름', !tylenol.visionNeeded.front && !tylenol.visionNeeded.back);

check('분석값 공백·빈 항목 무시', firstMarkCode(' , dP ,x') === 'dP', String(firstMarkCode(' , dP ,x')));
check('"마크(로고)" 표기도 마크로 본다', imprintWithMarkCode('마크(로고)', 'ABC') === '마크(ABC)');
check('빈 값은 null', imprintWithMarkCode('  ', 'x') === null);

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
