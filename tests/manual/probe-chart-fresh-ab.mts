/**
 * 빠르게 변하는 시계열 차트 — 프롬프트 A/B. `TIER1=1 npx tsx tests/manual/probe-chart-fresh-ab.mts [outDir] [runs]`
 *
 * 11-06 실측에서 환율만 🔴 였다: "최근 12개월" 제목에 2024년 값, 월평균/월말 혼재, A 출처 3/15.
 * 같은 질문을 현재 프롬프트(base)와 후보 규칙을 더한 프롬프트(cand)로 돌려 비교한다.
 * 지표: A 출처 비율 · 마지막 시점과 오늘의 차이(개월) · 기준 명시(월평균·월말·종가·잠정 등) · 회차 간 마지막 값 차이.
 * 호출: 쿼리 6 × 2 팔 × runs(기본 2) = 24 (유료 키, 검색 포함, 한 번에 10분 넘게 걸린다 — 나눠 돌리려면 FROM=쿼리 번호(1부터)).
 * 원문은 outDir 에 저장(redirect URL 제외). summary 는 FROM 마다 따로(summary-FROM.json).
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
// 후보 규칙 — 채택되면 RENDERER_SECTIONS.chart 의 [NEVER INVENT DATA POINTS] 옆으로 간다
export const CANDIDATE = `[STATISTICS SOURCING — for charts of real-world statistics]
- Take the numbers from an official primary source found in search (national statistics office, central bank, government agency, exchange, international organization). Prefer it over news, wikis, blogs, and currency/finance aggregator sites. If no official source is in the results, say so in one sentence before the chart.
- State the basis in the chart title or the sentence right before the chart: the aggregation (monthly average vs. end-of-month close, annual average vs. year-end), and mark preliminary/provisional figures.
- "Recent"/"최근"/"last N months" means ending at the latest period available in the search results. Never put old data under a "recent" title. If the latest period you can find is more than 2 months old for monthly data (or over a year for annual data), write the actual last date in the title and say it is the latest you found.`;
const CAND = `${BASE}\n\n${CANDIDATE}`;

const QUERIES = [
    '원달러 환율 최근 12개월 추이 그래프',
    '코스피 지수 최근 1년 월별 그래프',
    '한국은행 기준금리 추이 그래프',
    '국제 유가(WTI) 최근 12개월 그래프',
    '한국 소비자물가 상승률 최근 12개월 그래프',
    '비트코인 가격 최근 6개월 그래프',
];
const TODAY = { y: 2026, m: 11 };
const isA = (d: string) => /(\.go\.kr|kosis\.kr|bok\.or\.kr|krx\.co\.kr|\.gov$|stlouisfed\.org|federalreserve\.gov|imf\.org|worldbank\.org|oecd\.org|ecb\.europa\.eu|eia\.gov)$/.test(d);
const BASIS_RE = /월평균|월말|종가|말일|평균\s*기준|기말|잠정|확정|전년\s*동월\s*대비|월간\s*평균|종가\s*기준|end-of-month|monthly average/;

// 범주 라벨 → (연, 월). "2026.10"·"26년 10월"·"2026-10"·"10월"(연 없음은 무시)
const ym = (label: string): { y: number; m: number } | null => {
    const y4 = label.match(/(20\d{2})/)?.[1]; const y2 = !y4 ? label.match(/(?<!\d)(\d{2})\s*[년.\-/]/)?.[1] : undefined;
    const y = y4 ? Number(y4) : y2 ? 2000 + Number(y2) : null;
    const m = label.match(/(?<!\d)(1[0-2]|0?[1-9])\s*월/)?.[1] ?? label.match(/(?:20)?\d{2}[-./](1[0-2]|0?[1-9])(?!\d)/)?.[1];
    if (!y) return null;
    return { y, m: m ? Number(m) : 12 };
};
const chartOf = (text: string) => {
    const m = text.match(/```json:chart\s*([\s\S]*?)```/);
    if (!m) return null;
    try {
        const j = JSON.parse(m[1]);
        const cats: unknown[] = j?.data?.categories ?? [];
        const s0: any[] = j?.data?.series?.[0]?.data ?? [];
        const labels = s0.map((d, i) => (d && typeof d === 'object' ? String(d.x) : String(cats[i] ?? '')));
        const values = s0.map(d => Number(d && typeof d === 'object' ? d.y : d));
        return { title: String(j.title ?? ''), labels, values };
    } catch { return null; }
};

type Row = { q: string; arm: string; r: number; aShare: string; lag: number | null; basis: boolean; last: number | null; lastLabel: string; noOfficialNote: boolean; points: number };
const rows: Row[] = [];
const FROM = Number(process.env.FROM || 1);
for (const [qi, q] of QUERIES.entries()) {
    if (qi + 1 < FROM) continue;
    for (const [arm, sys] of [['base', BASE], ['cand', CAND]] as const) {
        for (let r = 1; r <= RUNS; r++) {
            let res: any;
            try {
                res = await ai.models.generateContent({ model: 'gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: q }] }], config: { systemInstruction: sys, tools: [{ googleSearch: {} }] } });
            } catch (e: any) { console.log(`■ ${q} [${arm}#${r}] 오류 ${String(e?.status ?? 'ERR')}`); continue; }
            const text: string = res.text ?? '';
            const domains: string[] = (res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c: any) => c?.web?.title || '?');
            const a = domains.filter(isA).length;
            const ch = chartOf(text);
            const lastLabel = ch?.labels.at(-1) ?? '';
            const lp = ym(lastLabel);
            const lag = lp ? (TODAY.y - lp.y) * 12 + (TODAY.m - lp.m) : null;
            const prose = text.replace(/```[\s\S]*?```/g, '');
            const basis = BASIS_RE.test((ch?.title ?? '') + prose);
            const noOfficialNote = /공식\s*(통계|출처|자료)[^.\n]{0,20}(없|찾지 못|확인되지)/.test(prose);
            const row: Row = { q, arm, r, aShare: `${a}/${domains.length}`, lag, basis, last: ch?.values.at(-1) ?? null, lastLabel, noOfficialNote, points: ch?.labels.length ?? 0 };
            rows.push(row);
            console.log(`■ ${q} [${arm}#${r}] A ${row.aShare} · 마지막 ${lastLabel || '-'}(${lag ?? '?'}개월 전) · 기준 ${basis ? 'O' : 'X'} · 값 ${row.last ?? '-'} · 점 ${row.points}${noOfficialNote ? ' · 공식출처없음 고지' : ''}`);
            console.log(`    출처 ${domains.join(', ') || '-'}`);
            writeFileSync(join(outDir, `q${qi + 1}-${arm}-r${r}.md`), `# ${q} [${arm}#${r}]\n출처: ${domains.join(', ')}\n\n${text.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com\/[^\s)]+/g, '<redirect>')}\n`);
        }
    }
}
writeFileSync(join(outDir, `summary-${FROM}.json`), JSON.stringify(rows, null, 2));
for (const arm of ['base', 'cand']) {
    const rs = rows.filter(r => r.arm === arm);
    const aNum = rs.reduce((s, r) => s + Number(r.aShare.split('/')[0]), 0), aDen = rs.reduce((s, r) => s + Number(r.aShare.split('/')[1]), 0);
    const lags = rs.map(r => r.lag).filter((x): x is number => x !== null);
    console.log(`\n== ${arm}: 응답 ${rs.length} · A 출처 ${aNum}/${aDen} · 마지막 시점 2개월 넘게 지난 응답 ${lags.filter(l => l > 2).length}/${lags.length} (최대 ${Math.max(...lags)}개월) · 기준 명시 ${rs.filter(r => r.basis).length}/${rs.length}`);
}
console.log('\n== 회차 간 마지막 값 (같은 마지막 시점일 때만 비교)');
for (const q of QUERIES) for (const arm of ['base', 'cand']) {
    const rs = rows.filter(r => r.q === q && r.arm === arm);
    console.log(`  ${q} [${arm}] ${rs.map(r => `${r.lastLabel}=${r.last}`).join(' | ')}`);
}
