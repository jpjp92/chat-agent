/** Aggregate Suite A and/or Suite B reports. Accuracy first, latency second. No network.
 * Detects each file by its `suite` field, so argument order does not matter. */
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
if (outIndex >= 0 && !argv[outIndex + 1]) throw new Error('--out requires a path');
const out = outIndex < 0 ? '/tmp/gemini-three-way-summary.json' : argv[outIndex + 1];
// Drop the flag AND its value, so the destination is never read back as an input report.
const paths = argv.filter((a, i) => !a.startsWith('--') && i !== outIndex + 1);
if (!paths.length) throw new Error('Pass one or both captured report paths');

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b);
    return !s.length ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rate = (hit: number, total: number) => total ? Number((hit / total).toFixed(3)) : null;

const summary: any = { sources: paths, generatedAt: new Date().toISOString() };

for (const path of paths) {
    const report = JSON.parse(readFileSync(path, 'utf8'));

    if (report.suite === 'generation-accuracy') {
        const cells = [];
        for (const model of report.models) for (const condition of report.conditions) {
            const rows = report.results.filter((r: any) => r.model === model && r.condition === condition);
            const scored = rows.filter((r: any) => r.status !== 'ERROR');
            const pass = scored.filter((r: any) => r.status === 'PASS');
            // Which check fails most tells you WHY a model loses, not just that it does.
            const failedChecks: Record<string, number> = {};
            for (const r of scored) for (const [k, v] of Object.entries(r.checks ?? {})) if (!v) failedChecks[k] = (failedChecks[k] ?? 0) + 1;
            const errors: Record<string, number> = {};
            for (const r of rows.filter((x: any) => x.status === 'ERROR')) errors[r.errorCategory] = (errors[r.errorCategory] ?? 0) + 1;
            cells.push({ model, condition, total: rows.length, scored: scored.length,
                accuracy: rate(pass.length, scored.length), pass: pass.length,
                // An empty answer is the 3.5/3.6 renderer failure mode, tracked separately from a wrong one.
                emptyAnswers: scored.filter((r: any) => r.checks?.nonempty === false).length,
                truncated: scored.filter((r: any) => r.checks?.notTruncated === false).length,
                failedChecks, errors,
                thinkingSent: [...new Set(rows.map((r: any) => JSON.stringify(r.thinkingSent)))],
                medianMs: median(pass.map((r: any) => r.elapsedMs)),
                maxMs: pass.length ? Math.max(...pass.map((r: any) => r.elapsedMs)) : null,
                outputTokens: rows.reduce((a: number, r: any) => a + (r.usage?.candidatesTokenCount ?? 0), 0) });
        }
        const byIntent = [...new Set(report.results.map((r: any) => r.intent))].map(intent => ({ intent,
            cells: report.models.flatMap((model: string) => report.conditions.map((condition: string) => {
                const rows = report.results.filter((r: any) => r.intent === intent && r.model === model && r.condition === condition);
                const scored = rows.filter((r: any) => r.status !== 'ERROR');
                return { model, condition, accuracy: rate(scored.filter((r: any) => r.status === 'PASS').length, scored.length),
                    n: scored.length };
            })) }));
        summary.generation = { complete: report.complete, recorded: report.results.length, maxCalls: report.maxCalls,
            cells, byIntent,
            limitation: `${report.rounds} rounds per cell; deterministic structure/value scoring, not free-form quality. `
                + 'Excludes router, tools, search grounding, media and browser rendering.' };
    }

    if (report.suite === 'grounding-accuracy') {
        summary.grounding = { complete: report.complete, recorded: report.results.length, maxCalls: report.maxCalls,
            expectationsConfirmedOn: report.expectationsConfirmedOn,
            byModel: report.models.map((model: string) => {
                const rows = report.results.filter((r: any) => r.model === model && r.status === 'OK');
                const invoked = rows.filter((r: any) => r.invoked);
                return { model, n: rows.length,
                    invocationRate: rate(invoked.length, rows.length),
                    accuracy: rate(rows.filter((r: any) => r.correct).length, rows.length),
                    // §2's headline risk: a source chip rendered on a wrong answer.
                    citedWrong: rows.filter((r: any) => r.citedWrong).length,
                    medianQueryCount: median(invoked.map((r: any) => r.queryCount)),
                    maxQueryCount: invoked.length ? Math.max(...invoked.map((r: any) => r.queryCount)) : null,
                    medianMs: median(rows.map((r: any) => r.elapsedMs)) };
            }),
            byQuestion: [...new Set(report.results.map((r: any) => r.question))].map(question => ({ question,
                models: report.models.map((model: string) => {
                    const rows = report.results.filter((r: any) => r.question === question && r.model === model && r.status === 'OK');
                    return { model, n: rows.length, correct: rows.filter((r: any) => r.correct).length,
                        citedWrong: rows.filter((r: any) => r.citedWrong).length };
                }) })),
            limitation: 'Answers scored against human-confirmed expectations fixed on the date above. '
                + 'Live web results drift, so this measures that day only. The app downgrades free-tier search '
                + 'turns to 2.5, so these rates describe the paid-key 3.x path.' };
    }
}

writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
