/**
 * paperTool 실호출 프로브 — `npx tsx --env-file=.env tests/manual/probe-paper-tool.mts [검색어]`
 *
 * `probe-paper-apis.mts` 가 PubMed API 자체를 검증한다면, 이쪽은 **프로덕션 도구**를 그대로
 * 불러 카드 JSON 이 제대로 나오는지 본다(tests/README ⓒ — 하니스는 프로덕션 로직을 import 한다).
 */
import { paperTool } from '../../server/agent/paper-tool';

const query = process.argv[2] ?? 'probiotics common cold prevention';
const raw = await paperTool.invoke({ query, limit: 5 });

const match = String(raw).match(/^```json:paper\n([\s\S]*)\n```$/);
if (!match) { console.error('🔴 카드 형식이 아니다:', String(raw).slice(0, 200)); process.exit(1); }

const card = JSON.parse(match[1]);
console.log(`\n질의 "${card.query}" · PubMed ${card.total?.toLocaleString?.()}건 · 반환 ${card.papers.length}건`);
if (card.error) console.log('🔴 error:', card.error);

for (const p of card.papers) {
    console.log(`\n  [${p.evidence ?? '미분류'}] ${p.year}  ${p.title.slice(0, 66)}`);
    console.log(`    ${p.journal} · ${(p.authors ?? []).slice(0, 3).join(', ')}`);
    console.log(`    ${p.url}${p.doi ? `  doi ${p.doi}` : '  (doi 없음)'}`);
    console.log(`    요약: ${(p.summary || '(없음)').slice(0, 110)}`);
}

const missing = card.papers.filter((p: any) => !p.pmid || !p.url || !p.title);
console.log(`\n${missing.length ? `🔴 필수 필드 누락 ${missing.length}건` : '✅ 전건 pmid·url·title 보유'}`);
console.log(`   등급 있음 ${card.papers.filter((p: any) => p.evidence).length}/${card.papers.length} · DOI 있음 ${card.papers.filter((p: any) => p.doi).length}/${card.papers.length}`);
