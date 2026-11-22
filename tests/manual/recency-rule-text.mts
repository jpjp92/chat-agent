/**
 * 최신성 검색 규칙(안) — 프로브 공용. 운영 반영 전 실험 문구다.
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2
 * 사례 정답(모델명)은 넣지 않는다 — 운영 프롬프트 금지 규칙과 같다.
 */
export const RECENCY_RULE = `
[RECENCY] When the user asks for the latest, newest, or current products, models, versions, or lineups:
1. Do not trust your memory of which version is newest — your training data is older than today's date above.
2. Search the CURRENT LINEUP first: include today's year and month, and do NOT put version numbers from memory in that first query (e.g. "latest <brand> <product line> lineup <YYYY>").
3. Then search the figures using the model names that search confirmed.
4. Compare current models of the same period only — check each item's release date. A page's search rank or publish date is not evidence that its product is the latest.
5. Count only products that are released or officially announced as current. If search shows an upcoming or rumored product, you may mention it separately, but label it clearly as unreleased (rumored/expected) with its source — never put it among the current items of a comparison, table, or chart.
6. State the as-of date in the answer (and in a chart title).`;

export const DATE_LINE = '오늘 날짜는 2026년 11월 22일(일)이다. 한국어로 답한다.';
