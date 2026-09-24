/** Bounded SDK/LangChain compatibility probe. Dry-run by default; no key rotation or real tools. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type, FunctionCallingConfigMode, type GenerateContentConfig, type Content } from '@google/genai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { getSystemInstruction, getRendererSections, getIntentPolicy } from '../../../server/agent/prompt';
import { resolveThinkingConfig } from '../../../server/agent/nodes/generation-config';

const args = process.argv.slice(2);
function option(name: string, fallback: string) {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
}
const model = option('--model', 'gemini-3.8-flash');
if (!['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'].includes(model)) throw new Error('Unsupported comparison model');
const tier = option('--tier', 'paid');
if (!['free', 'paid'].includes(tier)) throw new Error('--tier must be free or paid');
const suite = option('--suite', 'smoke');
if (!['smoke', 'extended'].includes(suite)) throw new Error('--suite must be smoke or extended');
const out = option('--out', `/tmp/gemini-3-8-${tier}-${suite}.json`);
const live = args.includes('--live');
const startedAt = new Date().toISOString();
const timeoutMs = 45_000;
const maxOutputTokens = 4096;
const low = model === 'gemini-2.5-flash' ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW };
type Case = { id: string; contents: Content[]; config?: GenerateContentConfig; expected400?: boolean;
    transport?: 'langchain'; check: (text: string, calls: Array<{ name?: string; args?: unknown }>) => boolean };
const prompt = (text: string): Content[] => [{ role: 'user', parts: [{ text }] }];
const cases: Case[] = [
    { id: 'low-text', contents: prompt('17 더하기 25의 결과를 숫자만 출력하세요.'), check: t => t.trim() === '42' },
    { id: 'production-thinking', contents: prompt('17 더하기 25의 결과를 숫자만 출력하세요.'),
        config: { thinkingConfig: resolveThinkingConfig({ model, intent: 'general', isYoutubeRequest: false,
            hasVideoData: false, hasUrlContent: false, isMediaTurn: false }) as GenerateContentConfig['thinkingConfig'] }, check: t => t.trim() === '42' },
    { id: 'structured-json', contents: prompt('Return an object with answer 42.'), config: {
        responseMimeType: 'application/json', responseSchema: { type: Type.OBJECT,
            properties: { answer: { type: Type.INTEGER } }, required: ['answer'] } },
        check: t => { try { return JSON.parse(t).answer === 42; } catch { return false; } } },
    { id: 'function-call', contents: prompt('Call add with a=17 and b=25.'), config: {
        tools: [{ functionDeclarations: [{ name: 'add', description: 'Add two integers.', parameters: {
            type: Type.OBJECT, properties: { a: { type: Type.INTEGER }, b: { type: Type.INTEGER } }, required: ['a', 'b'] } }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['add'] } } },
        check: (_t, calls) => calls.length === 1 && calls[0].name === 'add' &&
            (calls[0].args as any)?.a === 17 && (calls[0].args as any)?.b === 25 },
];
if (suite === 'extended') {
    if (model === 'gemini-3.8-flash' || model === 'gemini-3.7-flash') cases.push({
        id: 'minimal-rejected', contents: prompt('Return OK.'), expected400: true,
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }, check: () => false });
    cases.push({ id: 'budget-zero', contents: prompt('17 더하기 25의 결과를 숫자만 출력하세요.'),
        config: { thinkingConfig: { thinkingBudget: 0 } }, check: t => t.trim() === '42' });
    cases.push({ id: 'app-chart-prompt', contents: prompt('막대 그래프로 A=10, B=20, C=30을 그려줘. 시리즈는 하나만.'),
        config: { systemInstruction: [getSystemInstruction('Korean'), getRendererSections('data_viz', 'Korean'),
            getIntentPolicy('data_viz')].filter(Boolean).join('\n\n') }, check: t => {
            try { const chart = JSON.parse(t.match(/```json:chart\s*([\s\S]*?)```/)?.[1] ?? '');
                return chart.type === 'bar' && JSON.stringify(chart.data?.categories) === '["A","B","C"]' &&
                    chart.data?.series?.length === 1 && JSON.stringify(chart.data.series[0].data) === '[10,20,30]';
            } catch { return false; }
        } });
    const history: Content[] = [];
    for (let i = 0; i < 12; i++) {
        history.push(...prompt(`기록 ${i}: ${'배송 기록의 상태는 보류입니다. '.repeat(80)} 보관 코드 ITEM_${i}=VALUE_${100+i}.`));
        history.push({ role: 'model', parts: [{ text: `기록 ${i}를 확인했습니다.` }] });
    }
    cases.push({ id: 'long-history', contents: [...history, ...prompt('첫 기록의 ITEM_0 값만 출력하세요.')],
        check: t => t.trim() === 'VALUE_100' });
    cases.push({ id: 'langchain-low', contents: prompt('17 더하기 25의 결과를 숫자만 출력하세요.'),
        transport: 'langchain', check: t => t.trim() === '42' });
}
if (cases.length > 9 || cases.some(c => JSON.stringify(c.contents).length + JSON.stringify(c.config ?? {}).length > 100_000)) {
    throw new Error('Probe exceeds request/input limits');
}
console.log(JSON.stringify({ live, model, tier, suite, requests: cases.length, maxOutputTokens,
    timeoutMs, maxInputCharsPerRequest: 100_000, cases: cases.map(c => c.id), out }));
if (!live) process.exit(0);
loadEnv({ path: ['.env.local', '.env'], quiet: true });
// Select exactly one key; do not mutate the application's key pool.
const key = tier === 'paid' ? process.env.API_KEY_TIER1 :
    Object.keys(process.env).filter(k => /^API_KEY\d*$/.test(k)).sort().map(k => process.env[k]).find(Boolean);
if (!key) { console.error(`Missing ${tier} API key; no requests made.`); process.exit(2); }
const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: timeoutMs } });
const results: Array<Record<string, unknown>> = [];
const save = () => writeFileSync(out, JSON.stringify({ startedAt, model, tier, suite, results,
    keySelection: tier === 'paid' ? 'API_KEY_TIER1' : 'first populated API_KEY/numbered key',
    billingTierVerified: false,
    scope: 'Direct SDK and isolated LangChain compatibility, not app graph/route/UI acceptance. No search, uploads, or external tool execution.',
    complete: results.length === cases.length, callsPlanned: cases.length,
}, null, 2) + '\n');
save(); // Validate output path before spending requests.
for (const c of cases) {
    const start = performance.now();
    const config = { maxOutputTokens, thinkingConfig: low, ...c.config };
    try {
        let text = '', calls: Array<{ name?: string; args?: unknown }> = [];
        let usage: unknown, resolvedModel: unknown;
        if (c.transport === 'langchain') {
            const llm = new ChatGoogleGenerativeAI({ apiKey: key, model, maxOutputTokens, maxRetries: 0,
                thinkingConfig: model === 'gemini-2.5-flash' ? { thinkingBudget: 0 } : { thinkingLevel: 'LOW' } });
            const response = await llm.invoke([new HumanMessage(c.contents[0].parts![0].text!)], { signal: AbortSignal.timeout(timeoutMs) });
            text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            usage = response.usage_metadata; resolvedModel = (response.response_metadata as Record<string, unknown>)?.model_name ?? null;
        } else {
            const response = await ai.models.generateContent({ model, contents: c.contents,
                config: { ...config, abortSignal: AbortSignal.timeout(timeoutMs) } });
            // Avoid accessor warnings for thought/function-call-only candidates.
            const parts = response.candidates?.[0]?.content?.parts ?? [];
            text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('');
            calls = parts.flatMap(p => p.functionCall ? [p.functionCall] : []);
            usage = response.usageMetadata; resolvedModel = response.modelVersion ?? null;
        }
        const ok = !c.expected400 && c.check(text, calls);
        results.push({ id: c.id, status: ok ? 'PASS' : 'FAIL', elapsedMs: Math.round(performance.now()-start),
            resolvedModel, thinking: config.thinkingConfig ?? 'provider-default', usage, text: text.slice(0, 4000), calls });
    } catch (e: any) {
        const status = Number(e?.status ?? e?.response?.status ?? 0);
        // Classify privately; never print raw SDK exceptions, URLs, or credentials.
        const message = String(e?.message ?? '').toLowerCase();
        const expected = c.expected400 && status === 400 && /minimal/.test(message) && /support|invalid/.test(message);
        results.push({ id: c.id, status: expected ? 'PASS_EXPECTED_REJECTION' : 'ERROR', httpStatus: status,
            elapsedMs: Math.round(performance.now()-start), category: expected ? 'minimal-rejected' :
                status === 429 ? 'quota' : status === 404 ? 'model-unavailable' : status === 400 ? 'invalid-request' :
                    [401,403].includes(status) ? 'auth' : status >= 500 ? 'provider' : 'transport-or-sdk' });
        if (!expected && (status === 0 || [401,403,404,429].includes(status))) {
            console.log(JSON.stringify(results.at(-1))); save(); break;
        }
    }
    console.log(JSON.stringify(results.at(-1))); save();
}
if (results.length !== cases.length || results.some(r => r.status === 'FAIL' || r.status === 'ERROR')) process.exitCode = 1;
