/** Suite C — grounding QUALITY on the paid key: 2.5 (today's search fallback) vs 3.6 vs 3.7.
 * PLAN_GEMINI_PAID_FIRST_261004 §7. Decides `groundingReliable` in server/models.ts.
 *
 * Suite B (grounding-compare.mts) only asked "is the fact in the answer". This adds the
 * retrieve → re-organize axis the paid-first plan depends on:
 *   correct          — fact found / every synth key point covered
 *   coverage         — synth: key points covered / total (answering from one snippet scores 1/N)
 *   supportRatio     — share of answer characters backed by groundingSupports segments.
 *                      Low ratio + grounded = the model searched and then wrote from memory.
 *   citedWrong       — grounded AND not correct: the UI draws source chips on a wrong answer
 *   notDiscriminative— the search-OFF control answered correctly → the question tests memory,
 *                      not grounding, and is excluded from the verdict
 *
 * Arms: search-on × rounds for every model, plus ONE search-off round per model (control).
 * Expectations live in tc-grounding-hard.mts and ship empty — see that file.
 *
 *   node --import tsx tests/manual/gemini-3-8/grounding-quality.mts            # plan only, 0 calls
 *   node --import tsx tests/manual/gemini-3-8/grounding-quality.mts --live --confirm-expectations [--rounds 3] [--models gemini-3.8-flash]
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI, type Content } from '@google/genai';
import { getSystemInstruction } from '../../../server/agent/prompt';
import { resolveThinkingConfig } from '../../../server/agent/nodes/generation-config';
import { CONFIRMED_ON, questions, score, unscored } from './tc-grounding-hard.mjs';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
};
const rounds = Number(option('--rounds', '3'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error('--rounds must be 1..5');
const out = option('--out', '/tmp/gemini-grounding-quality.json');
const live = args.includes('--live');
const confirmed = args.includes('--confirm-expectations');
// --models a,b 로 일부만 다시 잴 수 있다 (같은 날 앞선 결과와 합쳐 비교할 때)
const models = option('--models', 'gemini-2.5-flash,gemini-3.6-flash,gemini-3.7-flash').split(',').map(m => m.trim()).filter(Boolean);
const timeoutMs = 60_000;
const maxOutputTokens = 4096;

// search-on rounds + one search-off control round
const maxCalls = questions.length * models.length * (rounds + 1);
if (maxCalls > 150) throw new Error(`Refusing ${maxCalls} calls`);

const report: any = { startedAt: new Date().toISOString(), suite: 'grounding-quality',
    models, rounds, questions: questions.length, maxCalls, maxOutputTokens, timeoutMs,
    expectationsConfirmedOn: CONFIRMED_ON, keySelection: 'API_KEY_TIER1',
    scope: 'Direct SDK, production system prompt and thinking resolver. Does not exercise the app router '
        + 'or the 2.5 downgrade path — it measures what each model does when it IS allowed to search.',
    results: [], complete: false };

console.log(JSON.stringify({ live, confirmed, models, rounds, questions: questions.length, maxCalls, out }));
if (!live) process.exit(0);

const missing = unscored();
if (missing.length || !CONFIRMED_ON) {
    console.error(JSON.stringify({ error: 'expectations not filled in', unscored: missing, confirmedOn: CONFIRMED_ON,
        hint: 'Edit tc-grounding-hard.mts: fill every expectAny / keyPoints and set CONFIRMED_ON, then re-run.' }));
    process.exit(2);
}
if (!confirmed) {
    console.error(JSON.stringify({ error: 'pass --confirm-expectations to attest the answers were verified today', confirmedOn: CONFIRMED_ON }));
    process.exit(2);
}

loadEnv({ path: ['.env.local', '.env'], quiet: true });
if (!process.env.API_KEY_TIER1) { console.error('API_KEY_TIER1 missing; no calls made.'); process.exit(2); }
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY_TIER1, httpOptions: { timeout: timeoutMs } });
const save = () => writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
save();

/** groundingSupports segments are UTF-8 BYTE offsets (server/agent/gemini-citations.ts) — measure in bytes. */
function supportRatio(text: string, grounding: any): number {
    const total = Buffer.byteLength(text, 'utf8');
    if (!total) return 0;
    const spans = (grounding?.groundingSupports ?? [])
        .map((s: any) => [s.segment?.startIndex ?? 0, s.segment?.endIndex ?? 0] as [number, number])
        .filter(([a, b]: [number, number]) => b > a)
        .sort((x: [number, number], y: [number, number]) => x[0] - y[0]);
    let covered = 0, end = 0;
    for (const [a, b] of spans) {
        if (b <= end) continue;
        covered += b - Math.max(a, end);
        end = b;
    }
    return Math.min(1, covered / total);
}

const systemInstruction = getSystemInstruction('Korean');
let stop = false;
// round 0 = search-off control, 1..rounds = search-on
for (let round = 0; round <= rounds && !stop; round++) {
    const search = round > 0;
    for (const [qIndex, question] of questions.entries()) {
        const shift = (round + qIndex) % models.length;
        for (const model of [...models.slice(shift), ...models.slice(0, shift)]) {
            const thinking = resolveThinkingConfig({ model, intent: 'general', isYoutubeRequest: false,
                hasVideoData: false, hasUrlContent: false, isMediaTurn: false });
            const contents: Content[] = [{ role: 'user', parts: [{ text: question.q }] }];
            const start = performance.now();
            let row: any;
            try {
                const response = await ai.models.generateContent({ model, contents, config: {
                    systemInstruction, ...(search ? { tools: [{ googleSearch: {} }] } : {}),
                    ...(thinking ? { thinkingConfig: thinking as any } : {}),
                    maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs),
                } });
                const candidate = response.candidates?.[0];
                const text = (candidate?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
                const grounding: any = candidate?.groundingMetadata;
                const queries: string[] = grounding?.webSearchQueries ?? [];
                const chunks = grounding?.groundingChunks?.length ?? 0;
                const invoked = queries.length > 0 || chunks > 0;
                const s = score(question, text);
                row = { status: 'OK', invoked, queryCount: queries.length, chunkCount: chunks, queries,
                    ...s, coverage: s.covered / s.total,
                    supportRatio: search ? Number(supportRatio(text, grounding).toFixed(3)) : null,
                    citedWrong: invoked && !s.correct,
                    reportedModel: response.modelVersion ?? null, usage: response.usageMetadata ?? null, text };
            } catch (e: any) {
                const httpStatus = Number(e?.status ?? e?.response?.status ?? 0);
                row = { status: 'ERROR', httpStatus, errorCategory: httpStatus === 429 ? 'quota'
                    : httpStatus === 400 ? 'invalid-request' : httpStatus === 404 ? 'model-unavailable'
                    : [401, 403].includes(httpStatus) ? 'auth' : httpStatus >= 500 ? 'provider' : 'transport-or-timeout' };
                // 5xx/timeout are provider weather — record and continue; quota/auth/404 stop the run
                if (!['provider', 'transport-or-timeout'].includes(row.errorCategory)) stop = true;
            }
            row = { round, search, question: question.id, kind: question.kind, model,
                thinkingSent: thinking ?? 'provider-default', ...row, elapsedMs: Math.round(performance.now() - start) };
            report.results.push(row); save();
            console.log(JSON.stringify({ round, search, q: row.question, model, status: row.status, invoked: row.invoked,
                queries: row.queryCount, cov: row.status === 'OK' ? `${row.covered}/${row.total}` : null,
                support: row.supportRatio, citedWrong: row.citedWrong, ms: row.elapsedMs }));
            if (stop) break;
        }
        if (stop) break;
    }
}

// ── verdict ─────────────────────────────────────────────────────────────────────
const ok = report.results.filter((r: any) => r.status === 'OK');
const notDiscriminative = new Set<string>(ok.filter((r: any) => !r.search && r.correct).map((r: any) => `${r.model}|${r.question}`));
const summary: any[] = [];
for (const model of models) {
    const on = ok.filter((r: any) => r.model === model && r.search && !notDiscriminative.has(`${model}|${r.question}`));
    const mean = (xs: number[]) => xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null;
    summary.push({ model, scored: on.length,
        correct: on.filter((r: any) => r.correct).length,
        coverage: mean(on.map((r: any) => r.coverage)),
        synthCoverage: mean(on.filter((r: any) => r.kind === 'synth').map((r: any) => r.coverage)),
        supportRatio: mean(on.filter((r: any) => r.invoked).map((r: any) => r.supportRatio)),
        invoked: on.filter((r: any) => r.invoked).length,
        citedWrong: on.filter((r: any) => r.citedWrong).length,
        excludedQuestions: [...notDiscriminative].filter(k => k.startsWith(model + '|')).map(k => k.split('|')[1]) });
}
report.summary = summary;
report.complete = report.results.length === maxCalls;
report.finishedAt = new Date().toISOString();
save();
console.table(summary.map(({ excludedQuestions, ...rest }) => ({ ...rest, excluded: excludedQuestions.join(',') || '-' })));
console.log(JSON.stringify({ complete: report.complete, recorded: report.results.length, maxCalls, out }));
if (!report.complete) process.exitCode = 1;
