/**
 * 라우터 정답 검수용 LLM judge — 골든셋 문장마다 정답 기준 문서(REF_ROUTER_LABELS.md)만 보고 의도를 매긴다.
 * 라우터 프롬프트는 보여 주지 않는다(같은 프롬프트로 채점하면 라우터의 오류를 그대로 정답으로 본다).
 *
 *   npx tsx tests/manual/probe-router-judge.mts --dry                       # 호출 0회
 *   npx tsx tests/manual/probe-router-judge.mts [--model=gpt-6.1-sol]       # judge 1회씩
 *   ... --compare=gem.json,gpt.json,dec.json                                # 분류기 원자료와 합쳐 갈린 문장만 출력
 *   PROBE_OUT=judge.json ...
 *
 * 용도: 기대값 검수. judge 가 기대값과 다르거나 분류기끼리 갈린 문장만 사람이 다시 본다 — judge 가 정답을 정하지 않는다.
 * 키: OPENAI_API_KEY_TIER1.
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
const MODEL = args.find(a => a.startsWith('--model='))?.slice(8) ?? 'gpt-6.1-sol';
const COMPARE = args.find(a => a.startsWith('--compare='))?.slice(10).split(',').filter(Boolean) ?? [];
const { GOLDEN_V1 } = await import('./router-golden.mts');
const GUIDE = fs.readFileSync('docs/guide/REF_ROUTER_LABELS.md', 'utf8');
const INTENTS = ['drug_info', 'medical_qa', 'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa', 'movie_search',
    'paper_search', 'arxiv_search', 'weather', 'biology', 'chemistry', 'physics', 'astronomy', 'data_viz', 'general'];

const instructions = `You label user messages for a Korean chat assistant's intent router. Use ONLY the labeling guide below.
Pick the intent the user should be routed to. If the guide says two intents are both acceptable, or both would give the user a correct result, list the second one in "alt".
Answer with JSON: {"intent": one of ${JSON.stringify(INTENTS)}, "alt": [zero or more of the same list], "reason": one short Korean sentence citing the guide}.

<labeling_guide>
${GUIDE}
</labeling_guide>`;

console.log(`judge ${MODEL} · 골든셋 ${GOLDEN_V1.length}문장 = ${GOLDEN_V1.length}회 (지시문 약 ${Math.round(instructions.length / 2)}토큰 추정)`);
if (DRY) process.exit(0);
const key = process.env.OPENAI_API_KEY_TIER1;
if (!key) { console.error('OPENAI_API_KEY_TIER1 이 없다'); process.exit(1); }

type Judged = { id: string; q: string; want: string; alt?: string[]; intent: string; jalt: string[]; reason: string };
const usage = { input: 0, output: 0 };
async function judge(q: string): Promise<{ intent: string; alt: string[]; reason: string }> {
    const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        // json_object 형식은 input 쪽에 'json' 이라는 단어가 있어야 받아 준다(instructions 만으로는 400)
        body: JSON.stringify({ model: MODEL, instructions, input: `User message to label (answer in json):\n${q}`, text: { format: { type: 'json_object' } } }),
        signal: AbortSignal.timeout(60_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) return { intent: 'ERR', alt: [], reason: body?.error?.message ?? `HTTP ${res.status}` };
    usage.input += body?.usage?.input_tokens ?? 0;
    usage.output += body?.usage?.output_tokens ?? 0;
    const text = body?.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}';
    try { const j = JSON.parse(text); return { intent: String(j.intent), alt: Array.isArray(j.alt) ? j.alt.map(String) : [], reason: String(j.reason ?? '') }; }
    catch { return { intent: 'PARSE', alt: [], reason: text.slice(0, 120) }; }
}

const rows: Judged[] = [];
for (const c of GOLDEN_V1) {
    const j = await judge(c.q);
    rows.push({ id: c.id, q: c.q, want: c.want, alt: c.alt, intent: j.intent, jalt: j.alt, reason: j.reason });
}
// judge 와 기대값이 "겹치는가" — 서로의 정답 집합이 하나라도 겹치면 일치로 본다
const accepts = (r: Judged) => new Set([r.want, ...(r.alt ?? [])]);
const agree = (r: Judged) => [r.intent, ...r.jalt].some(x => accepts(r).has(x));
console.log(`\njudge 일치 ${rows.filter(agree).length}/${rows.length} · 토큰 입력 ${usage.input} · 출력 ${usage.output}`);
for (const r of rows.filter(r => !agree(r))) console.log(`  ✗ [${r.id}] "${r.q}" 기대 ${r.want}${r.alt ? `(+${r.alt})` : ''} · judge ${r.intent}${r.jalt.length ? `(+${r.jalt})` : ''} — ${r.reason}`);

// 분류기 원자료와 합쳐, 하나라도 기대값과 다른 문장만 보인다(분포 = 라운드별 판정)
if (COMPARE.length) {
    const pick = (r: any) => r.router?.intent && r.router.intent !== 'SKIP' ? r.router.intent : r.decisions?.intent && r.decisions.intent !== 'SKIP' ? r.decisions.intent : r.intent;
    const dists = COMPARE.map(f => {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        const m = new Map<string, Map<string, number>>();
        for (const r of d.rows) { const k = m.get(r.q) ?? new Map(); const v = pick(r); k.set(v, (k.get(v) ?? 0) + 1); m.set(r.q, k); }
        return { name: d.routerModel && !String(d.routerModel).includes('skip') && d.rows[0]?.router?.intent !== 'SKIP' ? 'Gemini' : d.model ?? 'Decisions', m };
    });
    console.log(`\n── 기대값과 하나라도 다른 문장 (${dists.map(d => d.name).join(' · ')} · judge) ──`);
    for (const r of rows) {
        const ok = (x: string) => accepts(r).has(x);
        const cells = dists.map(d => [...(d.m.get(r.q) ?? new Map())].map(([k, n]) => `${ok(k) ? '' : '✗'}${k}${n}`).join(' '));
        const anyBad = dists.some(d => [...(d.m.get(r.q) ?? new Map()).keys()].some(k => !ok(k))) || !agree(r);
        if (anyBad) console.log(`  [${r.id}] "${r.q}" 기대 ${r.want}${r.alt ? `(+${r.alt})` : ''}\n      ${cells.map((c, i) => `${dists[i].name}: ${c}`).join(' | ')} | judge: ${agree(r) ? '' : '✗'}${r.intent}${r.jalt.length ? `(+${r.jalt})` : ''}`);
    }
}
if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ at: new Date().toISOString(), model: MODEL, usage, rows }, null, 2));
