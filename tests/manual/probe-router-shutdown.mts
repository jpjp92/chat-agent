/**
 * 2.5 Flash 종료(12-01) 대비 라우터 후보 비교 — `ARM=a|b|c|d|e npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-router-shutdown.mts [라운드=2]`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §3 T3
 *
 *   a  현행 gemini-2.5-flash (기준선)
 *   b  gemini-3.5-flash-lite · 요청 본문 그대로(temperature 0 · thinkingBudget 0) — **12-01 자동 전환 재현**
 *   c  gemini-3.5-flash-lite · 정리(sampling 제거 · thinkingLevel MINIMAL)
 *   d  gpt-6-luna · reasoning none(생각 끔) · JSON 모드
 *   e  gpt-5.6-luna · d 와 같은 설정
 *
 * 운영 routerNode 를 그대로 부르고 `fetch` 에서 모델·본문만 바꾼다(프롬프트를 다시 쓰지 않는다 — tests/README ⓒ).
 * 세트: 라우터 골든 v1(의도) + SEARCH_GRAY(검색 판정 — LLM 원판정 `llmNeedsSearch` 와 최종 `needsSearch`).
 * 모두 유료 키(게스트도 유료 키로 라우팅하는 전제). 합성 문장만. 출력은 판정·지연·오류 코드만.
 * 호출: (골든 89 + 검색 15) × 라운드
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
const ARM = (process.env.ARM ?? 'a') as 'a' | 'b' | 'c' | 'd' | 'e';
const OAI_MODEL = ARM === 'e' ? 'gpt-5.6-luna' : 'gpt-6-luna';
const ROUNDS = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? 2);
const LABEL = { a: 'gemini-2.5-flash(현행)', b: '3.5-flash-lite 그대로', c: '3.5-flash-lite 정리', d: 'gpt-6-luna none', e: 'gpt-5.6-luna none' }[ARM];

// 유료 키만 — 무료 키가 섞이면 지연·오류가 등급 차이로 오염된다
const g = process.env.API_KEY_TIER1, o = process.env.OPENAI_API_KEY_TIER1;
if (!g || (ARM >= 'd' && !o)) { console.error('유료 키 없음'); process.exit(1); }
for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
process.env.API_KEY = g;

const realFetch = globalThis.fetch;
const errs: Record<string, number> = {};
const tok = { in: 0, out: 0, think: 0 };
globalThis.fetch = async (url: any, init?: any) => {
    const u = String(url instanceof Request ? url.url : url);
    if (!u.includes('generativelanguage.googleapis.com') || !u.includes(':generateContent')) return realFetch(url, init);
    const req = JSON.parse(init?.body ?? '{}');
    if (ARM === 'a' || ARM === 'b' || ARM === 'c') {
        let nu = u, body = req;
        if (ARM !== 'a') nu = u.replace(/models\/gemini-2\.5-flash:/, 'models/gemini-3.5-flash-lite:');
        if (ARM === 'c') {
            const gc = { ...(req.generationConfig ?? {}) };
            delete gc.temperature; delete gc.topP; delete gc.topK;
            gc.thinkingConfig = { thinkingLevel: 'MINIMAL' };
            body = { ...req, generationConfig: gc };
        }
        const res = await realFetch(nu, { ...init, body: JSON.stringify(body) });
        if (!res.ok) { errs[String(res.status)] = (errs[String(res.status)] ?? 0) + 1; return res; }
        const j: any = await res.clone().json().catch(() => null);
        tok.in += j?.usageMetadata?.promptTokenCount ?? 0; tok.out += j?.usageMetadata?.candidatesTokenCount ?? 0; tok.think += j?.usageMetadata?.thoughtsTokenCount ?? 0;
        return res;
    }
    // d — OpenAI Responses 로 갈아 끼운다(probe-router-gpt 와 같은 방식)
    const res = await realFetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${o}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OAI_MODEL,
            instructions: req.systemInstruction?.parts?.map((p: any) => p.text).join('\n'),
            input: req.contents?.[0]?.parts?.[0]?.text ?? '',
            reasoning: { effort: 'none' },
            text: { format: { type: 'json_object' } },
        }),
        signal: AbortSignal.timeout(15_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) { errs[String(res.status)] = (errs[String(res.status)] ?? 0) + 1; return new Response(JSON.stringify({ error: { code: res.status } }), { status: res.status }); }
    tok.in += body?.usage?.input_tokens ?? 0; tok.out += body?.usage?.output_tokens ?? 0;
    const text = body?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '';
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');
const { GOLDEN_V1 } = await import('./router-golden.mts');
const { SEARCH_GRAY } = await import('./router-cases.mts');

const run = async (q: string) => {
    const t0 = Date.now();
    try {
        const out: any = await routerNode({ messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })], webContent: '', attachments: [], activeCards: [], cardContexts: [], lastTurnSearched: false } as any);
        return { intent: out.intent as string, from: out.intentFrom as string, llmSearch: out.llmNeedsSearch as boolean | null, search: !!out.needsSearch, ms: Date.now() - t0 };
    } catch { return { intent: 'ERR', from: '-', llmSearch: null, search: false, ms: Date.now() - t0 }; }
};
const isRight = (got: string, c: { want: string; alt?: string[] }) => got === c.want || !!c.alt?.includes(got);

let iOk = 0, iN = 0, iFallback = 0, sOk = 0, sLlmOk = 0, sLlmNone = 0, sN = 0;
const ms: number[] = [];
const misses: string[] = [];
for (let r = 0; r < ROUNDS; r++) {
    for (const c of GOLDEN_V1 as any[]) {
        const x = await run(c.q); ms.push(x.ms); iN++;
        if (x.from !== 'router') iFallback++;
        if (isRight(x.intent, c)) iOk++; else if (r === 0) misses.push(`의도 ${x.intent} (기대 ${c.want}) "${c.q}"`);
    }
    for (const c of SEARCH_GRAY as any[]) {
        const x = await run(c.q); ms.push(x.ms); sN++;
        if (x.search === c.wantSearch) sOk++;
        if (x.llmSearch === null) sLlmNone++; else if (x.llmSearch === c.wantSearch) sLlmOk++;
        if (x.search !== c.wantSearch && r === 0) misses.push(`검색 ${x.search ? 'on' : 'off'} (기대 ${c.wantSearch ? 'on' : 'off'}, LLM ${x.llmSearch}) "${c.q}"`);
    }
}
const pct = (p: number) => { const s = [...ms].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log(`\n■ ${LABEL} · ${ROUNDS}라운드`);
console.log(`  의도 ${iOk}/${iN} (${(iOk / iN * 100).toFixed(1)}%) · LLM 아닌 판정(폴백) ${iFallback}`);
console.log(`  검색 최종 ${sOk}/${sN} · LLM 원판정 ${sLlmOk}/${sN - sLlmNone} (판정 없음 ${sLlmNone})`);
console.log(`  지연 p50 ${pct(0.5)}ms · p90 ${pct(0.9)}ms · 최대 ${Math.max(...ms)}ms`);
console.log(`  HTTP 오류 ${JSON.stringify(errs)} · 토큰 입력 ${tok.in} 출력 ${tok.out} 생각 ${tok.think}`);
console.log(`  1라운드 오답 ${misses.length}건`);
for (const m of misses) console.log(`    ✗ ${m}`);
