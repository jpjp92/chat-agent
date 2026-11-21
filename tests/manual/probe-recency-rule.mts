/**
 * 최신성 규칙 A/B — `npx tsx tests/manual/probe-recency-rule.mts [결과.json]`
 * 계획: docs/plans/PLAN_RECENCY_SEARCH_261120.md
 *
 * 유료 호출 = 질문 6 × 모델 2 × 반복 N(기본 5, `RUNS=`) × 팔 2(`ARMS=base,rule`). 합성 질문만.
 * 운영 그래프를 거치지 않는 독립 프로브 — 검색 도구·날짜 블록만 운영과 같게 맞춘다.
 * 채점: 정답 키워드(가장 최신 항목) 포함 여부 · 기준 날짜 명시 여부. 답 본문은 결과 파일로 남겨 사람이 본다.
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });
const RUNS = Number(process.env.RUNS ?? 5);
const ARMS = (process.env.ARMS ?? 'base,rule').split(',');
const MODELS = (process.env.MODELS ?? 'gemini-3.8-flash,gpt-6-luna').split(',');

const now = new Date();
const dateStr = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' });
// 운영 prompt-assembly.ts 의 날짜 블록과 같은 문장
const TIME_BLOCK = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): ${dateStr}]\n`
    + `- This is the ONLY source for today's date. Never infer it from search results, article publication dates, or your training data.\n`
    + `- Just after midnight most search results are from the previous day. That does NOT change today's date — it is still the value above.\n`
    + `- If the user asks for "today" and the newest material you found is from an earlier date, give that material but say in one short sentence which date it is from and that little has been published yet today. Do not silently present an earlier date's material as today's.\n`;
// 개선안 — 계획 §3
const RECENCY_RULE = `[RECENCY]
When the user asks for the latest / newest / recent / current state of something (models, versions, lineups, prices, policies, news):
- Put the current year and month (from CURRENT_SYSTEM_TIME) into your search queries.
- Check each source's publication or announcement date. Build the answer on the most recent sources; a source's rank in the results does not mean it is recent.
- If search results disagree with what you remember, the dated search results win.
- Prefer the official source (the vendor's own blog, docs, or announcement) for product lineups and releases.
- State the date your answer is based on in one short phrase (e.g. "11월 18일 발표 기준").
`;
const BASE_SYS = '한국어로 답한다. 표가 어울리면 표를 쓴다.';

// 정답 = 질문 시점(2026-11-20) 가장 최신 항목. 대소문자·공백 무시 정규식
const QUESTIONS: { id: string; q: string; must: RegExp; stale?: RegExp }[] = [
    { id: 'gemini-lineup', q: '제미나이 최신 모델들 정리해줘', must: /gemini\s*4|제미나이\s*4/i, stale: /2\.0\s*(및|과|와|\/)\s*2\.5\s*라인업|최신.{0,10}2\.5/ },
    { id: 'openai-lineup', q: 'OpenAI 최신 모델 뭐 있어?', must: /gpt[-\u2010\u2011\s]*6/i },
    { id: 'claude-lineup', q: '요즘 클로드 최신 모델이 뭐야?', must: /claude\s*(opus|sonnet|haiku|fable)?\s*5|오퍼스\s*5|소네트\s*5|claude\s*5/i },
    { id: 'gemini-decision', q: '구글이 최근에 낸 판단(Decisions) API 뭐야?', must: /decision[s]?\s*(api|1)|decision-1/i },
    { id: 'gemini-price', q: '제미나이 3.6 플래시 가격 바뀐다던데 언제부터 얼마야?', must: /2027/ },
    { id: 'gemini-hydrogen', q: 'Gemini 4 Hydrogen 최근 나온 거 맞아? 특징 알려줘', must: /hydrogen/i, stale: /존재하지\s*않|확인되지\s*않|공식.{0,6}없/ },
];
const DATE_RE = /\d{4}\s*년\s*\d{1,2}\s*월|\d{1,2}\s*월\s*\d{1,2}\s*일|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;

async function callGemini(model: string, sys: string, q: string) {
    const r = await ai.models.generateContent({ model, contents: q, config: { systemInstruction: sys, tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: 'low' as any } } });
    const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const queries = r.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
    return { text: r.text ?? '', sources: chunks.length, queries };
}
async function callOpenAI(model: string, sys: string, q: string) {
    const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY_TIER1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, instructions: sys, input: q, tools: [{ type: 'web_search' }], reasoning: { effort: 'low' }, include: ['web_search_call.action.sources'] }),
    });
    const j: any = await res.json();
    if (!res.ok) throw Object.assign(new Error(j?.error?.code ?? 'http'), { status: res.status });
    let text = '', sources = 0; const queries: string[] = [];
    for (const it of j.output ?? []) {
        if (it.type === 'web_search_call') { if (it.action?.query) queries.push(it.action.query); sources += it.action?.sources?.length ?? 0; }
        if (it.type === 'message') for (const c of it.content ?? []) if (c.type === 'output_text') text += c.text;
    }
    return { text, sources, queries };
}

type Job = { arm: string; model: string; qi: number; run: number };
const jobs: Job[] = [];
for (let run = 0; run < RUNS; run++) for (const model of MODELS) for (let qi = 0; qi < QUESTIONS.length; qi++) for (const arm of ARMS) jobs.push({ arm, model, qi, run });
console.log(`호출 ${jobs.length}회 (${QUESTIONS.length}문항 × ${MODELS.length}모델 × ${RUNS}회 × ${ARMS.length}팔)`);

const rows: any[] = [];
let next = 0;
async function worker() {
    while (next < jobs.length) {
        const j = jobs[next++]; const item = QUESTIONS[j.qi];
        const sys = `${TIME_BLOCK}\n${j.arm === 'rule' ? RECENCY_RULE + '\n' : ''}${BASE_SYS}`;
        const t0 = Date.now();
        try {
            const r = j.model.startsWith('gpt') ? await callOpenAI(j.model, sys, item.q) : await callGemini(j.model, sys, item.q);
            const row = { ...j, id: item.id, ms: Date.now() - t0, ok: item.must.test(r.text), stale: item.stale ? item.stale.test(r.text) : false, dated: DATE_RE.test(r.text), monthInQuery: r.queries.some(q => /2026|11월|november/i.test(q)), sources: r.sources, queries: r.queries, text: r.text };
            rows.push(row);
            console.log(`${j.arm.padEnd(4)} ${j.model.padEnd(16)} ${item.id.padEnd(16)} ok=${row.ok ? 'Y' : 'n'} stale=${row.stale ? 'Y' : '-'} dated=${row.dated ? 'Y' : 'n'} qDate=${row.monthInQuery ? 'Y' : 'n'} src=${r.sources} ${row.ms}ms`);
        } catch (e: any) {
            rows.push({ ...j, id: item.id, err: `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 80)}` });
            console.log(`${j.arm} ${j.model} ${item.id} ❌ ${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 80)}`);
        }
    }
}
await Promise.all(Array.from({ length: Number(process.env.CONC ?? 6) }, worker));

console.log('\n팔    모델              n  err  정답   낡은답  날짜명시  검색어연월  p50ms');
for (const arm of ARMS) for (const model of MODELS) {
    const rs = rows.filter(r => r.arm === arm && r.model === model), ok = rs.filter(r => !r.err);
    const pct = (f: (r: any) => boolean) => `${ok.filter(f).length}/${ok.length}`;
    const ms = ok.map(r => r.ms).sort((a, b) => a - b);
    console.log(`${arm.padEnd(5)} ${model.padEnd(17)} ${String(rs.length).padStart(2)}  ${String(rs.length - ok.length).padStart(3)}  ${pct(r => r.ok).padStart(5)}  ${pct(r => r.stale).padStart(5)}  ${pct(r => r.dated).padStart(7)}  ${pct(r => r.monthInQuery).padStart(8)}  ${ms[Math.floor(ms.length / 2)] ?? '-'}`);
}
console.log('\n문항별 정답(base → rule)');
for (const model of MODELS) for (const item of QUESTIONS) {
    const c = (arm: string) => { const rs = rows.filter(r => r.arm === arm && r.model === model && r.id === item.id && !r.err); return `${rs.filter(r => r.ok).length}/${rs.length}`; };
    console.log(`${model.padEnd(17)} ${item.id.padEnd(16)} ${ARMS.map(c).join(' → ')}`);
}
const out = process.argv[2];
if (out) { fs.writeFileSync(out, JSON.stringify({ at: now.toISOString(), rows }, null, 1)); console.log(`\n답 본문 저장: ${out}`); }
