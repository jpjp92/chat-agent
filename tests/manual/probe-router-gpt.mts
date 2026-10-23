/**
 * 라우터 LLM 을 OpenAI 채팅 모델로 바꿔 끼운 정확도·지연 — 현행 프롬프트·규칙·후처리는 그대로 둔다.
 * 계획: docs/plans/PLAN_DECISION_ROUTER_261019.md
 *
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-router-gpt.mts --set=domains2 [라운드=3]
 *   ... --model=gpt-6-luna                                      # 기본값
 *   ... --dry                                                   # 호출 0회
 *   PROBE_OUT=out.json ...                                      # 원자료 저장
 *
 * routerNode 의 `ai.models.generateContent` 만 OpenAI Responses 호출로 갈아 끼운다. 프롬프트를 여기서 다시 쓰면
 * 운영 라우터와 다른 것을 재게 된다(tests/README ⓒ). reasoning 은 채팅 경로와 같은 none.
 */
import fs from 'node:fs';
for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const MODEL = args.find(a => a.startsWith('--model='))?.slice(8) ?? 'gpt-6-luna';
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const SET = args.find(a => a.startsWith('--set='))?.slice(6) ?? 'domains2';
const cases = await import('./router-cases.mts');
const SETS: Record<string, { q: string; want: string; alt?: string[] }[]> = {
    final: cases.ROUTER_FINAL, domains: cases.ROUTER_DOMAINS, domains2: cases.ROUTER_DOMAINS2, causes: cases.ROUTER_CAUSES, law: cases.ROUTER_LAW_BOUNDARY, wobble: cases.ROUTER_WOBBLE, golden: (await import('./router-golden.mts')).GOLDEN_V1, base: [...cases.MISROUTED, ...cases.MUST_KEEP],
    holdout3: cases.HOLDOUT3, fresh: cases.ROUTER_FRESH,
};
const CASES = SETS[SET];
if (!CASES) { console.error(`세트 없음: ${SET} (${Object.keys(SETS).join('|')})`); process.exit(1); }

console.log(`라우터 LLM ${MODEL} · 세트 ${SET} · 질의 ${CASES.length}종 × ${ROUNDS}라운드 = OpenAI ${CASES.length * ROUNDS}회`);
if (DRY) process.exit(0);

const key = process.env.OPENAI_API_KEY_TIER1;
if (!key) { console.error('OPENAI_API_KEY_TIER1 이 없다'); process.exit(1); }
// Gemini 키가 없으면 routerNode 가 LLM 을 건너뛰고 규칙으로 떨어진다 — 실제 호출은 아래 패치가 가로챈다.
process.env.API_KEY ||= 'unused';

// SDK 클래스 패치는 라우터가 쓰는 모듈 인스턴스에 닿지 않았다(10-23, 무료 키로 실호출됨) — fetch 에서 가로챈다.
// Gemini 호출이 하나라도 새면 측정이 오염되므로 generateContent 외 Gemini 요청은 막는다.
const realFetch = globalThis.fetch;
const usage = { input: 0, output: 0, intercepted: 0 };
globalThis.fetch = async (url: any, init?: any) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, init);
    if (!u.includes(':generateContent')) throw new Error(`Gemini 요청 차단: ${u}`);
    const req = JSON.parse(init?.body ?? '{}');
    const res = await realFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: MODEL,
            instructions: req.systemInstruction?.parts?.map((p: any) => p.text).join('\n'),
            input: req.contents?.[0]?.parts?.[0]?.text ?? '',
            reasoning: { effort: 'none' },
            text: { format: { type: 'json_object' } },
        }),
        signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) return new Response(JSON.stringify({ error: { code: res.status, message: body?.error?.message } }), { status: res.status });
    usage.intercepted++;
    usage.input += body?.usage?.input_tokens ?? 0;
    usage.output += body?.usage?.output_tokens ?? 0;
    const text = body?.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '';
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');

// 라벨이 애매한 문장은 alt 도 정답(router-cases.mts RouterCase.alt)
const isRight = (g: string, c: { want: string; alt?: string[] }) => g === c.want || !!c.alt?.includes(g);
type Row = { q: string; want: string; alt?: string[]; round: number; intent: string; ms: number };
const rows: Row[] = [];
for (let round = 0; round < ROUNDS; round++) {
    for (const c of CASES) {
        const t0 = Date.now();
        let intent = 'ERR';
        try { intent = ((await routerNode({ messages: [new HumanMessage(c.q)] } as any)) as any).intent; } catch { /* ERR */ }
        const ms = Date.now() - t0;
        rows.push({ q: c.q, want: c.want, alt: c.alt, round, intent, ms });
        if (!isRight(intent, c)) console.log(`  r${round + 1} ✗ ${intent.padEnd(15)} ${String(ms).padStart(5)}ms  "${c.q}" (기대 ${c.want})`);
    }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const ok = rows.filter(r => isRight(r.intent, r)).length;
const ms = rows.map(r => r.ms);
console.log(`\n${MODEL} 정확도 ${ok}/${rows.length} (${(ok / rows.length * 100).toFixed(0)}%) · 오류 ${rows.filter(r => r.intent === 'ERR').length} · 지연 p50 ${pct(ms, 0.5)}ms · p90 ${pct(ms, 0.9)}ms · 최대 ${Math.max(...ms)}ms`);
console.log(`가로챈 호출 ${usage.intercepted} · 토큰: 입력 ${usage.input} · 출력 ${usage.output} (호출당 입력 약 ${Math.round(usage.input / rows.length)})`);
if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ at: new Date().toISOString(), model: MODEL, set: SET, usage, rows }, null, 2));
