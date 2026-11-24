/**
 * 첫 글자 시간(TTFT)·토큰 비용 — 스트리밍, 유료 키. `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-35fl-ttft.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8-2 — medical_qa 를 3.5 FL medium 으로, 일반도 medium 으로 갈지.
 *   의학: 운영 medical_qa 경로(지침 + 검색) · 2.5 budget 3000 / 3.5 FL low / 3.5 FL medium
 *   일반: 검색 없음 · 3.5 FL minimal / medium + gpt-6-luna 블라인드 채점
 * 합성 질문만. 출력은 지연·토큰·점수만.
 * 호출: 6 × 3 + 6 × 2 생성 + 6 채점
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
const { getSystemInstruction, getIntentPolicy } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const HEAD = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n`;
const SYS_MED = HEAD + withSearchProviderInstruction(getSystemInstruction('Korean') + '\n\n' + getIntentPolicy('medical_qa'), 'google');
const SYS_GEN = HEAD + withSearchProviderInstruction(getSystemInstruction('Korean'), 'none');

const MED = ['편두통이 잦을 때 병원 가야 하는 신호', '공복 혈당이 110이면 당뇨야?', '역류성 식도염에 피해야 할 습관',
    '아이가 열이 39도인데 해열제 먹여도 안 내려가', '불면증 개선 방법', '허리 디스크 초기 증상'];
const GEN = ['재택근무 집중력 높이는 방법 알려줘', '파이썬에서 리스트와 튜플 차이를 예시로 설명해줘', '첫 해외여행 준비물 체크리스트 만들어줘',
    '복리와 단리 차이를 예시 숫자로 설명해줘', '회의록 잘 쓰는 법', '초보자 주 3회 홈트 루틴 짜줘'];
const S = { temperature: 0.2, topP: 0.8, topK: 40 };
const lv = (l: string) => ({ thinkingConfig: { thinkingLevel: l } });

async function stream(model: string, sys: string, q: string, gc: any, search: boolean) {
    const t0 = Date.now(); let ttft = 0, text = '', usage: any = {}, queries = 0;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: q }] }], ...(search ? { tools: [{ googleSearch: {} }] } : {}), generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    if (!res.ok || !res.body) return { ok: false, code: res.status, ttft: 0, ms: 0, text: '', inTok: 0, outTok: 0, think: 0, queries: 0 };
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body as any) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const j = JSON.parse(line.slice(5)); const c = j.candidates?.[0];
            const t = (c?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
            if (t && !ttft) ttft = Date.now() - t0;
            text += t; if (j.usageMetadata) usage = j.usageMetadata;
            queries = Math.max(queries, c?.groundingMetadata?.webSearchQueries?.length ?? 0);
        }
    }
    return { ok: !!text, code: res.status, ttft, ms: Date.now() - t0, text, inTok: usage.promptTokenCount ?? 0, outTok: usage.candidatesTokenCount ?? 0, think: usage.thoughtsTokenCount ?? 0, queries };
}
async function judge(q: string, a: string, b: string) {
    const rubric = `You grade two answers to a Korean user's question for a chat assistant. Criteria: correctness, completeness for what was asked, clarity. Length alone is not quality. Return JSON {"a":1-10,"b":1-10,"winner":"a"|"b"|"tie"}.`;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question: ${q}\n\n[Answer A]\n${a}\n\n[Answer B]\n${b}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    try { const o: any = Object.fromEntries(Object.entries(JSON.parse(j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}')).map(([k, v]) => [k.toLowerCase(), v])); return Number.isFinite(Number(o.a)) ? o : null; } catch { return null; }
}

const acc: Record<string, any[]> = {};
// 토큰 비용 — 두 모델 모두 입력 $0.30 / 출력(생각 포함) $2.50 per 1M (공식 가격표 11-24)
const usd = (r: any) => (r.inTok * 0.30 + (r.outTok + r.think) * 2.50) / 1e6;
const run = async (group: string, arms: { id: string; model: string; gc: any }[], qs: string[], sys: string, search: boolean, doJudge: boolean) => {
    for (const q of qs) {
        const rs = await Promise.all(arms.map(a => stream(a.model, sys, q, a.gc, search)));
        arms.forEach((a, i) => (acc[`${group} ${a.id}`] ??= []).push(rs[i]));
        let note = '';
        if (doJudge && rs.every(r => r.ok)) {
            const flip = Math.random() < 0.5; const v = await judge(q, flip ? rs[1].text : rs[0].text, flip ? rs[0].text : rs[1].text);
            if (v) { const s0 = Number(flip ? v.b : v.a), s1 = Number(flip ? v.a : v.b); (acc[`${group} 점수`] ??= []).push([s0, s1]); note = ` · 점수 ${s0}/${s1}`; }
        }
        console.log(`  ${group} ${q.slice(0, 16).padEnd(16)} 첫 글자 ${rs.map(r => r.ok ? (r.ttft / 1000).toFixed(1) : 'ERR' + r.code).join('/')}s · 전체 ${rs.map(r => (r.ms / 1000).toFixed(1)).join('/')}s · 생각 ${rs.map(r => r.think).join('/')}${note}`);
    }
};
await run('의학', [
    { id: '2.5', model: 'gemini-2.5-flash', gc: { ...S, thinkingConfig: { thinkingBudget: 3000 } } },
    { id: '3.5FL-low', model: 'gemini-3.5-flash-lite', gc: lv('LOW') },
    { id: '3.5FL-med', model: 'gemini-3.5-flash-lite', gc: lv('MEDIUM') },
], MED, SYS_MED, true, false);
await run('일반', [
    { id: '3.5FL-min', model: 'gemini-3.5-flash-lite', gc: lv('MINIMAL') },
    { id: '3.5FL-med', model: 'gemini-3.5-flash-lite', gc: lv('MEDIUM') },
], GEN, SYS_GEN, false, true);

const avg = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;
const pct = (x: number[], p: number) => [...x].sort((a, b) => a - b)[Math.min(x.length - 1, Math.floor(x.length * p))] ?? 0;
console.log('\n== 요약');
for (const [k, rs] of Object.entries(acc)) {
    if (k.endsWith('점수')) { console.log(`  ${k.padEnd(16)} minimal ${avg(rs.map((r: any) => r[0])).toFixed(1)} · medium ${avg(rs.map((r: any) => r[1])).toFixed(1)}`); continue; }
    const ok = rs.filter((r: any) => r.ok);
    console.log(`  ${k.padEnd(16)} 첫 글자 평균 ${(avg(ok.map((r: any) => r.ttft)) / 1000).toFixed(1)}s · 최대 ${(pct(ok.map((r: any) => r.ttft), 1) / 1000).toFixed(1)}s · 전체 평균 ${(avg(ok.map((r: any) => r.ms)) / 1000).toFixed(1)}s · 생각 ${avg(ok.map((r: any) => r.think)).toFixed(0)} · 출력 ${avg(ok.map((r: any) => r.outTok)).toFixed(0)} · 입력 ${avg(ok.map((r: any) => r.inTok)).toFixed(0)} · 검색어 ${avg(ok.map((r: any) => r.queries)).toFixed(1)} · 토큰비 $${(avg(ok.map(usd)) * 1000).toFixed(2)}/1천회 · 실패 ${rs.length - ok.length}`);
}
