/**
 * gpt-6-luna vs gpt-5.6-luna — 실호출 능력 비교 프로브.
 *
 * 이 파일이 생긴 이유: 2026-09-23 에 `gpt-6-luna` 를 레지스트리에 넣으면서 capability 값
 * (`webSearch` · `chatReasoningEffort: 'none'` · `imageInput`)을 **모델 카드만 보고** 적었다.
 * 카드는 공급자가 쓴 문서지 우리 코드 경로에 대한 측정이 아니다 — 실제로 우리 요청 형태
 * (Responses API + strict function calling + hosted web search)에서 같은 값이 통하는지는
 * 별개 질문이다. 3.8 측정에서 배운 것과 같다: **재지 않은 것은 모른다.**
 *
 * 판정 기준은 "gpt-6-luna 가 잘 한다"가 아니라 **"이미 프로덕션에서 쓰는 5.6 luna 와 같은
 * 축에서 같은 결과가 나오는가"** 다. 그래서 두 모델을 같은 입력으로 나란히 돌린다.
 *
 * 축은 앱이 실제로 쓰는 것만 고른다:
 *   1. multiturn   — 히스토리 왕복. 카드 후속 대화가 전부 이 위에 선다
 *   2. function    — strict function calling. 로컬 도구 11종이 이걸로 돈다
 *   3. websearch   — hosted web search. 검색 tier 가 열리는 턴
 *   4. image       — 이미지 입력. 첨부 이미지 턴
 *
 * 비용이 드는 실호출이라 `npm test` 에 넣지 않는다.
 *   실행: npx tsx tests/manual/openai-6-luna/compare-luna.mts
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { generateOpenAIChat } from '../../../server/openai/chat.js';
import { openAIModelCapabilities } from '../../../server/openai/models.js';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}
if (!process.env.OPENAI_API_KEY_TIER1) {
    console.error('OPENAI_API_KEY_TIER1 이 .env.local 또는 .env 에 없습니다.');
    process.exit(1);
}

const MODELS = ['gpt-5.6-luna', 'gpt-6-luna'] as const;
const TIMEOUT_MS = 60_000;

/** 1×1 투명 PNG. 외부 호스트에 의존하지 않으려고 data URI 로 박았다 —
 *  이미지 **판독 능력**이 아니라 **이미지 파트를 받아들이는가**를 재는 축이다. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Probe = {
    id: string;
    skipIf?: (model: string) => string | null;
    run: (model: string) => Promise<string>;
};

const probes: Probe[] = [
    {
        id: 'multiturn',
        run: async model => {
            const r = await generateOpenAIChat({
                model,
                instructions: 'You are a connectivity test. Follow the user instruction exactly.',
                messages: [
                    new HumanMessage('Reply with exactly: FIRST'),
                    new AIMessage('FIRST'),
                    new HumanMessage('Reply with exactly: SECOND'),
                ],
                useWebSearch: false, maxOutputTokens: 32, timeoutMs: TIMEOUT_MS,
            });
            const text = r.text.trim();
            return text === 'SECOND' ? 'OK' : `MISMATCH(${text.slice(0, 40)})`;
        },
    },
    {
        id: 'function',
        run: async model => {
            const r = await generateOpenAIChat({
                model,
                instructions: 'Call the provided function exactly once.',
                messages: [new HumanMessage('Run the connectivity probe with token OK.')],
                useWebSearch: false, maxOutputTokens: 64, timeoutMs: TIMEOUT_MS,
                functionTool: {
                    intent: 'connectivity_probe',
                    name: 'connectivity_probe',
                    description: 'OpenAI function-calling connectivity probe.',
                    parameters: {
                        type: 'object',
                        properties: { token: { type: 'string', enum: ['OK'] } },
                        required: ['token'],
                        additionalProperties: false,
                    },
                    resultMode: 'fast-pass',
                    execute: async args => args.token === 'OK' ? 'FUNCTION_OK' : 'FUNCTION_BAD_ARGS',
                },
            });
            return r.text === 'FUNCTION_OK' ? 'OK' : `MISMATCH(${r.text.slice(0, 40)})`;
        },
    },
    {
        id: 'websearch',
        skipIf: model => openAIModelCapabilities(model).webSearch ? null : 'caps.webSearch=false',
        run: async model => {
            // 정답을 채점하지 않는다 — 우리가 궁금한 건 **hosted web search 를 붙인 요청이
            // 400 없이 돌고 출처가 실제로 달려 오는가** 다. 내용 정확도는 별개 축이다.
            const r = await generateOpenAIChat({
                model,
                instructions: 'Answer in one short sentence. Cite your source.',
                messages: [new HumanMessage('What is the latest stable release version of Node.js?')],
                useWebSearch: true, maxOutputTokens: 256, timeoutMs: TIMEOUT_MS,
            });
            if (!r.text.trim()) return 'EMPTY';
            return r.sources.length > 0 ? `OK(sources=${r.sources.length})` : 'NO_SOURCES';
        },
    },
    {
        id: 'image',
        skipIf: model => openAIModelCapabilities(model).imageInput ? null : 'caps.imageInput=false',
        run: async model => {
            const r = await generateOpenAIChat({
                model,
                instructions: 'Answer in one short sentence.',
                messages: [new HumanMessage({
                    content: [
                        { type: 'text', text: 'Describe this image in one short sentence.' },
                        { type: 'image_url', image_url: { url: PIXEL } },
                    ],
                })],
                useWebSearch: false, maxOutputTokens: 64, timeoutMs: TIMEOUT_MS,
            });
            return r.text.trim() ? 'OK' : 'EMPTY';
        },
    },
];

type Cell = { result: string; ms: number; error?: string };
const table: Record<string, Record<string, Cell>> = {};

for (const model of MODELS) {
    table[model] = {};
    for (const probe of probes) {
        const skip = probe.skipIf?.(model);
        if (skip) { table[model][probe.id] = { result: `SKIP(${skip})`, ms: 0 }; continue; }
        const startedAt = Date.now();
        try {
            const result = await probe.run(model);
            table[model][probe.id] = { result, ms: Date.now() - startedAt };
        } catch (error: any) {
            table[model][probe.id] = {
                result: 'ERROR', ms: Date.now() - startedAt,
                error: `${error?.status ?? ''} ${error?.code ?? ''} ${error?.message ?? error}`.trim(),
            };
        }
        console.log(`  ${model.padEnd(13)} ${probe.id.padEnd(10)} ${table[model][probe.id].result} (${table[model][probe.id].ms}ms)`);
    }
}

console.log('\n── 축별 대조 ──');
let diverged = 0;
for (const probe of probes) {
    const cells = MODELS.map(m => table[m][probe.id]);
    // 등가 판정은 결과의 **종류**로 한다. websearch 의 출처 개수처럼 호출마다 흔들리는
    // 값까지 같기를 요구하면 통과할 수 없는 시험이 된다.
    const kinds = cells.map(c => c.result.split('(')[0]);
    const same = kinds[0] === kinds[1];
    if (!same) diverged++;
    console.log(`${same ? '✅' : '❌'} ${probe.id.padEnd(10)} ` +
        MODELS.map((m, i) => `${m}=${cells[i].result}`).join('  ') +
        (cells.find(c => c.error) ? `\n     ${cells.map(c => c.error).filter(Boolean).join(' | ')}` : ''));
}

const out = `/tmp/openai-luna-compare-${Date.now()}.json`;
fs.writeFileSync(out, JSON.stringify({ models: MODELS, table, finishedAt: new Date().toISOString() }, null, 2));
console.log(`\n리포트 ${out}`);
console.log(diverged === 0
    ? '\n✅ 두 모델이 네 축 모두에서 같은 종류의 결과를 냈다 — gpt-6-luna 를 5.6 luna 와 같은 자리에 둘 수 있다.'
    : `\n❌ ${diverged}개 축에서 갈렸다 — 위 표의 해당 축을 먼저 해결한다. capability 값이 카드와 다를 수 있다.`);
process.exit(diverged === 0 ? 0 : 1);
