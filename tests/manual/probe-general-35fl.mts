/**
 * 일반 질문 확대 — 2.5 Flash(운영 기본) vs 3.5 Flash-Lite `minimal`, 20문항 × ROUNDS. 유료 키.
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-general-35fl.mts [라운드=2]`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8-6 — 6문항 측정은 실행마다 승패 방향이 바뀌었다.
 * 채점: gpt-6-luna 블라인드 + 감점 사유. 답·사유는 OUT(scratchpad)에만. 출력은 점수·길이·지연만.
 * 호출: 20 × 2 × 라운드 생성 + 20 × 라운드 채점
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const G = process.env.API_KEY_TIER1!, O = process.env.OPENAI_API_KEY_TIER1!;
// FROM=1 이면 2라운드부터(중단 뒤 이어 돌리기)
const FROM = Number(process.env.FROM ?? 0);
const ROUNDS = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? 2);
const OUT = process.env.OUT ?? 'general-35fl.json';
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const SYS = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 24일 화요일]\n\n` + withSearchProviderInstruction(getSystemInstruction('Korean'), 'none');

// 분야를 섞는다: 생활·코드·작문·추론·학습·업무
const QS = [
    '재택근무 집중력 높이는 방법 알려줘', '파이썬에서 리스트와 튜플 차이를 예시로 설명해줘', '첫 해외여행 준비물 체크리스트 만들어줘',
    '복리와 단리 차이를 예시 숫자로 설명해줘', '회의록 잘 쓰는 법', '초보자 주 3회 홈트 루틴 짜줘',
    'SQL에서 INNER JOIN과 LEFT JOIN 차이', '자바스크립트 async/await를 초보자에게 설명해줘', '이 문장 자연스럽게 다듬어줘: 저희 회사는 고객님의 만족을 위해 최선을 다하는 것을 목표로 하고 있습니다',
    '퇴사 의사를 상사에게 정중하게 전하는 메시지 써줘', '3명이 5일 걸리는 일을 5명이 하면 며칠 걸려?', '광합성을 중학생 수준으로 설명해줘',
    '월급 300만원일 때 예산 짜는 법', '면접에서 단점 질문에 어떻게 답하면 좋을까', '정규표현식으로 이메일 형식 검사하는 예시',
    '조선 시대 과거 제도 간단히 설명해줘', '팀 프로젝트에서 무임승차하는 팀원 대처법', '영어 회화 독학 3개월 계획',
    '깃에서 rebase와 merge 차이', '아이 생일파티 아이디어 5가지',
];
async function gen(model: string, q: string, gc: any) {
    const t0 = Date.now();
    try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': G, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: 'user', parts: [{ text: q }] }], generationConfig: { maxOutputTokens: 8192, ...gc } }), signal: AbortSignal.timeout(90_000) });
    const j: any = await res.json().catch(() => null);
    const text = (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
    return { ok: res.ok && !!text, code: res.status, text, ms: Date.now() - t0, out: j?.usageMetadata?.candidatesTokenCount ?? 0, think: j?.usageMetadata?.thoughtsTokenCount ?? 0 };
    } catch (e: any) { return { ok: false, code: e?.cause?.code ?? e?.name, text: '', ms: Date.now() - t0, out: 0, think: 0 }; }
}
async function judge(q: string, a: string, b: string) {
  try {
    const rubric = `You grade two answers to a Korean user's question for a chat assistant. Criteria: correctness, completeness for what was asked, clarity, usefulness. Length alone is not quality — do not reward extra content the user did not need. Return JSON {"a":1-10,"b":1-10,"winner":"a"|"b"|"tie","reason":"one short Korean sentence on what decided it"}.`;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question: ${q}\n\n[Answer A]\n${a}\n\n[Answer B]\n${b}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    try { const o: any = Object.fromEntries(Object.entries(JSON.parse(j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}')).map(([k, v]) => [k.toLowerCase(), v])); return Number.isFinite(Number(o.a)) ? o : null; } catch { return null; }
  } catch { return null; }
}

const log: any[] = []; const rows: { s25: number; s35: number; w: string; len25: number; len35: number; ms25: number; ms35: number }[] = [];
let fail = 0;
for (let r = FROM; r < ROUNDS; r++) for (const q of QS) {
    const [a, b] = await Promise.all([gen('gemini-2.5-flash', q, { temperature: 0.2, topP: 0.8, topK: 40 }), gen('gemini-3.5-flash-lite', q, { thinkingConfig: { thinkingLevel: 'MINIMAL' } })]);
    if (!a.ok || !b.ok) { fail++; console.log(`✗ 생성 ${a.code}/${b.code} "${q}"`); continue; }
    const flip = Math.random() < 0.5; const v = await judge(q, flip ? b.text : a.text, flip ? a.text : b.text);
    if (!v) { fail++; continue; }
    const s25 = Number(flip ? v.b : v.a), s35 = Number(flip ? v.a : v.b), wl = String(v.winner).toLowerCase();
    const w = wl === 'tie' ? 'tie' : (wl === 'a') !== flip ? '2.5' : '3.5FL';
    rows.push({ s25, s35, w, len25: a.text.length, len35: b.text.length, ms25: a.ms, ms35: b.ms });
    log.push({ r, q, s25, s35, w, reason: v.reason, a25: a.text, a35: b.text });
    console.log(`  r${r + 1} ${q.slice(0, 20).padEnd(20)} ${s25}/${s35} ${w.padEnd(5)} · ${a.text.length}/${b.text.length}자 · ${(a.ms / 1000).toFixed(1)}/${(b.ms / 1000).toFixed(1)}s`);
}
fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
const cnt = (w: string) => rows.filter(x => x.w === w).length;
console.log(`\n== ${rows.length}건 (실패 ${fail})`);
console.log(`  평균 2.5 ${avg(rows.map(x => x.s25)).toFixed(2)} · 3.5FL ${avg(rows.map(x => x.s35)).toFixed(2)} · 승 2.5 ${cnt('2.5')} · 3.5FL ${cnt('3.5FL')} · 무 ${cnt('tie')}`);
console.log(`  길이 평균 ${avg(rows.map(x => x.len25)).toFixed(0)}/${avg(rows.map(x => x.len35)).toFixed(0)}자 · 지연 평균 ${(avg(rows.map(x => x.ms25)) / 1000).toFixed(1)}/${(avg(rows.map(x => x.ms35)) / 1000).toFixed(1)}s`);
// 길이 효과: 더 긴 쪽이 이겼는가
const decided = rows.filter(x => x.w !== 'tie');
const longerWon = decided.filter(x => (x.w === '2.5') === (x.len25 > x.len35)).length;
console.log(`  승부 난 ${decided.length}건 중 더 긴 답이 이긴 비율 ${(longerWon / (decided.length || 1) * 100).toFixed(0)}%`);
// 라운드 간 일관성
for (let r = FROM; r < ROUNDS; r++) { const R = log.filter(x => x.r === r); console.log(`  라운드 ${r + 1}: 2.5 ${avg(R.map(x => x.s25)).toFixed(2)} · 3.5FL ${avg(R.map(x => x.s35)).toFixed(2)}`); }
