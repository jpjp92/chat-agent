/**
 * 출처 성격 분류 하니스 — `npx tsx tests/test-source-kind.mts`
 * 계획: docs/plans/PLAN_CHART_SOURCE_261106.md §5-3
 */
import { countSourceKinds, sourceKindOf } from '../lib/source-kind.js';

let pass = 0, fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`✅ ${name} → ${JSON.stringify(got)}`); }
    else { fail++; console.log(`❌ ${name} → ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
};

// 공식 — 접미사와 목록
for (const h of ['kma.go.kr', 'index.go.kr', 'mods.go.kr', 'weather.go.kr', 'eia.gov', 'bea.gov', 'bok.or.kr', 'kosis.kr',
    'krx.co.kr', 'korea.kr', 'stlouisfed.org', 'fred.stlouisfed.org', 'data.worldbank.org', 'who.int', 'ec.europa.eu'])
    eq(`공식 ${h}`, sourceKindOf(h), 'official');
eq('대문자·www', sourceKindOf(' WWW.KOSIS.KR '), 'official');

// 2차
for (const h of ['chosun.com', 'hankyung.com', 'ko.wikipedia.org', 'investing.com', 'kr.investing.com', 'tradingeconomics.com', 'kdi.re.kr'])
    eq(`2차 ${h}`, sourceKindOf(h), 'secondary');

// 기타 — 블로그·처음 보는 사이트·흉내 낸 도메인·호스트명 아님
for (const h of ['tistory.com', 'namu.wiki', 'youtube.com', 'blogspot.com', 'smbs.biz', 'evilgo.kr', 'kma.go.kr.evil.com',
    'notbok.or.kr', 'fakekosis.kr', 'gov', '국가통계포털', 'Bank of Korea', 'https://kosis.kr', 'kosis.kr/path', ''])
    eq(`기타 ${JSON.stringify(h)}`, sourceKindOf(h), 'other');
eq('문자열 아님', sourceKindOf(undefined), 'other');
eq('숫자', sourceKindOf(42), 'other');

eq('개수', countSourceKinds([{ title: 'kosis.kr' }, { title: 'chosun.com' }, { title: 'tistory.com' }, { title: 'kma.go.kr' }, {}]),
    { official: 2, secondary: 1, other: 2 });
eq('빈 입력', countSourceKinds(undefined), { official: 0, secondary: 0, other: 0 });

console.log(`\n${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
