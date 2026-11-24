/**
 * e약은요 용법 조회 하니스 — `npx tsx tests/test-drug-easy-info.mts` (네트워크 없음, fetch 대체)
 *
 * 지키는 것: 약 카드 용량은 공식 문장에서만 온다(PLAN_GEMINI_25_SHUTDOWN §10-5).
 *   ① 태그·줄바꿈을 걷어 숫자를 그대로 남긴다 ② 이름 조회는 질의로 시작하는 품목만 쓴다
 *   ③ 미수록·HTTP 오류·키 없음은 null(호출부가 설명서 안내로 내려간다) ④ 키를 로그에 남기지 않는다
 */
import { fetchEasyDrugBySeq, fetchEasyDrugByName, formatEasyDrug } from '../server/agent/drug-easy-info.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const realFetch = globalThis.fetch;
const mock = (status: number, body: any) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as any; };
const items = (...it: any[]) => ({ header: { resultCode: '00' }, body: { items: it } });
const TYL = { itemSeq: '202106092', itemName: '타이레놀정500밀리그람(아세트아미노펜)', useMethodQesitm: '<p>1회 1~2정씩,\n1일 3~4회</p> 1일 최대 8정(4 g)을 초과하지 않습니다.', efcyQesitm: '해열 및 진통', atpnQesitm: '' };

mock(200, items(TYL));
const a = await fetchEasyDrugBySeq('202106092', 'k');
check('① 태그·줄바꿈 제거, 숫자 보존', a?.useMethod === '1회 1~2정씩, 1일 3~4회 1일 최대 8정(4 g)을 초과하지 않습니다.', a?.useMethod);
check('① 블록에 출처 표기', !!a && formatEasyDrug(a).startsWith('용법(e약은요·식약처): '));
check('① 빈 주의사항은 블록에서 뺀다', !!a && !formatEasyDrug(a).includes('주의사항'));

mock(200, items({ itemName: '판콜에스내복액', useMethodQesitm: '1회 1병' }, { itemName: '판콜에이내복액', useMethodQesitm: '성인 1회 1병(30 mL)' }));
const b = await fetchEasyDrugByName('판콜에이 내복액', 'k');
check('② 이름 조회는 질의로 시작하는 품목', b?.itemName === '판콜에이내복액', b?.itemName);
mock(200, items({ itemName: '다른약', useMethodQesitm: 'x' }));
check('② 일치 품목이 없으면 null(비슷한 약 용법을 붙이지 않는다)', (await fetchEasyDrugByName('판콜에이', 'k')) === null);

mock(200, { header: { resultCode: '00' }, body: { items: [] } });
check('③ 미수록(전문의약품 등) → null', (await fetchEasyDrugBySeq('1', 'k')) === null);
mock(500, {});
check('③ HTTP 오류 → null', (await fetchEasyDrugBySeq('1', 'k')) === null);
check('③ 키 없음 → 호출하지 않고 null', (await fetchEasyDrugBySeq('1', '')) === null);
mock(200, items({ itemSeq: '1', itemName: 'x', useMethodQesitm: '' }));
check('③ 용법 칸이 비면 null', (await fetchEasyDrugBySeq('1', 'k')) === null);

// ④ 실패 로그에 요청 URL(키 포함)이 섞이지 않는다
const logged: string[] = []; const realWarn = console.warn;
console.warn = (...x: any[]) => logged.push(x.join(' '));
globalThis.fetch = (async () => { throw Object.assign(new Error('boom https://x?serviceKey=SECRET'), { name: 'TypeError' }); }) as any;
await fetchEasyDrugBySeq('1', 'SECRET');
console.warn = realWarn;
check('④ 실패 로그에 키 없음', logged.length === 1 && !logged[0].includes('SECRET'), logged.join(' | '));

globalThis.fetch = realFetch;
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
