/**
 * 차트-본문 수치 일치 — **앱 경로** 실측. `TIER1=1 npx tsx tests/manual/probe-chart-app-path.mts [outDir] [runs]`
 *
 * 1차(probe-chart-text-consistency)는 3.8 을 직접 불러 불일치 0 이었다. 앱에서 본 기온 불일치(22 vs 26.1)는
 * 재현되지 않았고, 앱 data_viz 턴은 2.5 로 강등된 로그가 있었다. 그래서 route.ts 와 같은 그래프
 * (라우터 → 검색 게이트 → 생성기, 강등 포함)와 같은 디스패치로 돌려 실제 쓰인 모델·검색 여부를 함께 기록한다.
 *
 * 출처 붙은 문장 = 본문에서 서버가 심은 `[N](url)` 마커 바로 앞 문장(gemini-citations 가 groundingSupports 위치에 심는다).
 * 판정: 문장 안 (시점, 수치) 짝 — 시점(연·월) 바로 뒤 30자 안의 첫 숫자 — 을 차트 같은 시점 값과 비교, 2% 넘으면 불일치.
 * 출력은 도메인·모델·수치만. 원문은 outDir 에 저장(redirect URL 제외).
 * 호출: 쿼리 8 × runs(기본 2) — 턴마다 라우터 1 + 생성 1~2 (유료 키)
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
if (process.env.TIER1 === '1') {
    const t = process.env.API_KEY_TIER1;
    if (!t) { console.error('API_KEY_TIER1 없음'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = t;
} else { console.log('⚠️ TIER1=1 없이 돈다 — 무료 키는 검색 턴이 강등돼 앱(회원)과 다르다'); }

const outDir = process.argv[2] || 'probe-out';
const RUNS = Number(process.argv[3] || 2);
mkdirSync(outDir, { recursive: true });

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { createStreamDispatch } = await import('../../server/agent/stream-dispatch.js');
const { HumanMessage } = await import('@langchain/core/messages');

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

// ── 수치 파싱 ──
const parseKoNumber = (s: string): number | null => {
    const t = s.replace(/,/g, '');
    let total = 0, matched = false;
    for (const m of t.matchAll(/(-?\d+(?:\.\d+)?)\s*(조|억|만|천)?/g)) {
        matched = true;
        const v = Number(m[1]); const u = m[2];
        total += v * (u === '조' ? 1e12 : u === '억' ? 1e8 : u === '만' ? 1e4 : u === '천' ? 1e3 : 1);
    }
    return matched ? total : null;
};
const NUM = String.raw`-?\d[\d,]*(?:\.\d+)?(?:\s*(?:조|억|만|천)(?:\s*\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?)*)?`;
// 시점: 2024년 · 2024 · 8월 · 2025년 11월
const TIME_RE = /((?:19|20)\d{2})\s*년?(?:\s*(1[0-2]|0?[1-9])\s*월)?|(?<![\d.])(1[0-2]|[1-9])\s*월/g;
const timeKey = (m: RegExpMatchArray) => (m[1] ? (m[2] ? `Y${m[1]}M${Number(m[2])}` : `Y${m[1]}`) : `M${Number(m[3])}`);

type Pair = { label: string; value: number };
const chartOf = (text: string) => {
    const m = text.match(/```json:chart\s*([\s\S]*?)```/);
    if (!m) return null;
    try {
        const j = JSON.parse(m[1]);
        const cats: unknown[] = j?.data?.categories ?? [];
        const pairs: Pair[] = [];
        (j?.data?.series?.[0]?.data ?? []).forEach((d: any, i: number) => {
            const label = d && typeof d === 'object' ? String(d.x) : String(cats[i] ?? '');
            const value = Number(d && typeof d === 'object' ? d.y : d);
            if (label && Number.isFinite(value)) pairs.push({ label, value });
        });
        return { pairs, unit: j?.yAxis?.unit as string | undefined };
    } catch { return { pairs: [] as Pair[], unit: undefined, broken: true }; }
};
// 범주 라벨 → 시점 키 여러 개(연·월·연월) — "25년 11월"·"2025.11"·"2025-11" 도
const labelKeys = (label: string): string[] => {
    const keys: string[] = [];
    const y4 = label.match(/(19|20)\d{2}/)?.[0];
    const y2 = !y4 ? label.match(/(?<!\d)(\d{2})\s*년/)?.[1] : undefined;
    const year = y4 ?? (y2 ? `20${y2}` : undefined);
    const mo = label.match(/(?<!\d)(1[0-2]|0?[1-9])\s*월/)?.[1] ?? label.match(/(?:19|20)\d{2}[-./](1[0-2]|0?[1-9])(?!\d)/)?.[1];
    if (year && mo) keys.push(`Y${year}M${Number(mo)}`);
    if (year && !mo) keys.push(`Y${year}`);
    if (mo) keys.push(`M${Number(mo)}`);
    return keys;
};
// 출처 붙은 문장 — 마커 앞 문장(줄바꿈·마침표 경계까지)
const groundedSentences = (text: string): string[] => {
    const out: string[] = [];
    const body = text.replace(/```[\s\S]*?```/g, m => ' '.repeat(m.length)); // 코드 블록은 문장이 아니다
    for (const mk of body.matchAll(/\[\d+\]\([^)]*\)/g)) {
        const before = body.slice(0, mk.index!).replace(/(\[\d+\]\([^)]*\))+$/, '');
        const start = Math.max(before.lastIndexOf('\n'), before.search(/[.!?]\s[^.!?]*$/));
        const s = before.slice(start + 1).trim();
        if (s && !out.includes(s)) out.push(s);
    }
    return out;
};
const FACTORS = [1, 1e3, 1e4, 1e6, 1e8, 1e9, 1e12, 1e-3, 1e-4, 1e-6, 1e-8, 1e-9, 1e-12];

let nTurns = 0, nChart = 0, nCompared = 0, nConflict = 0, nDowngraded = 0, nSearch = 0;
const summary: any[] = [];

for (const [qi, q] of QUERIES.entries()) {
    for (let r = 1; r <= RUNS; r++) {
        const t0 = Date.now();
        const dispatch = createStreamDispatch(() => {}, { timeZone: 'Asia/Seoul', lang: 'ko' });
        const st = dispatch.state;
        try {
            const graph = compileAgentGraph(getSystemInstruction('Korean'), false, dispatch.trackingEvent, 'Korean');
            const ev = await graph.streamEvents({
                messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })],
                webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
                model: 'gemini-3.8-flash', timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
                activeCards: [], cardContexts: [], lastTurnSearched: false, lastTurnSourceLabels: [],
            } as any, { version: 'v2' });
            for await (const e of ev as any) dispatch.handle(e);
        } catch (e: any) { console.log(`\n■ ${q} #${r} 오류 ${String(e?.status ?? e?.code ?? e?.name ?? 'ERR')}`); continue; }
        nTurns++;
        const text = st.fullAiResponse;
        const domains = st.allSources.map((s: any) => s.title);
        const model = st.turn.model ?? '?', search = !!st.turn.search;
        const downgraded = model !== 'gemini-3.8-flash';
        if (downgraded) nDowngraded++; if (search) nSearch++;
        const chart = chartOf(text);
        if (chart?.pairs.length) nChart++;
        const byKey = new Map<string, Pair[]>();
        for (const p of chart?.pairs ?? []) for (const k of labelKeys(p.label)) byKey.set(k, [...(byKey.get(k) ?? []), p]);

        const compared: string[] = [], conflicts: string[] = [];
        for (const sent of groundedSentences(text)) {
            const clean = sent.replace(/\[\d+\]\([^)]*\)/g, '').replace(/\*\*/g, '');
            const times = [...clean.matchAll(TIME_RE)];
            for (const [ti, tm] of times.entries()) {
                const k = timeKey(tm);
                const cands = byKey.get(k); if (!cands || cands.length !== 1) continue;
                // 이 시점 뒤 ~ 다음 시점 전, 30자 안의 첫 숫자
                const from = tm.index! + tm[0].length;
                const to = Math.min(from + 30, times[ti + 1]?.index ?? Infinity);
                const nm = clean.slice(from, to).match(new RegExp(NUM));
                if (!nm) continue;
                const n = parseKoNumber(nm[0]); if (n === null || n === 0) continue;
                const v = cands[0].value;
                let best = Infinity;
                for (const f of FACTORS) best = Math.min(best, Math.abs(n * f - v) / Math.max(Math.abs(v), 1e-9));
                const line = `${k} 본문 "${nm[0].trim()}" vs 차트 ${v}${chart?.unit ? ` ${chart.unit}` : ''} (차이 ${(best * 100).toFixed(1)}%)`;
                if (compared.includes(line)) continue;
                compared.push(line);
                if (best > 0.02) conflicts.push(line);
            }
        }
        nCompared += compared.length; nConflict += conflicts.length;
        console.log(`\n■ ${q} #${r} (${((Date.now() - t0) / 1000).toFixed(1)}s) ${model}${downgraded ? ' ⚠️강등' : ''} · 검색 ${search ? 'on' : 'off'}(${st.turn.searchBy ?? '-'}) · 의도 ${st.detectedIntent ?? '?'}`);
        console.log(`  차트 ${chart ? `${chart.pairs.length}점${chart.unit ? ` ${chart.unit}` : ''}` : '없음'} · 출처 ${domains.join(', ') || '-'}`);
        console.log(`  비교 ${compared.length} · 불일치 ${conflicts.length}`);
        for (const c of compared) console.log(`    ${conflicts.includes(c) ? '❌' : '✓'} ${c}`);
        const cleanText = text.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com\/[^\s)]+/g, '<redirect>');
        writeFileSync(join(outDir, `q${qi + 1}-r${r}.md`), `# ${q} #${r}\n모델 ${model} · 검색 ${search} · 의도 ${st.detectedIntent}\n출처: ${domains.join(', ')}\n\n${cleanText}\n`);
        summary.push({ q, r, model, downgraded, search, searchBy: st.turn.searchBy, intent: st.detectedIntent, chartPoints: chart?.pairs.length ?? 0, domains, compared: compared.length, conflicts });
    }
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n== 턴 ${nTurns} · 강등 ${nDowngraded} · 검색 on ${nSearch} · 차트 ${nChart} · 비교 ${nCompared} · 불일치 ${nConflict}`);
console.log(`원문: ${outDir}`);
