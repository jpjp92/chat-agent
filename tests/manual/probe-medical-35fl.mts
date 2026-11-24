/**
 * 의학 품질 원인 확인 — 운영 medical_qa 경로(의학 지침 + 검색 강제 ON)로 2.5 Flash vs 3.5 Flash-Lite low·medium. 유료 키.
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-medical-35fl.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8-2 — 11-24 의학 비교는 검색·지침 없이 돌아 운영을 재현하지 못했다.
 * 채점: gpt-6-luna 블라인드, 항목별 점수와 감점 사유. 합성 질문만 — 답·사유는 scratchpad 경로(OUT)에만 저장한다.
 * 호출: 6 × 3 생성(검색) + 6 × 2 채점
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
const OUT = process.env.OUT ?? 'medical-35fl.json';
const { getSystemInstruction, getIntentPolicy } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const SYS = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n`
    + withSearchProviderInstruction(getSystemInstruction('Korean') + '\n\n' + getIntentPolicy('medical_qa'), 'google');

const QS = ['편두통이 잦을 때 병원 가야 하는 신호', '공복 혈당이 110이면 당뇨야?', '역류성 식도염에 피해야 할 습관',
    '아이가 열이 39도인데 해열제 먹여도 안 내려가', '불면증 개선 방법', '허리 디스크 초기 증상'];
const ARMS = [
    { id: '2.5', model: 'gemini-2.5-flash', gc: { temperature: 0.2, topP: 0.8, topK: 40, thinkingConfig: { thinkingBudget: 3000 } } },
    { id: '3.5FL-low', model: 'gemini-3.5-flash-lite', gc: { thinkingConfig: { thinkingLevel: 'LOW' } } },
    { id: '3.5FL-med', model: 'gemini-3.5-flash-lite', gc: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } },
];

async function gen(model: string, q: string, gc: any) {
    const t0 = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text: q }] }], tools: [{ googleSearch: {} }], generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    const j: any = await res.json().catch(() => null);
    const c = j?.candidates?.[0];
    const text = (c?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
    return { ok: res.ok && !!text, code: res.status, text, ms: Date.now() - t0, src: c?.groundingMetadata?.groundingChunks?.length ?? 0, queries: c?.groundingMetadata?.webSearchQueries?.length ?? 0, think: j?.usageMetadata?.thoughtsTokenCount ?? 0 };
}
const CRIT = ['accuracy', 'red_flags', 'actionable', 'evidence', 'clarity'] as const;
async function judge(q: string, a: string, b: string) {
    const rubric = `You grade two answers to a Korean user's health question for a chat assistant. Score each answer 1-10 on: accuracy (medically correct, no harmful or outdated claims), red_flags (clear warning signs and when to see a doctor or go to the ER), actionable (concrete, safe things the user can do now), evidence (claims grounded in cited or credible sources), clarity (structure, readable for a layperson). Length alone is not quality. Also give overall 1-10, winner, and for EACH answer the main reasons it lost points (Korean, at most 3 short items). Return JSON {"a":{"accuracy":n,"red_flags":n,"actionable":n,"evidence":n,"clarity":n,"overall":n,"minus":[".."]},"b":{...},"winner":"a"|"b"|"tie"}.`;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question: ${q}\n\n[Answer A]\n${a}\n\n[Answer B]\n${b}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(120_000) });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) { console.log(`  채점 HTTP ${res.status}`); return null; }
    const t = j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}';
    try {
        const o: any = Object.fromEntries(Object.entries(JSON.parse(t)).map(([k, v]) => [k.toLowerCase(), v]));
        if (!o.a?.overall || !o.b?.overall) { console.log('  채점 형식 이상'); return null; }
        return o;
    } catch { return null; }
}

const log: any[] = [];
const sum: Record<string, Record<string, number[]>> = {};
const add = (arm: string, k: string, v: number) => ((sum[arm] ??= {})[k] ??= []).push(Number(v));
for (const q of QS) {
    const rs = await Promise.all(ARMS.map(a => gen(a.model, q, a.gc)));
    const row: any = { q, gen: Object.fromEntries(ARMS.map((a, i) => [a.id, rs[i]])), judge: {} };
    ARMS.forEach((a, i) => { add(a.id, 'len', rs[i].text.length); add(a.id, 'ms', rs[i].ms); add(a.id, 'src', rs[i].src); add(a.id, 'think', rs[i].think); });
    if (rs.some(r => !r.ok)) { console.log(`✗ 생성 실패 ${rs.map(r => r.code).join('/')} "${q}"`); log.push(row); continue; }
    for (const i of [1, 2]) {
        const flip = Math.random() < 0.5;
        const v = await judge(q, flip ? rs[i].text : rs[0].text, flip ? rs[0].text : rs[i].text);
        if (!v) continue;
        const s25 = flip ? v.b : v.a, s35 = flip ? v.a : v.b;
        const w = v.winner === 'tie' ? 'tie' : (v.winner === 'a') !== flip ? '2.5' : ARMS[i].id;
        row.judge[ARMS[i].id] = { s25, s35, winner: w };
        for (const k of [...CRIT, 'overall']) { add(`2.5 vs ${ARMS[i].id}`, k, s25[k]); add(ARMS[i].id, k, s35[k]); }
        console.log(`  ${q.slice(0, 18).padEnd(18)} 2.5 ${s25.overall} vs ${ARMS[i].id} ${s35.overall} → ${w}`);
    }
    console.log(`    길이 ${rs.map(r => r.text.length).join('/')}자 · 출처 ${rs.map(r => r.src).join('/')} · 검색어 ${rs.map(r => r.queries).join('/')} · 생각토큰 ${rs.map(r => r.think).join('/')} · ${rs.map(r => (r.ms / 1000).toFixed(1)).join('/')}s`);
    log.push(row);
}
fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
const avg = (x?: number[]) => x?.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(1) : '-';
console.log('\n== 평균 (2.5 점수는 상대 팔별로 따로 채점됨)');
for (const [arm, m] of Object.entries(sum)) console.log(`  ${arm.padEnd(16)} ${['overall', ...CRIT, 'len', 'src', 'think', 'ms'].map(k => `${k} ${avg(m[k])}`).join(' · ')}`);
