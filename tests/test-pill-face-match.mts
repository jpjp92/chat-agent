/**
 * MFDS exact 면별 대조 — `npx tsx tests/test-pill-face-match.mts` (server/pill-face-match.ts)
 * OR 검색 1건을 exact 로 보던 것: 앞 ABC / 뒤 123 사진에 ABC 만 가진 약이 카드로 나갔다(PLAN_PILL_IDENTIFY_261128 G9).
 */
import { matchesEachFace } from '../server/pill-face-match';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); };

check('양면 모두 있으면 일치', matchesEachFace(['ABC', '123'], ['ABC'], ['123']));
check('뒷면 코드가 행에 없으면 불일치(G9)', !matchesEachFace(['ABC'], ['ABC'], ['123']));
check('앞면만 읽었으면 앞면만 본다', matchesEachFace(['ABC'], ['ABC'], []));
check('앞면 변형 중 하나만 맞아도 앞면 일치', matchesEachFace(['DHP', 'X1'], ['DP', 'DHP'], ['X1']));
check('대소문자 무시', matchesEachFace(['dP'], ['DP'], []));
check('앞면이 다르면 불일치', !matchesEachFace(['XYZ', '123'], ['ABC'], ['123']));
check('mark_codes 없음 → 각인 읽었으면 불일치', !matchesEachFace(null, ['ABC'], []));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
