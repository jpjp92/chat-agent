/**
 * 유료 키 vs 무료 키 지연·실패율 — PLAN_GEMINI_PAID_FIRST_261004 §4 0단계.
 *
 * 같은 질문을 두 팔로 교대 배치해 잰다(라운드마다 팔 순서 회전).
 *   paid : API_KEY_TIER1
 *   free : API_KEY..API_KEY12 로테이션 (앱의 getNextApiKey 와 같은 풀, 쿨다운 로직은 없음)
 * 축 3개 — 앱이 실제로 부르는 모양을 흉내낸다.
 *   router    : ROUTER_MODEL, 짧은 분류 프롬프트
 *   generate  : DEFAULT_CHAT_MODEL, 검색 없음
 *   grounding : DEFAULT_CHAT_MODEL + googleSearch
 *
 * 유료 호출이 있으므로 `npm test` 에 넣지 않는다. 키 값은 출력하지 않는다(free 는 #번호만).
 * 실행: npx tsx --conditions=react-server tests/manual/probe-gemini-key-tier.mts [rounds=3] [--dry] [--axes=router,generate,grounding]
 *   --dry : 호출 0회, 계획(팔·축·질문·총 호출 수)만 출력
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}

const { DEFAULT_CHAT_MODEL, ROUTER_MODEL } = await import('../../server/models.js');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ROUNDS = Number(args.find(a => /^\d+$/.test(a)) ?? 3);
const AXES_ARG = args.find(a => a.startsWith('--axes='))?.slice(7).split(',');
const TIMEOUT_MS = 60_000;

const PAID = process.env.API_KEY_TIER1;
// config.ts 와 같은 규칙 — TIER1 은 이 패턴에 걸리지 않는다
const FREE = [...new Set(Object.keys(process.env).filter(k => /^API_KEY\d*$/.test(k)).sort().map(k => process.env[k]!).filter(Boolean))];

const QUESTIONS = [
    '파이썬에서 리스트와 튜플의 차이를 세 줄로 설명해줘.',
    '서울에서 부산까지 KTX로 얼마나 걸려?',
    '광합성 과정을 초등학생에게 설명하듯 알려줘.',
    '오늘 원/달러 환율 알려줘.',
];

const ROUTER_PROMPT = (q: string) =>
    `다음 사용자 메시지의 의도를 하나로 분류해 JSON 으로만 답하라. 후보: general, search, weather, drug, law, movie.\n메시지: ${q}\n형식: {"intent":"..."}`;

type Axis = 'router' | 'generate' | 'grounding';
const AXES: Axis[] = (AXES_ARG as Axis[] | undefined) ?? ['router', 'generate', 'grounding'];
const ARMS = ['paid', 'free'] as const;
type Arm = typeof ARMS[number];

const plan = { model: { router: ROUTER_MODEL, generate: DEFAULT_CHAT_MODEL, grounding: DEFAULT_CHAT_MODEL }, rounds: ROUNDS, axes: AXES, questions: QUESTIONS.length, freeKeys: FREE.length, paidKey: Boolean(PAID), calls: ROUNDS * AXES.length * QUESTIONS.length * ARMS.length };
console.log('## 계획', JSON.stringify(plan));
if (DRY) process.exit(0);
if (!PAID || FREE.length === 0) {
    console.error('API_KEY_TIER1 또는 무료 키(API_KEY*)가 없습니다. 호출 0회.');
    process.exit(2);
}

let freeIdx = 0;
function pickKey(arm: Arm): { key: string; label: string } {
    if (arm === 'paid') return { key: PAID!, label: 'paid' };
    const i = freeIdx++ % FREE.length;
    return { key: FREE[i], label: `free#${i + 1}` };
}

// 오류 원문은 공급자 텍스트라 분류만 남긴다
function classify(e: any): string {
    const msg = String(e?.message ?? e);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return /per day|PerDay|daily/i.test(msg) ? '429-day' : '429';
    if (/abort|timeout|timed out/i.test(msg)) return 'timeout';
    if (/5\d\d|UNAVAILABLE|INTERNAL|overloaded/i.test(msg)) return '5xx';
    if (/API key|PERMISSION|401|403/i.test(msg)) return 'auth';
    return 'other';
}

type Result = { ttfb: number; total: number; chars: number; grounded?: boolean };

async function call(axis: Axis, key: string, q: string): Promise<Result> {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: TIMEOUT_MS } });
    const t0 = performance.now();
    const model = axis === 'router' ? ROUTER_MODEL : DEFAULT_CHAT_MODEL;
    const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text: axis === 'router' ? ROUTER_PROMPT(q) : q }] }],
        config: axis === 'grounding' ? { tools: [{ googleSearch: {} }] } : {},
    });
    let ttfb = -1, chars = 0, grounded = false;
    for await (const chunk of stream) {
        const text = chunk.text ?? '';
        if (text && ttfb < 0) ttfb = performance.now() - t0;
        chars += text.length;
        if (chunk.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length) grounded = true;
    }
    if (chars === 0) throw new Error('empty response');
    return { ttfb, total: performance.now() - t0, chars, ...(axis === 'grounding' ? { grounded } : {}) };
}

const rows: { round: number; axis: Axis; arm: Arm; key: string; q: number; r?: Result; err?: string }[] = [];

for (let round = 1; round <= ROUNDS; round++) {
    // 교대 배치: 라운드마다 팔 순서를 뒤집어 시간대 드리프트가 한 팔에 몰리지 않게 한다
    const order: Arm[] = round % 2 ? ['paid', 'free'] : ['free', 'paid'];
    for (const axis of AXES) {
        for (const [qi, q] of QUESTIONS.entries()) {
            for (const arm of order) {
                const { key, label } = pickKey(arm);
                try {
                    const r = await call(axis, key, q);
                    rows.push({ round, axis, arm, key: label, q: qi, r });
                    console.log(`r${round} ${axis.padEnd(9)} q${qi} ${label.padEnd(8)} ttfb=${(r.ttfb / 1000).toFixed(2)}s total=${(r.total / 1000).toFixed(2)}s${r.grounded === undefined ? '' : ` grounded=${r.grounded}`}`);
                } catch (e) {
                    const err = classify(e);
                    rows.push({ round, axis, arm, key: label, q: qi, err });
                    console.log(`r${round} ${axis.padEnd(9)} q${qi} ${label.padEnd(8)} ERROR ${err}`);
                }
            }
        }
    }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]; };
const f = (v: number) => `${(v / 1000).toFixed(2)}s`;

console.log('\n## 요약 (성공 건 기준 지연, 실패는 종류별)');
console.log('| 축 | 팔 | n | 성공 | TTFB 중앙 | TTFB p90 | 전체 중앙 | 전체 p90 | 실패 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const axis of AXES) {
    for (const arm of ARMS) {
        const sel = rows.filter(x => x.axis === axis && x.arm === arm);
        const ok = sel.filter(x => x.r).map(x => x.r!);
        const errs = Object.entries(sel.filter(x => x.err).reduce<Record<string, number>>((a, x) => ((a[x.err!] = (a[x.err!] ?? 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(' ') || '-';
        const cell = (fn: (xs: number[]) => number, pick: (r: Result) => number) => ok.length ? f(fn(ok.map(pick))) : '-';
        console.log(`| ${axis} | ${arm} | ${sel.length} | ${ok.length} | ${cell(median, r => r.ttfb)} | ${cell(p90, r => r.ttfb)} | ${cell(median, r => r.total)} | ${cell(p90, r => r.total)} | ${errs} |`);
    }
}

const out = process.env.PROBE_OUT;
if (out) {
    fs.writeFileSync(out, JSON.stringify({ plan, at: new Date().toISOString(), rows }, null, 2));
    console.log(`\n결과 저장: ${out}`);
}
