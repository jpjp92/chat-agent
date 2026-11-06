/**
 * `origin` 판정과 후보 규칙 부작용 — `TIER1=1 npx tsx tests/manual/probe-chart-origin.mts [outDir] [runs]`
 *
 * P1-2B 는 모델이 쓰는 `origin`(provided·function·external)으로 "공식 통계 출처 미확인" 안내를 고른다
 * (PLAN_CHART_SOURCE_261106 §5-3). 구현 전에 두 가지를 잰다:
 *   ① 모델이 origin 을 맞게 쓰는가 — 통계·사용자 숫자·함수 질문별 기대값과 비교
 *   ② 후보 규칙 [STATISTICS SOURCING] 이 통계 아닌 차트를 망가뜨리지 않는가 — 차트 유지, 엉뚱한 "공식 출처" 문장
 * 호출: 질문 10 × runs(기본 2) (유료 키, 검색 포함 — 앱처럼 모든 질문에 검색 도구를 준다)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
const key = process.env.TIER1 === '1' ? process.env.API_KEY_TIER1 : process.env.API_KEY;
if (!key) { console.error('키 없음 (TIER1=1 이면 API_KEY_TIER1)'); process.exit(1); }
const outDir = process.argv[2] || 'probe-out';
const RUNS = Number(process.argv[3] || 2);
mkdirSync(outDir, { recursive: true });

const { GoogleGenAI } = await import('@google/genai');
const { getSystemInstruction, getRendererSections, getIntentPolicy } = await import('../../server/agent/prompt.js');
const ai = new GoogleGenAI({ apiKey: key });
const BASE = [getSystemInstruction('Korean'), getRendererSections('data_viz' as any, 'Korean' as any), getIntentPolicy('data_viz' as any)].join('\n\n');
// probe-chart-fresh-ab 의 후보 규칙과 같은 문장 + origin 필드 지시
const CANDIDATE = `[STATISTICS SOURCING — for charts of real-world statistics]
- Take the numbers from an official primary source found in search (national statistics office, central bank, government agency, exchange, international organization). Prefer it over news, wikis, blogs, and currency/finance aggregator sites. If no official source is in the results, say so in one sentence before the chart.
- State the basis in the chart title or the sentence right before the chart: the aggregation (monthly average vs. end-of-month close, annual average vs. year-end), and mark preliminary/provisional figures.
- "Recent"/"최근"/"last N months" means ending at the latest period available in the search results. Never put old data under a "recent" title. If the latest period you can find is more than 2 months old for monthly data (or over a year for annual data), write the actual last date in the title and say it is the latest you found.`;
const ORIGIN = `[CHART ORIGIN] Add "origin" to every json:chart: "provided" when every number comes from the user's message, "function" when the numbers are computed from a formula/function, "external" when they come from search results or outside knowledge.`;
const SYS = `${BASE}\n\n${CANDIDATE}\n\n${ORIGIN}`;

// [질문, 기대 origin, 통계인가]
const QUERIES: Array<[string, string, boolean]> = [
    ['원달러 환율 최근 12개월 추이 그래프', 'external', true],
    ['코스피 지수 최근 1년 월별 그래프', 'external', true],
    ['한국 연도별 출생아 수 그래프 그려줘', 'external', true],
    ['월별 서울 평균 기온 그래프', 'external', true],
    ['2024년 매출 100억 원, 2025년 매출 120억 원을 막대그래프로 비교해줘', 'provided', false],
    ['우리 반 키 140, 150, 145, 160 막대그래프로 그려줘', 'provided', false],
    ['A팀 3승, B팀 5승, C팀 2승 파이차트', 'provided', false],
    ['y=x²를 -3부터 3까지 그려줘', 'function', false],
    ['사인 함수 그래프 0부터 2π까지', 'function', false],
    ['x=0,1,2,10일 때 y=x² 그래프', 'function', false],
];
const OFFICIAL_NOTE = /공식\s*(통계|출처|자료)/;

type Row = { q: string; want: string; stat: boolean; r: number; chart: boolean; origin: string | null; officialMention: boolean; sources: number };
const rows: Row[] = [];
for (const [qi, [q, want, stat]] of QUERIES.entries()) {
    for (let r = 1; r <= RUNS; r++) {
        let res: any;
        try {
            res = await ai.models.generateContent({ model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: q }] }], config: { systemInstruction: SYS, tools: [{ googleSearch: {} }] } });
        } catch (e: any) { console.log(`■ ${q} #${r} 오류 ${String(e?.status ?? 'ERR')}`); continue; }
        const text: string = res.text ?? '';
        const nSrc = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).length;
        const m = text.match(/```json:chart\s*([\s\S]*?)```/);
        let origin: string | null = null, chart = false;
        if (m) { try { const j = JSON.parse(m[1]); chart = true; origin = typeof j.origin === 'string' ? j.origin : null; } catch { /* 깨진 JSON 은 차트 없음으로 */ } }
        const prose = text.replace(/```[\s\S]*?```/g, '');
        const row: Row = { q, want, stat, r, chart, origin, officialMention: OFFICIAL_NOTE.test(prose), sources: nSrc };
        rows.push(row);
        const ok = origin === want;
        console.log(`${ok ? '✓' : '❌'} ${q} #${r} → 차트 ${chart ? 'O' : 'X'} · origin ${origin ?? '없음'}(기대 ${want}) · 출처 ${nSrc}${!stat && row.officialMention ? ' · ⚠️ 비통계인데 "공식 출처" 언급' : ''}`);
        writeFileSync(join(outDir, `q${qi + 1}-r${r}.md`), `# ${q} #${r}\n기대 ${want} · 출처 ${nSrc}\n\n${text.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com\/[^\s)]+/g, '<redirect>')}\n`);
    }
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(rows, null, 2));
for (const kind of ['external', 'provided', 'function']) {
    const rs = rows.filter(r => r.want === kind);
    console.log(`== ${kind}: origin 정답 ${rs.filter(r => r.origin === kind).length}/${rs.length} · 차트 ${rs.filter(r => r.chart).length}/${rs.length} · 출처 붙음 ${rs.filter(r => r.sources > 0).length}/${rs.length}${kind !== 'external' ? ` · "공식 출처" 언급 ${rs.filter(r => r.officialMention).length}` : ''}`);
}
