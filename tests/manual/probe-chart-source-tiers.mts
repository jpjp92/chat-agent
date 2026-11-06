/**
 * 차트 출처 등급 실측 — `TIER1=1 npx tsx tests/manual/probe-chart-source-tiers.mts`
 *
 * 묻는 것 두 가지:
 *   ① 통계 차트 질문에서 grounding 출처가 어떤 도메인(공식·2차·블로그)으로 섞이는가
 *   ② groundingSupports(문장 구간 → 출처)가 json:chart 블록 안 수치까지 덮는가 — 덮지 않으면
 *      "차트 숫자가 어느 출처에서 왔나" 는 서버가 알 수 없다
 * 출력: 도메인·개수·구간 위치만. redirect URL·본문은 찍지 않는다.
 * 호출: 쿼리 3 × 2회 = 6 (유료 키, 검색 포함)
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
const key = process.env.TIER1 === '1' ? process.env.API_KEY_TIER1 : process.env.API_KEY;
if (!key) { console.error('키 없음 (TIER1=1 이면 API_KEY_TIER1)'); process.exit(1); }

const { GoogleGenAI } = await import('@google/genai');
const { getSystemInstruction, getRendererSections, getIntentPolicy } = await import('../../server/agent/prompt.js');
const ai = new GoogleGenAI({ apiKey: key });
const sys = [getSystemInstruction('Korean'), getRendererSections('data_viz' as any, 'Korean' as any), getIntentPolicy('data_viz' as any)].join('\n\n');

const QUERIES = ['한국 연도별 출생아 수 그래프 그려줘', '월별 서울 평균 기온 그래프', '미국 GDP 최근 5년 그래프'];
const RUNS = 2;

for (const q of QUERIES) {
    for (let r = 1; r <= RUNS; r++) {
        const t0 = Date.now();
        const res = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: [{ role: 'user', parts: [{ text: q }] }],
            config: { systemInstruction: sys, tools: [{ googleSearch: {} }] },
        });
        const text = res.text ?? '';
        const gm: any = res.candidates?.[0]?.groundingMetadata ?? {};
        const domains = (gm.groundingChunks ?? []).map((c: any) => c?.web?.title || c?.web?.domain || '?');
        const supports: any[] = gm.groundingSupports ?? [];
        // 차트 블록의 UTF-8 바이트 구간
        const m = text.match(/```json:chart[\s\S]*?```/);
        let inChart = 0, chartRange = '없음';
        if (m && m.index !== undefined) {
            const s = Buffer.byteLength(text.slice(0, m.index), 'utf8'), e = s + Buffer.byteLength(m[0], 'utf8');
            chartRange = `${s}~${e}B`;
            inChart = supports.filter(sp => (sp.segment?.endIndex ?? 0) > s && (sp.segment?.startIndex ?? 0) < e).length;
        }
        const queries = (gm.webSearchQueries ?? []).length;
        console.log(`\n■ ${q} #${r}  (${((Date.now() - t0) / 1000).toFixed(1)}s, 검색어 ${queries})`);
        console.log(`  출처 ${domains.length}: ${domains.join(', ') || '-'}`);
        console.log(`  supports ${supports.length} · 차트 블록 ${chartRange} · 차트 안을 덮는 support ${inChart}`);
        if (inChart > 0) {
            for (const sp of supports.filter(sp => m && (sp.segment?.endIndex ?? 0) > Buffer.byteLength(text.slice(0, m.index!), 'utf8')).slice(0, 3))
                console.log(`    · chunk ${JSON.stringify(sp.groundingChunkIndices)} → ${(sp.groundingChunkIndices ?? []).map((i: number) => domains[i]).join(', ')}`);
        }
    }
}
