/** Suite A — non-search generation accuracy across 3.6 / 3.7 / 3.8, per intent.
 *
 * Two thinking conditions per case, so "the model is worse" stays separable from
 * "our setting is worse":
 *   low        — explicit LOW for all three models (apples to apples)
 *   production — whatever `resolveThinkingConfig` really returns for that model
 *                (3.6 → minimal, 3.7 → low, 3.8 → unregistered default / budget)
 *
 * Direct SDK only: no router, tools, search, media, graph or browser.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { getSystemInstruction, getRendererSections, getIntentFocusHint } from '../../../server/agent/prompt';
import { resolveThinkingConfig } from '../../../server/agent/nodes/generation-config';
import { score, passed, tcs } from './tc-intents.mjs';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
};
const rounds = Number(option('--rounds', '3'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error('--rounds must be 1..5');
const out = option('--out', '/tmp/gemini-three-way.json');
const live = args.includes('--live');
const models = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'] as const;
const conditions = ['low', 'production'] as const;
const timeoutMs = 45_000;
const maxOutputTokens = 4096;

/** The production resolver is called for real; a non-search, non-media general turn. */
const thinkingFor = (model: string, condition: string, intent: string) =>
    condition === 'low'
        ? { thinkingLevel: ThinkingLevel.LOW }
        : resolveThinkingConfig({ model, intent, isYoutubeRequest: false,
            hasVideoData: false, hasUrlContent: false, isMediaTurn: false });

const cases = tcs.map(tc => {
    const contents: Content[] = [{ role: 'user', parts: [{ text: tc.q }] }];
    const systemInstruction = [getSystemInstruction('Korean'), getRendererSections(tc.intent, 'Korean'),
        getIntentFocusHint(tc.intent)].filter(Boolean).join('\n\n');
    const input = JSON.stringify({ contents, systemInstruction });
    if (input.length > 100_000) throw new Error(`Input too large: ${tc.id}`);
    return { tc, contents, systemInstruction, inputHash: createHash('sha256').update(input).digest('hex') };
});

const maxCalls = cases.length * models.length * conditions.length * rounds;
if (maxCalls > 420) throw new Error(`Refusing ${maxCalls} calls`);

const report: any = { startedAt: new Date().toISOString(), suite: 'generation-accuracy',
    models, conditions, rounds, cases: cases.length, maxCalls, maxOutputTokens, timeoutMs,
    keySelection: 'API_KEY_TIER1', billingTierVerified: false,
    scope: 'Direct SDK generation with production prompt sections. Deterministic scoring, no LLM judge. '
        + 'Excludes router, tools, search grounding, media, app graph, HTTP/SSE and browser rendering.',
    results: [], complete: false };

console.log(JSON.stringify({ live, models, conditions, rounds, cases: cases.length, maxCalls, out }));
if (!live) process.exit(0);

loadEnv({ path: ['.env.local', '.env'], quiet: true });
if (!process.env.API_KEY_TIER1) { console.error('API_KEY_TIER1 missing; no calls made.'); process.exit(2); }
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY_TIER1, httpOptions: { timeout: timeoutMs } });
const save = () => writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
save(); // Validate the output path before spending any requests.

let stop = false;
for (let round = 0; round < rounds && !stop; round++) {
    const ordered = round % 2 === 0 ? cases : [...cases].reverse();
    for (const [caseIndex, c] of ordered.entries()) {
        for (const condition of conditions) {
            // Rotate which model goes first so warm-up and drift do not favour one consistently.
            const shift = (round + caseIndex) % models.length;
            for (const model of [...models.slice(shift), ...models.slice(0, shift)]) {
                const thinking = thinkingFor(model, condition, c.tc.intent);
                const start = performance.now();
                let text = '', firstTextMs: number | null = null, usage: any = null;
                const reportedModels = new Set<string>();
                let finishReason: unknown = null, row: any;
                try {
                    const stream = await ai.models.generateContentStream({ model, contents: c.contents, config: {
                        systemInstruction: c.systemInstruction,
                        ...(thinking ? { thinkingConfig: thinking as any } : {}),
                        maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs),
                    } });
                    for await (const chunk of stream) {
                        if (chunk.modelVersion) reportedModels.add(chunk.modelVersion);
                        if (chunk.usageMetadata) usage = chunk.usageMetadata;
                        if (chunk.candidates?.[0]?.finishReason) finishReason = chunk.candidates[0].finishReason;
                        const delta = (chunk.candidates?.[0]?.content?.parts ?? [])
                            .filter(p => !p.thought).map(p => p.text ?? '').join('');
                        if (delta && firstTextMs === null) firstTextMs = performance.now() - start;
                        text += delta;
                    }
                    const checks = score(c.tc, text);
                    checks.actualModel = reportedModels.has(model) && reportedModels.size === 1;
                    checks.notTruncated = finishReason === 'STOP';
                    row = { status: passed(checks) ? 'PASS' : 'FAIL', checks, finishReason };
                } catch (e: any) {
                    const httpStatus = Number(e?.status ?? e?.response?.status ?? 0);
                    // An unregistered model rejecting a production thinking config is a RESULT, not a
                    // harness failure — record it and keep going. Only infrastructure faults stop the run.
                    const category = httpStatus === 400 ? 'invalid-request' : httpStatus === 429 ? 'quota'
                        : httpStatus === 404 ? 'model-unavailable' : [401, 403].includes(httpStatus) ? 'auth'
                        : httpStatus >= 500 ? 'provider' : 'transport-or-timeout';
                    row = { status: 'ERROR', httpStatus, errorCategory: category, checks: {} };
                    if (category !== 'invalid-request') stop = true; // No key rotation, no retry.
                }
                row = { round: round + 1, case: c.tc.id, intent: c.tc.intent, model, condition,
                    thinkingSent: thinking ?? 'provider-default', inputHash: c.inputHash, ...row,
                    firstTextMs: firstTextMs === null ? null : Math.round(firstTextMs),
                    elapsedMs: Math.round(performance.now() - start),
                    reportedModels: [...reportedModels], usage, text };
                report.results.push(row); save();
                console.log(JSON.stringify({ round: row.round, case: row.case, model, condition,
                    status: row.status, elapsedMs: row.elapsedMs,
                    failed: Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k) }));
                if (stop) break;
            }
            if (stop) break;
        }
        if (stop) break;
    }
}
report.complete = report.results.length === maxCalls;
report.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ complete: report.complete, recorded: report.results.length, maxCalls, out }));
if (!report.complete) process.exitCode = 1;
