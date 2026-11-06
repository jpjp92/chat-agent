/**
 * 차트-본문 수치 일치 실측 — `TIER1=1 npx tsx tests/manual/probe-chart-text-consistency.mts [outDir]`
 *
 * grounding 은 본문 문장에만 출처를 붙이고 json:chart 안은 덮지 않는다(probe-chart-source-tiers, 0/6).
 * 그래서 "출처가 붙은 본문 수치" 와 "차트의 같은 시점 값" 이 다르면 차트 숫자는 근거 없는 값이다.
 * 판정: 출처가 붙은 문장에서 (시점, 숫자) 를 뽑고, 차트 범주에 그 시점이 있으면 값 비교 — 2% 넘게 다르면 불일치.
 * 한국어 수 표기(24만 9천 명·1.2억)는 숫자로 바꾼다. 단위 배수가 다를 수 있어 ×1·×10⁴·×10⁸·×10³ 중 가장 가까운 값으로 본다.
 * 호출: 쿼리 8 × 2회 = 16 (유료 키, 검색 포함). 원문은 outDir 에 저장(redirect URL 제외).
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
mkdirSync(outDir, { recursive: true });

const { GoogleGenAI } = await import('@google/genai');
const { getSystemInstruction, getRendererSections, getIntentPolicy } = await import('../../server/agent/prompt.js');
const ai = new GoogleGenAI({ apiKey: key });
const sys = [getSystemInstruction('Korean'), getRendererSections('data_viz' as any, 'Korean' as any), getIntentPolicy('data_viz' as any)].join('\n\n');

const QUERIES = [
    '한국 연도별 출생아 수 그래프 그려줘',
    '월별 서울 평균 기온 그래프',
    '미국 GDP 최근 5년 그래프',
    '한국 실업률 최근 5년 그래프',
    '한국 총인구 추이 최근 10년 그래프',
    '원달러 환율 최근 12개월 추이 그래프',
    '한국 연도별 수출액 그래프',
    '한국 합계출산율 추이 그래프',
];
const RUNS = 2;

// "24만 9천" → 249000, "1.2억" → 1.2e8, "30,769.70" → 30769.7
const parseKoNumber = (s: string): number | null => {
    const t = s.replace(/,/g, '');
    let total = 0, matched = false;
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(조|억|만|천)?/g)) {
        matched = true;
        const v = Number(m[1]); const u = m[2];
        total += v * (u === '조' ? 1e12 : u === '억' ? 1e8 : u === '만' ? 1e4 : u === '천' ? 1e3 : 1);
    }
    return matched ? total : null;
};
const NUM_RE = /\d[\d,]*(?:\.\d+)?(?:\s*(?:조|억|만|천)(?:\s*\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?)*)?/g;
const YEAR_RE = /(19|20)\d{2}(?=\s*년|\b)/g;
const MONTH_RE = /(1[0-2]|[1-9])\s*월/g;

type Pair = { label: string; value: number };
const chartPairs = (text: string): { pairs: Pair[]; ok: boolean } => {
    const m = text.match(/```json:chart\s*([\s\S]*?)```/);
    if (!m) return { pairs: [], ok: false };
    try {
        const j = JSON.parse(m[1]);
        const cats: unknown[] = j?.data?.categories ?? [];
        const s0 = j?.data?.series?.[0]?.data ?? [];
        const pairs: Pair[] = [];
        s0.forEach((d: any, i: number) => {
            const label = d && typeof d === 'object' ? String(d.x) : String(cats[i] ?? '');
            const value = Number(d && typeof d === 'object' ? d.y : d);
            if (label && Number.isFinite(value)) pairs.push({ label, value });
        });
        return { pairs, ok: true };
    } catch { return { pairs: [], ok: false }; }
};
// 범주 라벨에서 연도·월 키를 뽑는다("2021년"·"2021"·"1월"·"2025-03")
const labelKeys = (label: string): string[] => {
    const keys: string[] = [];
    const y = label.match(/(19|20)\d{2}/); if (y) keys.push(`Y${y[0]}`);
    const mo = label.match(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*월/) || label.match(/(?:19|20)\d{2}[-./](1[0-2]|0?[1-9])\b/);
    if (mo) keys.push(`M${Number(mo[1])}`);
    return keys;
};

let totalCompared = 0, totalConflict = 0, runsWithConflict = 0, runsWithChart = 0;
const summary: any[] = [];

for (const [qi, q] of QUERIES.entries()) {
    for (let r = 1; r <= RUNS; r++) {
        const t0 = Date.now();
        let res: any;
        try {
            res = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: [{ role: 'user', parts: [{ text: q }] }],
                config: { systemInstruction: sys, tools: [{ googleSearch: {} }] },
            });
        } catch (e: any) { console.log(`\n■ ${q} #${r} 오류 ${String(e?.status ?? e?.code ?? 'ERR')}`); continue; }
        const text: string = res.text ?? '';
        const gm: any = res.candidates?.[0]?.groundingMetadata ?? {};
        const domains: string[] = (gm.groundingChunks ?? []).map((c: any) => c?.web?.title || '?');
        const buf = Buffer.from(text, 'utf8');
        const segs: string[] = (gm.groundingSupports ?? []).map((sp: any) =>
            buf.subarray(sp.segment?.startIndex ?? 0, sp.segment?.endIndex ?? 0).toString('utf8'));
        const { pairs, ok } = chartPairs(text);
        if (ok) runsWithChart++;
        const byKey = new Map<string, Pair[]>();
        for (const p of pairs) for (const k of labelKeys(p.label)) byKey.set(k, [...(byKey.get(k) ?? []), p]);

        const compared: string[] = [], conflicts: string[] = [];
        for (const seg of segs) {
            // 문장 안 시점: 연도가 있으면 연도, 없으면 월
            const years = [...seg.matchAll(YEAR_RE)].map(m => `Y${m[0]}`);
            const months = [...seg.matchAll(MONTH_RE)].map(m => `M${Number(m[1])}`);
            const keys = years.length ? years : months;
            if (keys.length !== 1) continue; // 시점이 하나인 문장만 — 여럿이면 어느 숫자가 어느 시점인지 모호
            const cands = byKey.get(keys[0]); if (!cands || cands.length !== 1) continue;
            const chartV = cands[0].value;
            const nums = [...seg.matchAll(NUM_RE)].map(m => m[0])
                .filter(s => !/^(19|20)\d{2}$/.test(s.trim()) && !/^(1[0-2]|[1-9])$/.test(s.trim()))
                .map(parseKoNumber).filter((n): n is number => n !== null && n !== 0);
            if (!nums.length) continue;
            // 문장 숫자 중 차트 값과 가장 가까운 것(배수 ×1·×10³·×10⁴·×10⁸ 허용)
            let best = Infinity, bestN = 0;
            for (const n of nums) for (const f of [1, 1e3, 1e4, 1e8, 1e-3, 1e-4, 1e-8]) {
                const d = Math.abs(n * f - chartV) / Math.max(Math.abs(chartV), 1e-9);
                if (d < best) { best = d; bestN = n; }
            }
            const line = `${keys[0].slice(1)}${keys[0][0] === 'M' ? '월' : '년'} 본문 ${bestN} vs 차트 ${chartV} (차이 ${(best * 100).toFixed(1)}%)`;
            compared.push(line);
            if (best > 0.02) conflicts.push(line);
        }
        totalCompared += compared.length; totalConflict += conflicts.length; if (conflicts.length) runsWithConflict++;
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`\n■ ${q} #${r} (${sec}s) 차트 ${ok ? `${pairs.length}점` : '없음'} · 출처 ${domains.join(', ') || '-'}`);
        console.log(`  출처 붙은 문장 ${segs.length} · 비교 ${compared.length} · 불일치 ${conflicts.length}`);
        for (const c of compared) console.log(`    ${conflicts.includes(c) ? '❌' : '✓'} ${c}`);
        const clean = text.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com\/\S+/g, '<redirect>');
        writeFileSync(join(outDir, `q${qi + 1}-r${r}.md`), `# ${q} #${r}\n출처: ${domains.join(', ')}\n\n${clean}\n\n## 출처 붙은 문장\n${segs.map(s => `- ${s}`).join('\n')}\n`);
        summary.push({ q, r, chart: ok, points: pairs.length, domains, segs: segs.length, compared: compared.length, conflicts: conflicts.length });
    }
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n== 차트 있는 응답 ${runsWithChart}/${summary.length} · 비교 ${totalCompared} · 불일치 ${totalConflict} · 불일치 있는 응답 ${runsWithConflict}`);
console.log(`원문: ${outDir}`);
