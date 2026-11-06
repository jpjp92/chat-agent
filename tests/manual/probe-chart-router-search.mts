/**
 * 통계 차트 질문의 라우터 검색 판정 — `TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-chart-router-search.mts`
 *
 * 검색이 꺼진 통계 차트는 모델 기억으로 그려져 근거가 없다(PLAN_CHART_SOURCE_261106 §5 ⑤).
 * "최근" 이 없거나 짧은 표현에서도 라우터가 검색을 켜는지 본다. 라우터 노드만 부른다(생성 없음).
 * 호출: 라우터 모델 × 질문 수
 */
import { existsSync, readFileSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
if (process.env.TIER1 === '1') {
    const t = process.env.API_KEY_TIER1;
    if (!t) { console.error('API_KEY_TIER1 없음'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = t;
}
const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');

// [질문, 검색이 필요한가(기대)]
const QUERIES: Array<[string, boolean]> = [
    ['한국 연도별 출생아 수 그래프 그려줘', true],
    ['출생아 수 그래프', true],
    ['출산율 차트로 보여줘', true],
    ['서울 기온 그래프', true],
    ['코스피 그래프', true],
    ['환율 차트', true],
    ['한국 GDP 성장률 그래프', true],
    ['미국 기준금리 추이 그려줘', true],
    ['비트코인 가격 그래프', true],
    ['한국 인구 피라미드 그려줘', true],
    ['스마트폰 점유율 파이차트', true],
    ['국가별 탄소배출량 비교 그래프', true],
    ['우리 반 키 140, 150, 145, 160 막대그래프로', false],
    ['y=x² 그래프', false],
    ['2024년 매출 100억, 2025년 120억 막대로 비교', false],
    ['사인 함수 그래프 그려줘', false],
];

let wrong = 0;
for (const [q, want] of QUERIES) {
    const t0 = Date.now();
    try {
        const out: any = await routerNode({
            messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })],
            webContent: '', attachments: [], activeCards: [], cardContexts: [], lastTurnSearched: false,
        } as any);
        const ok = !!out.needsSearch === want;
        if (!ok) wrong++;
        console.log(`${ok ? '✓' : '❌'} ${q} → ${out.intent}/${out.intentFrom} · 검색 ${out.needsSearch ? 'on' : 'off'} (기대 ${want ? 'on' : 'off'}, ${Date.now() - t0}ms)`);
    } catch (e: any) { wrong++; console.log(`❌ ${q} → 오류 ${String(e?.status ?? e?.name ?? 'ERR')}`); }
}
console.log(`\n== ${QUERIES.length - wrong}/${QUERIES.length} 기대와 같음`);
