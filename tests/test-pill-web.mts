/**
 * 약 식별 웹 후보 — `npx tsx tests/test-pill-web.mts` (server/agent/pill-web-candidates.ts, pill-messages.ts)
 * 11-28 위더스세픽스캡슐: 웹 검색은 후보를 찾았는데 생성 모델이 규칙 충돌로 버렸다 → 서버가 표로 직접 답한다.
 */
import { parsePillWebCandidates } from '../server/agent/pill-web-candidates';
import { pillWebCandidateMessage } from '../server/agent/nodes/pill-messages';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: string) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok || got === undefined ? '' : `  → ${got}`}`); };

const text = [
    '후보|위더스세픽스캡슐|위더스제약(주)|CFX|경질캡슐|주황|https://www.health.kr/drug/A11AOOOOO2906',
    '- 후보|쎄팍심캡슐|한국휴텍스제약|CFX|경질캡슐|주황|[3](https://www.pharm.or.kr/search/drugidfy/show.asp?idx=31968)',
    '후보|가짜약|어딘가|CFX|정제|주황|https://blog.example.com/x',
    '후보|링크없음|어딘가|CFX|정제|주황|',
    '설명 문장은 무시',
].join('\n');
const c = parsePillWebCandidates(text);
check('형식 맞고 낱알식별 도메인인 줄만', c.length === 2, String(c.length));
check('마크다운 링크에서 URL 추출', c[1]?.url === 'https://www.pharm.or.kr/search/drugidfy/show.asp?idx=31968', c[1]?.url);
check('제조사 (주) 제거', c[0]?.company === '위더스제약', c[0]?.company);
check('"없음" 은 0건', parsePillWebCandidates('없음').length === 0);

const msg = pillWebCandidateMessage({ imprint_front: 'UU', imprint_back: 'CFX' }, c, '', 'similar');
check('웹 후보 표에 정답이 있다', msg.includes('위더스세픽스캡슐') && msg.includes('[보기](https://www.health.kr/'));
check('확정 아님 + 약사 확인', msg.includes('확정할 수 없습니다') && msg.includes('약사'));
check('DB 후보 없으면 참고 표 없음', !msg.includes('참고 — 식약처'));

const db = '[PROVIDED_PILL_DATA]\nmatch_type: similar\nCandidate 1:\n- Name: 세클캡슐\n- Company: 옵투스제약\n- Imprint: \n- Color: 주황\n- Shape: 장방형\n- Detail URL: https://nedrug.mfds.go.kr/x\n';
const msg2 = pillWebCandidateMessage({ imprint_back: 'CFX' }, c, db, 'similar');
check('DB 후보는 참고 표로 아래에', msg2.indexOf('참고 — 식약처') > msg2.indexOf('위더스세픽스캡슐') && msg2.includes('세클캡슐'));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
