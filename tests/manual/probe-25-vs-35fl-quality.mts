/**
 * 품질 비교 — 2.5 Flash(현행 설정) vs 3.5 Flash-Lite(`minimal`), 유료 키. `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-25-vs-35fl-quality.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8-2 — 강등·재시도·의학 경로가 3.5 FL 로 가도 되는가.
 * 운영 시스템 프롬프트 + 같은 질문. 채점은 gpt-6-luna 블라인드(A/B 순서 무작위). 합성 질문만, 답 원문은 출력하지 않는다(점수·승패만).
 * 호출: 18 × 2 생성 + 18 채점
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const SYS = (search: boolean) => `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n` + withSearchProviderInstruction(getSystemInstruction('Korean'), search ? 'google' : 'none');

const CASES: { kind: 'general' | 'medical' | 'search'; q: string }[] = [
    { kind: 'general', q: '재택근무 집중력 높이는 방법 알려줘' },
    { kind: 'general', q: '파이썬에서 리스트와 튜플 차이를 예시로 설명해줘' },
    { kind: 'general', q: '첫 해외여행 준비물 체크리스트 만들어줘' },
    { kind: 'general', q: '복리와 단리 차이를 예시 숫자로 설명해줘' },
    { kind: 'general', q: '회의록 잘 쓰는 법' },
    { kind: 'general', q: '초보자 주 3회 홈트 루틴 짜줘' },
    { kind: 'medical', q: '편두통이 잦을 때 병원 가야 하는 신호' },
    { kind: 'medical', q: '공복 혈당이 110이면 당뇨야?' },
    { kind: 'medical', q: '역류성 식도염에 피해야 할 습관' },
    { kind: 'medical', q: '아이가 열이 39도인데 해열제 먹여도 안 내려가' },
    { kind: 'medical', q: '불면증 개선 방법' },
    { kind: 'medical', q: '허리 디스크 초기 증상' },
    { kind: 'search', q: '오늘 원달러 환율' },
    { kind: 'search', q: '이번 주 국내 주요 경제 뉴스 요약' },
    { kind: 'search', q: '최신 아이폰 모델 가격' },
    { kind: 'search', q: '올해 노벨 문학상 수상자' },
    { kind: 'search', q: '서울 아파트 평균 매매가 최근 추이' },
    { kind: 'search', q: '요즘 유행하는 독감 증상' },
];
const S = { temperature: 0.2, topP: 0.8, topK: 40 };
const cfg25 = (k: string) => k === 'medical' ? { ...S, thinkingConfig: { thinkingBudget: 3000 } } : k === 'search' ? { ...S, thinkingConfig: { thinkingBudget: 0 } } : S;
// LEVEL35=LOW|MEDIUM 로 3.5 FL 생각 수준을 바꾼다 · KINDS=medical 처럼 종류를 좁힌다
const cfg35 = { thinkingConfig: { thinkingLevel: process.env.LEVEL35 ?? 'MINIMAL' } };

async function gen(model: string, q: string, kind: string, gc: any) {
    const t0 = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS(kind === 'search') }] }, contents: [{ role: 'user', parts: [{ text: q }] }], ...(kind === 'search' ? { tools: [{ googleSearch: {} }] } : {}), generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    const j: any = await res.json().catch(() => null);
    const c = j?.candidates?.[0];
    const text = (c?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
    return { ok: res.ok && !!text, text, ms: Date.now() - t0, src: c?.groundingMetadata?.groundingChunks?.length ?? 0, code: res.status };
}
async function judge(q: string, kind: string, a: string, b: string) {
    const rubric = `You grade two answers to a Korean user's question for a chat assistant. Criteria: correctness, completeness for what was asked, safety and when-to-see-a-doctor guidance for health questions, use of current facts for news/price questions, clarity. Length alone is not quality. Return JSON {"a":1-10,"b":1-10,"winner":"a"|"b"|"tie"}.`;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question (${kind}): ${q}\n\n[Answer A]\n${a}\n\n[Answer B]\n${b}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(90_000) });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) { console.log(`  채점 HTTP ${res.status}`); return null; }
    const t = j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}';
    // 키 대소문자·이름이 흔들린다(A/B, score_a 등) — 소문자로 맞추고 숫자를 골라낸다
    try {
        const o: any = Object.fromEntries(Object.entries(JSON.parse(t)).map(([k, v]) => [k.toLowerCase(), v]));
        const num = (k: string) => Number(o[k] ?? o[`score_${k}`] ?? o[`${k}_score`] ?? o.scores?.[k] ?? o.scores?.[k.toUpperCase()]);
        const w = String(o.winner ?? '').toLowerCase();
        const r = { a: num('a'), b: num('b'), winner: w === 'a' || w === 'b' || w === 'tie' ? w : null };
        if (!Number.isFinite(r.a) || !Number.isFinite(r.b) || !r.winner) { console.log('  채점 형식 이상 keys=' + Object.keys(o).join(',')); return null; }
        return r;
    } catch { return null; }
}
const tally: Record<string, { w25: number; w35: number; tie: number; s25: number; s35: number; n: number; ms25: number[]; ms35: number[]; src25: number; src35: number; fail: number }> = {};
for (const c of CASES.filter(c => !process.env.KINDS || process.env.KINDS.split(',').includes(c.kind))) {
    const [r25, r35] = await Promise.all([gen('gemini-2.5-flash', c.q, c.kind, cfg25(c.kind)), gen('gemini-3.5-flash-lite', c.q, c.kind, cfg35)]);
    const t = tally[c.kind] ??= { w25: 0, w35: 0, tie: 0, s25: 0, s35: 0, n: 0, ms25: [], ms35: [], src25: 0, src35: 0, fail: 0 };
    if (!r25.ok || !r35.ok) { t.fail++; console.log(`✗ ${c.kind} 생성 실패 2.5=${r25.code} 3.5FL=${r35.code} "${c.q}"`); continue; }
    const flip = Math.random() < 0.5;
    const v = await judge(c.q, c.kind, flip ? r35.text : r25.text, flip ? r25.text : r35.text);
    if (!v) { t.fail++; continue; }
    const s25 = flip ? v.b : v.a, s35 = flip ? v.a : v.b;
    const w = v.winner === 'tie' ? 'tie' : (v.winner === 'a') !== flip ? '2.5' : '3.5FL';
    t.n++; t.s25 += s25; t.s35 += s35; if (w === 'tie') t.tie++; else if (w === '2.5') t.w25++; else t.w35++;
    t.ms25.push(r25.ms); t.ms35.push(r35.ms); t.src25 += r25.src; t.src35 += r35.src;
    console.log(`  ${c.kind.padEnd(7)} 2.5 ${s25} vs 3.5FL ${s35} → ${w.padEnd(5)} | ${(r25.ms / 1000).toFixed(1)}s/${(r35.ms / 1000).toFixed(1)}s · ${r25.text.length}/${r35.text.length}자${c.kind === 'search' ? ` · 출처 ${r25.src}/${r35.src}` : ''} "${c.q}"`);
}
const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)] ?? 0;
console.log('\n== 종류별');
for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(7)} 평균 2.5 ${(t.s25 / t.n).toFixed(1)} · 3.5FL ${(t.s35 / t.n).toFixed(1)} | 승 2.5 ${t.w25} · 3.5FL ${t.w35} · 무 ${t.tie} | 지연 중앙 ${(med(t.ms25) / 1000).toFixed(1)}s/${(med(t.ms35) / 1000).toFixed(1)}s${k === 'search' ? ` | 출처 합 ${t.src25}/${t.src35}` : ''}${t.fail ? ` | 실패 ${t.fail}` : ''}`);
