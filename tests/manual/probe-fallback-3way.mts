/**
 * 폴백 모델 3자 비교 — 2.5 Flash(현행) · 3.5 Flash-Lite(일반 minimal · 의학 low) · 3.6 Flash(minimal), 유료 키.
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-fallback-3way.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8-3 · 세 답을 무작위 순서로 한 번에 블라인드 채점(gpt-6-luna).
 * 일반·의학만(검색은 채점 모델이 최신 사실을 확인 못 해 §8-2 에서 판단 불가). 합성 질문, 점수만 출력. 호출 12×3 + 12
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const SYS = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n` + withSearchProviderInstruction(getSystemInstruction('Korean'), 'none');
const Q: [string, string][] = [
    ['general', '재택근무 집중력 높이는 방법 알려줘'], ['general', '파이썬에서 리스트와 튜플 차이를 예시로 설명해줘'], ['general', '첫 해외여행 준비물 체크리스트 만들어줘'],
    ['general', '복리와 단리 차이를 예시 숫자로 설명해줘'], ['general', '회의록 잘 쓰는 법'], ['general', '초보자 주 3회 홈트 루틴 짜줘'],
    ['medical', '편두통이 잦을 때 병원 가야 하는 신호'], ['medical', '공복 혈당이 110이면 당뇨야?'], ['medical', '역류성 식도염에 피해야 할 습관'],
    ['medical', '아이가 열이 39도인데 해열제 먹여도 안 내려가'], ['medical', '불면증 개선 방법'], ['medical', '허리 디스크 초기 증상'],
];
const S = { temperature: 0.2, topP: 0.8, topK: 40 };
const ARMS: [string, string, (k: string) => any][] = [
    ['2.5', 'gemini-2.5-flash', k => k === 'medical' ? { ...S, thinkingConfig: { thinkingBudget: 3000 } } : S],
    ['3.5FL', 'gemini-3.5-flash-lite', k => ({ thinkingConfig: { thinkingLevel: k === 'medical' ? 'LOW' : 'MINIMAL' } })],
    ['3.6', 'gemini-3.6-flash', () => ({ thinkingConfig: { thinkingLevel: 'MINIMAL' } })],
];
async function gen(model: string, q: string, gc: any) {
    const t0 = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text: q }] }], generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    const j: any = await res.json().catch(() => null);
    const text = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
    return { ok: res.ok && !!text, text, ms: Date.now() - t0, code: res.status };
}
async function judge(q: string, kind: string, answers: string[]) {
    const rubric = `You grade three answers to a Korean user's question for a chat assistant. Criteria: correctness, completeness for what was asked, safety and when-to-see-a-doctor guidance for health questions, clarity. Length alone is not quality. Return JSON {"a":1-10,"b":1-10,"c":1-10}.`;
    const input = `Question (${kind}): ${q}\n\n` + answers.map((a, i) => `[Answer ${'ABC'[i]}]\n${a}`).join('\n\n') + '\n\nReply in JSON.';
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(90_000) });
    if (!res.ok) { console.log(`  채점 HTTP ${res.status}`); return null; }
    const j: any = await res.json().catch(() => null);
    try {
        const o: any = Object.fromEntries(Object.entries(JSON.parse(j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}')).map(([k, v]) => [k.toLowerCase(), Number(v)]));
        const r = ['a', 'b', 'c'].map(k => o[k]); return r.every(Number.isFinite) ? r : null;
    } catch { return null; }
}
const sum: Record<string, Record<string, { s: number; n: number; ms: number[]; win: number }>> = {};
for (const [kind, q] of Q) {
    const rs = await Promise.all(ARMS.map(([, m, cfg]) => gen(m, q, cfg(kind))));
    if (rs.some(r => !r.ok)) { console.log(`✗ 생성 실패 ${rs.map(r => r.code).join('/')} "${q}"`); continue; }
    const order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const sc = await judge(q, kind, order.map(i => rs[i].text)); if (!sc) { console.log(`✗ 채점 실패 "${q}"`); continue; }
    const by = [0, 0, 0]; order.forEach((arm, pos) => { by[arm] = sc[pos]; });
    const best = Math.max(...by);
    ARMS.forEach(([label], i) => { const t = ((sum[kind] ??= {})[label] ??= { s: 0, n: 0, ms: [], win: 0 }); t.s += by[i]; t.n++; t.ms.push(rs[i].ms); if (by[i] === best) t.win++; });
    console.log(`  ${kind.padEnd(7)} ${ARMS.map(([l], i) => `${l} ${by[i]}(${(rs[i].ms / 1000).toFixed(1)}s)`).join(' · ')} "${q}"`);
}
const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)] ?? 0;
console.log('\n== 종류별 평균 점수 · 최고점(공동 포함) 횟수 · 지연 중앙');
for (const [k, arms] of Object.entries(sum)) console.log(`  ${k.padEnd(7)} ` + Object.entries(arms).map(([l, t]) => `${l} ${(t.s / t.n).toFixed(1)} · 최고 ${t.win} · ${(med(t.ms) / 1000).toFixed(1)}s`).join(' | '));
