/**
 * 최종 구성 vs 현행 2.5 — 3.5 FL(medical_qa medium · 그 외 minimal) 대 2.5 Flash(현행 설정). 스트리밍, 유료 키.
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-final-vs-25.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §9
 *   일반: 검색 없음 · 의학: medical_qa 지침 + 검색 · 검색: 검색 ON(채점 안 함 — 채점자가 최신 사실을 모른다)
 * 합성 질문만. 출력은 지연·토큰·점수만.
 * 호출: 18 × 2 생성 + 12 채점
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
const { getSystemInstruction, getIntentPolicy } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const HEAD = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n`;
type Kind = 'general' | 'medical' | 'search';
const SYS: Record<Kind, string> = {
    general: HEAD + withSearchProviderInstruction(getSystemInstruction('Korean'), 'none'),
    medical: HEAD + withSearchProviderInstruction(getSystemInstruction('Korean') + '\n\n' + getIntentPolicy('medical_qa'), 'google'),
    search: HEAD + withSearchProviderInstruction(getSystemInstruction('Korean'), 'google'),
};
const QS: Record<Kind, string[]> = {
    general: ['재택근무 집중력 높이는 방법 알려줘', '파이썬에서 리스트와 튜플 차이를 예시로 설명해줘', '첫 해외여행 준비물 체크리스트 만들어줘', '복리와 단리 차이를 예시 숫자로 설명해줘', '회의록 잘 쓰는 법', '초보자 주 3회 홈트 루틴 짜줘'],
    medical: ['편두통이 잦을 때 병원 가야 하는 신호', '공복 혈당이 110이면 당뇨야?', '역류성 식도염에 피해야 할 습관', '아이가 열이 39도인데 해열제 먹여도 안 내려가', '불면증 개선 방법', '허리 디스크 초기 증상'],
    search: ['오늘 원달러 환율', '이번 주 국내 주요 경제 뉴스 요약', '최신 아이폰 모델 가격', '올해 노벨 문학상 수상자', '서울 아파트 평균 매매가 최근 추이', '요즘 유행하는 독감 증상'],
};
const S = { temperature: 0.2, topP: 0.8, topK: 40 };
// 현행 2.5 설정(generator.ts): 의학 budget 3000 · 검색 budget 0 · 일반 기본
const cfg25 = (k: Kind) => k === 'medical' ? { ...S, thinkingConfig: { thinkingBudget: 3000 } } : k === 'search' ? { ...S, thinkingConfig: { thinkingBudget: 0 } } : S;
const cfg35 = (k: Kind) => ({ thinkingConfig: { thinkingLevel: k === 'medical' ? 'MEDIUM' : 'MINIMAL' } });

async function stream(model: string, k: Kind, q: string, gc: any) {
    const t0 = Date.now(); let ttft = 0, text = '', usage: any = {}, queries = 0, src = 0;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS[k] }] }, contents: [{ role: 'user', parts: [{ text: q }] }], ...(k !== 'general' ? { tools: [{ googleSearch: {} }] } : {}), generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    if (!res.ok || !res.body) return { ok: false, code: res.status, ttft: 0, ms: 0, text: '', inTok: 0, outTok: 0, think: 0, queries: 0, src: 0 };
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
            src = Math.max(src, c?.groundingMetadata?.groundingChunks?.length ?? 0);
        }
    }
    return { ok: !!text, code: res.status, ttft, ms: Date.now() - t0, text, inTok: usage.promptTokenCount ?? 0, outTok: usage.candidatesTokenCount ?? 0, think: usage.thoughtsTokenCount ?? 0, queries, src };
}
async function judge(k: Kind, q: string, a: string, b: string) {
    const rubric = `You grade two answers to a Korean user's question for a chat assistant. Criteria: correctness, completeness for what was asked, safety and when-to-see-a-doctor guidance for health questions, clarity. Length alone is not quality. Return JSON {"a":1-10,"b":1-10,"winner":"a"|"b"|"tie"}.`;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question (${k}): ${q}\n\n[Answer A]\n${a}\n\n[Answer B]\n${b}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    try { const o: any = Object.fromEntries(Object.entries(JSON.parse(j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}')).map(([kk, v]) => [kk.toLowerCase(), v])); return Number.isFinite(Number(o.a)) ? o : null; } catch { return null; }
}

// 토큰 비용 — 두 모델 모두 입력 $0.30 / 출력(생각 포함) $2.50 per 1M (공식 가격표 11-24)
const usd = (r: any) => (r.inTok * 0.30 + (r.outTok + r.think) * 2.50) / 1e6;
const acc: Record<string, any[]> = {}; const score: Record<string, { s: number[][]; w: Record<string, number> }> = {};
for (const k of ['general', 'medical', 'search'] as Kind[]) for (const q of QS[k]) {
    const [a, b] = await Promise.all([stream('gemini-2.5-flash', k, q, cfg25(k)), stream('gemini-3.5-flash-lite', k, q, cfg35(k))]);
    (acc[`${k} 2.5`] ??= []).push(a); (acc[`${k} 3.5FL`] ??= []).push(b);
    let note = '';
    if (k !== 'search' && a.ok && b.ok) {
        const flip = Math.random() < 0.5; const v = await judge(k, q, flip ? b.text : a.text, flip ? a.text : b.text);
        if (v) {
            const s25 = Number(flip ? v.b : v.a), s35 = Number(flip ? v.a : v.b);
            const w = String(v.winner).toLowerCase() === 'tie' ? '무' : (String(v.winner).toLowerCase() === 'a') !== flip ? '2.5' : '3.5FL';
            const t = score[k] ??= { s: [], w: {} }; t.s.push([s25, s35]); t.w[w] = (t.w[w] ?? 0) + 1; note = ` · 점수 ${s25}/${s35} ${w}`;
        }
    }
    console.log(`  ${k.padEnd(7)} ${q.slice(0, 16).padEnd(16)} 첫 글자 ${[a, b].map(r => r.ok ? (r.ttft / 1000).toFixed(1) : 'ERR' + r.code).join('/')}s · 전체 ${[a, b].map(r => (r.ms / 1000).toFixed(1)).join('/')}s${k !== 'general' ? ` · 출처 ${a.src}/${b.src}` : ''}${note}`);
}
const avg = (x: number[]) => x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0;
const max = (x: number[]) => Math.max(0, ...x);
console.log('\n== 요약 (2.5 / 3.5FL)');
for (const k of ['general', 'medical', 'search'] as Kind[]) {
    const [A, B] = [acc[`${k} 2.5`].filter(r => r.ok), acc[`${k} 3.5FL`].filter(r => r.ok)];
    const f = (fn: (r: any) => number, d = 1, div = 1) => [A, B].map(R => (avg(R.map(fn)) / div).toFixed(d)).join(' / ');
    console.log(`  ${k}`);
    console.log(`    첫 글자 평균 ${f(r => r.ttft, 1, 1000)}s · 최대 ${[A, B].map(R => (max(R.map(r => r.ttft)) / 1000).toFixed(1)).join(' / ')}s · 전체 평균 ${f(r => r.ms, 1, 1000)}s · 최대 ${[A, B].map(R => (max(R.map(r => r.ms)) / 1000).toFixed(1)).join(' / ')}s`);
    console.log(`    생각 ${f(r => r.think, 0)} · 출력 ${f(r => r.outTok, 0)} · 검색어 ${f(r => r.queries)} · 출처 ${f(r => r.src)} · 토큰비 $${f(r => usd(r) * 1000, 2)}/1천회 · 실패 ${acc[`${k} 2.5`].length - A.length}/${acc[`${k} 3.5FL`].length - B.length}`);
    if (score[k]) console.log(`    점수 ${avg(score[k].s.map(x => x[0])).toFixed(1)} / ${avg(score[k].s.map(x => x[1])).toFixed(1)} · 승 ${JSON.stringify(score[k].w)}`);
}
