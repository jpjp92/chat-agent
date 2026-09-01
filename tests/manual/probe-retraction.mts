/**
 * 실제 데이터로 두 결함을 확인한다 — 오프라인 하니스는 규칙만 보고, 이건 PubMed 응답을 본다.
 *   40323973: 실제 철회된 메타분석 (근거 카드에 `종합분석` 배지로 떴던 그 논문)
 *   27055821: 초록 1,933자인데 꼬리 두 문장이 곁가지였던 논문
 *   23306139 / 24468694: PubMed 에 초록 자체가 없는 논문
 */
import { parseAbstracts, isRetracted, toEvidence } from '../../server/agent/paper-tool';

const IDS = ['40323973', '27055821', '23306139', '24468694'];
const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const sum = await (await fetch(`${base}/esummary.fcgi?db=pubmed&id=${IDS.join(',')}&retmode=json`)).json();
await new Promise(r => setTimeout(r, 400));
const xml = await (await fetch(`${base}/efetch.fcgi?db=pubmed&id=${IDS.join(',')}&retmode=xml`)).text();
const abstracts = parseAbstracts(xml);

let bad = 0;
const check = (label: string, ok: boolean, note = '') => {
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${note ? ` — ${note}` : ''}`);
};

for (const id of IDS) {
    const pubtype: string[] = sum.result?.[id]?.pubtype ?? [];
    const a = abstracts.get(id);
    console.log(`\n${id}  pubtype=${JSON.stringify(pubtype)}`);
    console.log(`  evidence=${toEvidence(pubtype)}  retracted=${isRetracted(pubtype)}  kind=${a?.kind}`);
    console.log(`  summary(${a?.text.length ?? 0}자): ${a?.text.slice(0, 160) || '(없음)'}`);
}

console.log('\n판정');
check('40323973 을 철회로 잡는다', isRetracted(sum.result['40323973'].pubtype ?? []));
check('40323973 의 등급 판정은 유지된다 (철회는 등급을 지우는 게 아니다)',
    toEvidence(sum.result['40323973'].pubtype ?? []) !== null,
    String(toEvidence(sum.result['40323973'].pubtype ?? [])));
check('27055821 은 발췌로 표시된다', abstracts.get('27055821')?.kind === 'excerpt');
check('27055821 에서 "future studies are recommended" 꼬리가 빠졌다',
    !abstracts.get('27055821')!.text.includes('future studies are recommended'));
for (const id of ['23306139', '24468694']) {
    check(`${id} 은 초록 없음(kind='none') 으로 표시된다`, abstracts.get(id)?.kind === 'none',
        `text=${JSON.stringify(abstracts.get(id)?.text)}`);
}
check('초록 없는 논문을 발췌라고 말하지 않는다',
    ['23306139', '24468694'].every(id => abstracts.get(id)?.kind !== 'excerpt'));

console.log(bad === 0 ? '\n✅ 전부 통과' : `\n🔴 실패 ${bad}건`);
