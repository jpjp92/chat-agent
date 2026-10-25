/** 약 카드 URL 덮어쓰기 · 식약처 출처 — server/agent/drug-card-urls.ts (DEV_261024 §7 · DEV_261025) */
import { drugCardSources, parseDrugCandidates, repairDrugCardUrls } from '../server/agent/drug-card-urls';
let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`); };

const cdi = (n: string) => `https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=${encodeURIComponent(n)}`;
const tool = (items: { name: string; img: string; seq: string }[]) => `[MFDS_DRUG_DATA] 식약처 공식 데이터 (총 ${items.length}건)\n\n` + items.map((it, i) =>
    `== 후보 ${i + 1} ==\n약품명(KO): ${it.name}\n공식 이미지URL: ${it.img}\n품목일련번호(ITEM_SEQ): ${it.seq}\nMFDS_DETAIL_URL: https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${it.seq}\nConnectDI_URL: ${cdi(it.name.split('(')[0])}\n\n`).join('');
const card = (o: any) => '```json:drug\n' + JSON.stringify(o, null, 2) + '\n```\n\n산문 그대로.';
const read = (t: string) => JSON.parse(t.match(/```json:drug\n([\s\S]*?)\n```/)![1]);

const one = tool([{ name: '타이레놀정500밀리그람(아세트아미노펜)', img: 'https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/1OKRXo9l4D5', seq: '202106092' }]);
check('후보 파싱', parseDrugCandidates(one).length === 1 && parseDrugCandidates(one)[0].connectdi_url === cdi('타이레놀정500밀리그람'));

const broken = card({ name: '타이레놀정500밀리그람(아세트아미노펜)', image_url: 'https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/1OKRXo9l4D5',
    mfds_url: 'https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=202106092',
    connectdi_url: 'https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=%ED%83%80%EC%9D%B4%EB%A0%88%EB%86%80%EC%A0%95500%EB%B0%80%EB%A6%AC% הוא%EA%B7%B8%EB%9E%8C', efficacy: [{ label: '발열 완화' }] });
const fixed = repairDrugCardUrls(broken, one);
check('히브리어 섞인 connectdi_url 복구', read(fixed).connectdi_url === cdi('타이레놀정500밀리그람'));
check('URL 외 필드·산문 유지', read(fixed).efficacy[0].label === '발열 완화' && fixed.endsWith('산문 그대로.'));

const two = tool([{ name: '게보린정', img: 'https://x.test/a', seq: '1' }, { name: '게보린소프트연질캡슐', img: 'https://x.test/b', seq: '2' }]);
const pickByName = repairDrugCardUrls(card({ name: '게보린소프트연질캡슐', image_url: 'https://x.test/WRONG', mfds_url: null, connectdi_url: null }), two);
check('후보 여럿 — 이름으로 골라 덮어씀', read(pickByName).image_url === 'https://x.test/b' && read(pickByName).mfds_url.endsWith('itemSeq=2'));
const unknown = card({ name: '다른약', image_url: 'https://x.test/keep', mfds_url: null, connectdi_url: null });
check('후보 여럿인데 못 고르면 손대지 않음', repairDrugCardUrls(unknown, two) === unknown);

const okCard = card({ name: '게보린정', image_url: 'https://x.test/a', mfds_url: 'https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=1', connectdi_url: cdi('게보린정') });
check('이미 맞으면 원문 그대로', repairDrugCardUrls(okCard, two) === okCard);
check('도구 출력 없으면 원문', repairDrugCardUrls(broken, '') === broken);
const noImg = tool([{ name: '어떤액', img: 'null', seq: '9' }]);
check('도구 이미지 null → 카드도 null', read(repairDrugCardUrls(card({ name: '어떤액', image_url: 'https://made.up/x.jpg', mfds_url: null, connectdi_url: null }), noImg)).image_url === null);

const src = drugCardSources(okCard);
check('출처 — 카드의 식약처 상세 페이지', src.length === 1 && src[0].uri.endsWith('itemSeq=1') && src[0].title === '식약처 의약품안전나라 · 게보린정');
check('출처 — 같은 카드 둘이면 하나', drugCardSources(okCard + '\n\n' + okCard).length === 1);
check('출처 — mfds_url null 이면 없음', drugCardSources(unknown).length === 0);
check('출처 — nedrug 상세 모양이 아니면 버림', drugCardSources(card({ name: 'x', mfds_url: 'https://evil.test/?itemSeq=1' })).length === 0
    && drugCardSources(card({ name: 'x', mfds_url: 'https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=1%20x' })).length === 0);
check('출처 — 웹 출처에 식약처 상세가 있으면 생략', drugCardSources(okCard, [{ title: '식품의약품안전처 의약품', uri: 'https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=197900277' }]).length === 0);
check('출처 — mfds.go.kr 다른 페이지도 생략', drugCardSources(okCard, [{ title: 'x', uri: 'https://www.mfds.go.kr/brd/m_99/view.do?seq=1' }]).length === 0);
check('출처 — Gemini 리다이렉트(제목이 도메인)도 생략', drugCardSources(okCard, [{ title: 'nedrug.mfds.go.kr', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AB' }]).length === 0);
check('출처 — 다른 사이트만 있으면 붙임', drugCardSources(okCard, [{ title: '약학정보원', uri: 'https://www.health.kr/drug/x' }, { title: 'notmfds.go.kr.evil.test', uri: 'https://x.test' }]).length === 1);
check('출처 — 카드 없는 답·깨진 JSON', drugCardSources('그냥 답').length === 0 && drugCardSources('```json:drug\n{깨짐\n```').length === 0);

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail) process.exit(1);
