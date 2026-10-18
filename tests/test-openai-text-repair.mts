/**
 * OpenAI 최종 답 보정 — `npx tsx tests/test-openai-text-repair.mts` (server/openai/text-repair.ts)
 * 2026-10-18 실사용 원문(dev DB): 울타리 없는 약 카드 JSON + "turn0search0turn0search4".
 */
import { repairOpenAIText, stripPrivateCitationMarks, fenceBareDrugJson } from '../server/openai/text-repair';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: string) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok || got === undefined ? '' : `  → ${got}`}`); };

const card = '{"name":"마그네스정","engName":"Magnes Tab.","ingredient":"락트산마그네슘수화물","pill_visual":{"shape":"장방형","imprint_back":"마크(dHP)"},"efficacy":[{"label":"마그네슘 {보충}","icon":"fa-pills"}]}';
const real = card + 'turn0search0turn0search4\n\n마그네스정은 대화제약의 일반의약품입니다. [1](https://www.health.kr/drug/A11AMMMMM0691)';

const fixed = repairOpenAIText(real);
check('실사용 원문 → json:drug 울타리', fixed.startsWith('```json:drug\n{'), fixed.slice(0, 30));
check('카드 JSON 이 그대로 파싱된다', JSON.parse(fixed.match(/```json:drug\n([\s\S]*?)\n```/)![1]).pill_visual.imprint_back === '마크(dHP)');
check('turn0search 잔재 제거', !/turn0search/.test(fixed), fixed);
check('사설 영역 문자 제거', ![...fixed].some(c => c.charCodeAt(0) >= 0xe000 && c.charCodeAt(0) <= 0xf8ff));
check('뒤 설명과 우리 인용 링크 유지', fixed.includes('마그네스정은 대화제약') && fixed.includes('[1](https://www.health.kr/'));
check('문자열 안 중괄호에 속지 않는다', fixed.includes('마그네슘 {보충}'));

check('완전한 표지도 지운다', stripPrivateCitationMarks('문장citeturn0search1 끝') === '문장 끝');
check('이미 울타리가 있으면 그대로', fenceBareDrugJson('```json:drug\n{"name":"a","ingredient":"b"}\n```') === '```json:drug\n{"name":"a","ingredient":"b"}\n```');
check('약 카드 모양이 아닌 JSON 은 그대로', fenceBareDrugJson('{"region":"강남"} 설명') === '{"region":"강남"} 설명');
check('산문으로 시작하면 그대로', fenceBareDrugJson('타이레놀은 {"name":"x","ingredient":"y"}') === '타이레놀은 {"name":"x","ingredient":"y"}');
check('깨진 JSON 은 그대로', fenceBareDrugJson('{"name":"x","ingredient":') === '{"name":"x","ingredient":');
check('일반 답은 바뀌지 않는다', repairOpenAIText('오늘 환율은 1,334원입니다.') === '오늘 환율은 1,334원입니다.');

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
