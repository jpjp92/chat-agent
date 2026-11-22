/**
 * 최신성 규칙 일반화·부작용(E2) — `MODELS=gemini-3.8-flash,gemini-3.6-flash RUNS=2 npx tsx tests/manual/probe-recency-e2.mts`
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2
 *
 * 최신성 질문 4 + 대조 2(옛 모델을 지정한 질문 · 최신성과 무관한 질문). base/rule 두 팔.
 * 정답표 없이 본다: ① 첫 검색어가 기억 속 번호 대신 현재 라인업 검색인가 ② 고른 세대가 팔 사이에서 어떻게 달라지나
 * ③ 대조 질문에서 규칙이 엉뚱하게 최신 모델로 끌고 가거나 라인업 검색을 붙이지 않나.
 * 답 원문은 저장·출력하지 않는다 — 세대 번호와 검색어만. 합성 질문, 유료 키(TIER1).
 * 미출시 표시(E2b): `future` 로 지정한 세대를 언급하면 — ⚠️ 그 세대가 정말 미출시인지 공식 출처로 먼저 확인할 것(11-22: M6 를 루머로 잘못 지정했다, 실제 현행). 언급하면 그 앞뒤 120자에 미출시·루머·예정 표시가 있는가.
 * 좁히기: `QIDS=macbook,fold ARMS=rule`
 * 호출: 문항 수 × 팔 수 × 모델 수 × RUNS
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { RECENCY_RULE, DATE_LINE } from './recency-rule-text.mts';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });
const MODELS = (process.env.MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash').split(',');
const RUNS = Number(process.env.RUNS ?? 2);
const ARMS = (process.env.ARMS ?? 'base,rule').split(',') as ('base' | 'rule')[];
const QIDS = process.env.QIDS?.split(',');
const CONC = Number(process.env.CONC ?? 4);

type Q = { id: string; q: string; gen: RegExp; control?: 'old' | 'none'; future?: RegExp };
const QUESTIONS: Q[] = [
    { id: 'macbook', q: '최신 맥북 프로 칩 성능 비교해줘', gen: /\bM(\d{1,2})\b/g, future: /\bM6\b/ },
    { id: 'nvidia', q: '엔비디아 최신 그래픽카드 라인업 정리해줘', gen: /RTX\s*(\d{2})\d{2}/gi },
    { id: 'ipad', q: '애플 최신 아이패드 프로 가격 알려줘', gen: /\bM(\d{1,2})\b/g },
    { id: 'fold', q: '갤럭시 Z 폴드 최신 모델 가격 알려줘', gen: /(?:폴드|Fold)\s*(\d{1,2})/gi, future: /(?:폴드|Fold)\s*9/i },
    { id: 'old', q: '아이폰 13 배터리 용량 알려줘', gen: /(?:아이폰|iPhone)\s*(\d{2})/gi, control: 'old' },
    { id: 'none', q: '스마트폰 배터리 오래 쓰는 법 알려줘', gen: /$^/g, control: 'none' },
];
const LINEUP_QUERY = /(latest|newest|current|최신|lineup|라인업)/i;
const YEAR_IN_QUERY = /\b2026\b/;

type Row = { model: string; arm: string; id: string; gens: string; future: string; firstQ: string; lineupFirst: boolean; anyLineup: boolean; year: boolean; n: number; sec: number; err?: string };
const jobs: { model: string; arm: typeof ARMS[number]; q: Q; r: number }[] = [];
for (let r = 0; r < RUNS; r++) for (const model of MODELS) for (const q of QUESTIONS.filter(x => !QIDS || QIDS.includes(x.id))) for (const arm of ARMS) jobs.push({ model, arm, q, r });
console.log(`호출 ${jobs.length}회 (${QIDS?.length ?? QUESTIONS.length}문항 × ${ARMS.length}팔 × ${MODELS.length}모델 × ${RUNS}회)`);

const rows: Row[] = [];
let next = 0;
const worker = async () => {
    while (next < jobs.length) {
        const j = jobs[next++];
        const t0 = Date.now();
        try {
            const res: any = await ai.models.generateContent({
                model: j.model, contents: j.q.q,
                config: { systemInstruction: j.arm === 'rule' ? DATE_LINE + RECENCY_RULE : DATE_LINE, tools: [{ googleSearch: {} }] },
            });
            const text: string = res.text ?? '';
            const qs: string[] = res.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
            const gens = [...new Set([...text.matchAll(j.q.gen)].map(m => m[1]).filter(Boolean))].sort((a, b) => +a - +b).join('/') || '-';
            const UNRELEASED = /(미출시|출시\s*예정|출시\s*전|루머|유출|소문|예상|전망|공개\s*예정|발표\s*예정|rumou?r|leak|upcoming|expected|unreleased)/i;
            let future = '-';
            if (j.q.future) {
                const hits = [...text.matchAll(new RegExp(j.q.future.source, 'gi'))];
                future = hits.length === 0 ? '언급 없음' : hits.every(h => UNRELEASED.test(text.slice(Math.max(0, h.index! - 120), h.index! + 120))) ? `언급 ${hits.length} · 표시 ✅` : `언급 ${hits.length} · 표시 ❌`;
            }
            rows.push({ model: j.model, arm: j.arm, id: j.q.id, gens, future, firstQ: qs[0] ?? '(검색 없음)', lineupFirst: LINEUP_QUERY.test(qs[0] ?? ''), anyLineup: qs.some(x => LINEUP_QUERY.test(x)), year: qs.some(x => YEAR_IN_QUERY.test(x)), n: qs.length, sec: (Date.now() - t0) / 1000 });
        } catch (e: any) {
            rows.push({ model: j.model, arm: j.arm, id: j.q.id, gens: '-', future: '-', firstQ: '', lineupFirst: false, anyLineup: false, year: false, n: 0, sec: (Date.now() - t0) / 1000, err: String(e?.status ?? e?.code ?? e?.name) });
        }
    }
};
await Promise.all(Array.from({ length: CONC }, worker));

for (const q of QUESTIONS.filter(x => !QIDS || QIDS.includes(x.id))) {
    console.log(`\n■ ${q.id}${q.control ? ` (대조: ${q.control})` : ''} — ${q.q}`);
    for (const model of MODELS) for (const arm of ARMS) {
        const rs = rows.filter(x => x.model === model && x.arm === arm && x.id === q.id);
        const cell = rs.map(x => x.err ? `오류 ${x.err}` : `${x.gens}${x.future !== '-' ? ` (미출시 ${x.future})` : ''}${x.lineupFirst ? ' [L]' : ''}${x.year ? ' [Y]' : ''} ${x.sec.toFixed(0)}s`).join(' | ');
        console.log(`  ${model.padEnd(17)} ${arm.padEnd(4)} ${cell}`);
        for (const x of rs) if (!x.err) console.log(`      첫 검색어: ${JSON.stringify(x.firstQ)} (검색 ${x.n}개${x.anyLineup && !x.lineupFirst ? ', 라인업 검색 포함' : ''})`);
    }
}
console.log('\n[L] 첫 검색어가 최신·라인업 검색 · [Y] 검색어에 2026');
