/** Suite B — search grounding accuracy across 3.6 / 3.7 / 3.8.
 *
 * Re-tests the 3.6 defect recorded in PLAN_MODEL_3_7_MIGRATION_260817 §2, which rested on
 * ONE question x 5 rounds. Records the same four axes that section used:
 *   invoked      — did googleSearch actually run
 *   queryCount   — how many search queries were issued (3.6 issued exactly 1 every time)
 *   correct      — does the answer contain the confirmed fact
 *   citedWrong   — grounded AND wrong: the UI draws a source chip on a false answer.
 *                  This is the axis that matters; §2 called it worse than not searching.
 *
 * Expected answers are time-sensitive, so they are NOT shipped filled in. A human confirms each
 * one immediately before the run and passes --confirm-expectations. The probe refuses to spend
 * requests it cannot score.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI, type Content } from '@google/genai';
import { getSystemInstruction } from '../../../server/agent/prompt';
import { resolveThinkingConfig } from '../../../server/agent/nodes/generation-config';
// Questions and expectations live in tc-grounding.mts — that is the file a human edits.
import { CONFIRMED_ON, questions, isCorrect, unscored } from './tc-grounding.mjs';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
};
const rounds = Number(option('--rounds', '5'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error('--rounds must be 1..5');
const out = option('--out', '/tmp/gemini-three-way-grounding.json');
const live = args.includes('--live');
const confirmed = args.includes('--confirm-expectations');
const models = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'] as const;
const timeoutMs = 45_000;
const maxOutputTokens = 4096;

const maxCalls = questions.length * models.length * rounds;
if (maxCalls > 120) throw new Error(`Refusing ${maxCalls} calls`);

const report: any = { startedAt: new Date().toISOString(), suite: 'grounding-accuracy',
    models, rounds, questions: questions.length, maxCalls, maxOutputTokens, timeoutMs,
    expectationsConfirmedOn: CONFIRMED_ON, keySelection: 'API_KEY_TIER1', billingTierVerified: false,
    thinkingCondition: 'production resolver only',
    scope: 'Direct SDK with googleSearch enabled. Measures grounding invocation, query breadth and '
        + 'answer correctness. Does not exercise the app router, the 2.5 search downgrade path, or the UI source chips.',
    results: [], complete: false };

console.log(JSON.stringify({ live, confirmed, models, rounds, questions: questions.length, maxCalls, out }));
if (!live) process.exit(0);

const missing = unscored();
if (missing.length || !CONFIRMED_ON) {
    console.error(JSON.stringify({ error: 'expectations not filled in', unscored: missing, confirmedOn: CONFIRMED_ON,
        hint: 'Edit tc-grounding.mts: fill every question\'s expectAny and set CONFIRMED_ON, then re-run.' }));
    process.exit(2);
}
if (!confirmed) {
    console.error(JSON.stringify({ error: 'pass --confirm-expectations to attest the answers were verified today',
        confirmedOn: CONFIRMED_ON }));
    process.exit(2);
}

loadEnv({ path: ['.env.local', '.env'], quiet: true });
if (!process.env.API_KEY_TIER1) { console.error('API_KEY_TIER1 missing; no calls made.'); process.exit(2); }
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY_TIER1, httpOptions: { timeout: timeoutMs } });
const save = () => writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
save();

const systemInstruction = getSystemInstruction('Korean');
let stop = false;
for (let round = 0; round < rounds && !stop; round++) {
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
                    systemInstruction, tools: [{ googleSearch: {} }],
                    ...(thinking ? { thinkingConfig: thinking as any } : {}),
                    maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs),
                } });
                const candidate = response.candidates?.[0];
                const text = (candidate?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
                const grounding: any = candidate?.groundingMetadata;
                const queries: string[] = grounding?.webSearchQueries ?? [];
                const chunks = grounding?.groundingChunks?.length ?? 0;
                const invoked = queries.length > 0 || chunks > 0;
                const correct = isCorrect(question, text);
                row = { status: 'OK', invoked, queryCount: queries.length, chunkCount: chunks,
                    queries, correct,
                    // The dangerous case: grounded, cited in the UI, and still wrong.
                    citedWrong: invoked && !correct,
                    reportedModel: response.modelVersion ?? null, usage: response.usageMetadata ?? null, text };
            } catch (e: any) {
                const httpStatus = Number(e?.status ?? e?.response?.status ?? 0);
                row = { status: 'ERROR', httpStatus, errorCategory: httpStatus === 429 ? 'quota'
                    : httpStatus === 400 ? 'invalid-request' : httpStatus === 404 ? 'model-unavailable'
                    : [401, 403].includes(httpStatus) ? 'auth' : httpStatus >= 500 ? 'provider' : 'transport-or-timeout' };
                stop = true;
            }
            row = { round: round + 1, question: question.id, model, thinkingSent: thinking ?? 'provider-default',
                ...row, elapsedMs: Math.round(performance.now() - start) };
            report.results.push(row); save();
            console.log(JSON.stringify({ round: row.round, question: row.question, model,
                status: row.status, invoked: row.invoked, queries: row.queryCount,
                correct: row.correct, citedWrong: row.citedWrong, elapsedMs: row.elapsedMs }));
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
