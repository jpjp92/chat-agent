/** 채팅 모델 레지스트리 + OpenAI Responses 배선 회귀 하니스. */
import fs from 'node:fs';
import { applyGeminiCitations, stripFabricatedCitations } from '../server/agent/gemini-citations.js';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { CHAT_MODELS, CHAT_MODEL_OPTIONS, CHAT_MODEL_SECTIONS, isChatModelId } from '../src/lib/models.js';
import { buildOpenAIChatRequest, generateOpenAIChat, normalizeOpenAIWebCitations, OpenAIChatError } from '../server/openai/chat.js';
import { isOpenAIChatModel, openAIModelCapabilities } from '../server/openai/models.js';
import { classifyChatError, OPENAI_QUOTA_ERROR_CODES } from '../server/chat-error-policy.js';
import { buildSearchProviderInstruction } from '../server/agent/search-provider.js';

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean, detail = '') => {
    if (condition) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const expectedIds = ['gemini-3.7-flash', 'gpt-5.4-mini', 'gpt-5.6-luna'];
for (const id of expectedIds) {
    check(`클라이언트 레지스트리  ${id}`, isChatModelId(id));
    check(`선택 목록  ${id}`, CHAT_MODEL_OPTIONS.some(option => option.id === id));
}
check('알 수 없는 모델 거부', !isChatModelId('gpt-future-user-input'));
check('기본 모델은 기존 3.6 유지', CHAT_MODELS.FLASH_3_6 === 'gemini-3.6-flash');
check('모델 선택 섹션 순서', CHAT_MODEL_SECTIONS.map(section => section.id).join(',') === 'gemini,openai,legacy');
check('현재 Gemini 모델 배치', CHAT_MODEL_OPTIONS.filter(option => option.section === 'gemini').map(option => option.id).join(',') === 'gemini-3.7-flash,gemini-3.6-flash');
// luna를 먼저 노출한다 — 카드 멀티턴 실측에서 5.4 mini보다 일관되게 정확했다(2026-08-23).
check('OpenAI 모델 배치', CHAT_MODEL_OPTIONS.filter(option => option.section === 'openai').map(option => option.id).join(',') === 'gpt-5.6-luna,gpt-5.4-mini');
check('이전 모델 배치', CHAT_MODEL_OPTIONS.filter(option => option.section === 'legacy').map(option => option.id).join(',') === 'gemini-3.5-flash,gemini-2.5-flash');

const serverModelsSource = fs.readFileSync(new URL('../server/models.ts', import.meta.url), 'utf8');
for (const id of expectedIds) {
    check(`서버 허용 목록  ${id}`, serverModelsSource.includes(id));
}
check('서버 route에서 모델 문자열 검증',
    fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8').includes('isChatModelId(model)'));
const chatRouteSource = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
const promptSource = fs.readFileSync(new URL('../server/agent/prompt.ts', import.meta.url), 'utf8');
const generatorSource = fs.readFileSync(new URL('../server/agent/nodes/generator.ts', import.meta.url), 'utf8');
check('채팅 route가 Gemini 키를 모든 공급자에 선행 강제하지 않음',
    !chatRouteSource.includes('if (API_KEYS.length === 0)'));
check('GPT 일반 경로가 Gemini 키 취득보다 먼저 실행됨',
    generatorSource.indexOf('if ((!useLangChain || localFunctionTool) && isOpenAIChatModel(resolvedModel))') >= 0
    && generatorSource.indexOf('if ((!useLangChain || localFunctionTool) && isOpenAIChatModel(resolvedModel))')
        < generatorSource.indexOf('const geminiApiKey = getNextApiKey()'));
check('OpenAI 응답은 generator에서 직접 중복 전송하지 않음',
    generatorSource.includes("provider: 'openai'")
    && !generatorSource.includes('if (sendEvent) sendEvent({ text: result.text })'));
check('route가 OpenAI 번호 인용을 Gemini 정규식과 분리',
    chatRouteSource.includes("output?.provider === 'openai'"));
// Gemini도 groundingSupports 기반 실제 링크를 심으므로, 가짜 번호 제거는 맨 대괄호에만 적용한다.
check('가짜 인용 제거가 실제 링크를 훼손하지 않음', chatRouteSource.includes('(?!\\()/g'));
check('OpenAI quota 전용 안내 분기',
    chatRouteSource.includes('classifyChatError(error'));
check('OpenAI quota 사용자 안내 문구',
    chatRouteSource.includes('GPT 토큰 할당량이 모두 소진되었습니다. 나중에 다시 시도해주세요.'));
check('기술 오류 문자열을 SSE로 직접 노출하지 않음',
    !chatRouteSource.includes("sendEvent({ error: 'LLM returned empty response.' })") &&
    !chatRouteSource.includes("sendEvent({ error: 'No API keys found in server environment.' })"));
check('공급자별 hosted search 런타임 이름 매핑',
    buildSearchProviderInstruction('google').includes('tool=googleSearch')
    && buildSearchProviderInstruction('openai').includes('tool=web_search'));
check('검색 비활성 프로필은 도구 없음 명시',
    buildSearchProviderInstruction('none').includes('enabled=false')
    && buildSearchProviderInstruction('none').includes('tool=none'));
check('공통 프롬프트에서 google_search 고정 도구명 제거',
    !promptSource.includes("'google_search' tool")
    && promptSource.includes('[ACTIVE_WEB_SEARCH]'));
check('Gemini SDK 요청에 실제 Google 공급자 프로필 주입',
    generatorSource.includes("useGoogleSearch ? 'google' : 'none'")
    && generatorSource.includes('systemInstruction: googleProviderInstruction'));

for (const code of OPENAI_QUOTA_ERROR_CODES) {
    check(`OpenAI 영구 소진 코드 분류  ${code}`,
        classifyChatError({ status: 429, code }) === 'openAIQuota');
}
check('OpenAI 일시적 429는 rate limit 분류',
    classifyChatError({ status: 429, code: 'rate_limit_exceeded' }) === 'rateLimit');

for (const model of ['gpt-5.4-mini', 'gpt-5.6-luna']) {
    check(`OpenAI 채팅 모델 판정  ${model}`, isOpenAIChatModel(model));
    check(`OpenAI 사고 비활성  ${model}`, openAIModelCapabilities(model).chatReasoningEffort === 'none');
    const body = buildOpenAIChatRequest({
        model,
        instructions: '테스트 지시',
        messages: [
            new HumanMessage({ content: [{ type: 'text', text: '최신 소식' }] }),
            new AIMessage('이전 답변'),
            new HumanMessage({ content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }),
        ],
        useWebSearch: true,
        maxOutputTokens: 2048,
    });
    check(`요청 reasoning=none  ${model}`, body.reasoning?.effort === 'none');
    check(`요청 저장 비활성  ${model}`, body.store === false);
    check(`요청 웹 검색 강제  ${model}`, body.tools?.[0]?.type === 'web_search' && body.tool_choice === 'required');
    check(`OpenAI 검색 프롬프트 매핑  ${model}`,
        body.instructions?.includes('provider=OpenAI Web Search')
        && body.instructions?.includes('tool=web_search')
        && !body.instructions?.includes('tool=googleSearch'));
    check(`멀티턴 user 텍스트는 easy-input 문자열  ${model}`,
        body.input?.[0]?.role === 'user' && body.input?.[0]?.content === '최신 소식');
    check(`멀티턴 assistant 히스토리는 문자열  ${model}`,
        body.input?.[1]?.role === 'assistant' && body.input?.[1]?.content === '이전 답변');
    check(`요청 이미지 전달  ${model}`,
        body.input?.some((message: any) => Array.isArray(message.content) &&
            message.content.some((part: any) => part.type === 'input_image')));
}

const noSearchBody = buildOpenAIChatRequest({
    model: 'gpt-5.4-mini', instructions: '테스트 지시', messages: [new HumanMessage('안녕')],
    useWebSearch: false, maxOutputTokens: 256,
});
check('OpenAI 검색 OFF 프롬프트 매핑',
    noSearchBody.instructions?.includes('enabled=false')
    && noSearchBody.instructions?.includes('tool=none')
    && !noSearchBody.tools);

const localRegistrySource = fs.readFileSync(new URL('../server/agent/local-tool-registry.ts', import.meta.url), 'utf8');
check('GPT 로컬 함수 intent 9종 등록',
    ['drug_info', 'pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa', 'movie_search', 'sports', 'weather']
        .every(intent => localRegistrySource.includes(`intent: '${intent}'`)));
check('strict 함수 객체는 추가 속성을 거부하고 모든 속성을 required 처리',
    localRegistrySource.includes("additionalProperties: false")
    && localRegistrySource.includes('required: Object.keys(properties)'));

const weatherFunction = {
    intent: 'weather',
    name: 'show_weather',
    description: '날씨 조회',
    parameters: {
        type: 'object',
        properties: { cities: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] } },
        required: ['cities'],
        additionalProperties: false,
    },
    resultMode: 'fast-pass' as const,
    cardType: 'weather' as const,
    execute: async () => '',
};
const functionBody = buildOpenAIChatRequest({
    model: 'gpt-5.4-mini', instructions: '테스트', messages: [new HumanMessage('서울 날씨')],
    useWebSearch: false, maxOutputTokens: 256, functionTool: weatherFunction,
});
check('Responses 함수 도구는 flat strict 형식',
    functionBody.tools?.[0]?.type === 'function'
    && functionBody.tools?.[0]?.name === weatherFunction.name
    && functionBody.tools?.[0]?.strict === true
    && !functionBody.tools?.[0]?.function);
check('intent 함수 단일 강제·병렬 비활성',
    functionBody.tool_choice?.name === weatherFunction.name
    && functionBody.parallel_tool_calls === false);

let fastPassCalls = 0;
const fastPassResult = await generateOpenAIChat({
    model: 'gpt-5.4-mini', apiKey: 'test-key', instructions: '테스트',
    messages: [new HumanMessage('서울 날씨')], useWebSearch: false, maxOutputTokens: 256,
    functionTool: {
        ...weatherFunction,
        execute: async args => {
            check('nullable 인자가 함수 실행 경계까지 전달', Array.isArray(args.cities));
            return '```json:weather\n{"city":"서울"}\n```';
        },
    },
    fetchImpl: (async () => {
        fastPassCalls++;
        return new Response(JSON.stringify({
            status: 'completed',
            output: [{ type: 'function_call', name: weatherFunction.name, call_id: 'call_weather', arguments: '{"cities":["서울"]}' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
});
check('카드 도구는 두 번째 모델 호출 없이 fast-pass',
    fastPassCalls === 1 && fastPassResult.text.includes('json:weather'));

let synthesisCalls = 0;
let synthesisInputPreserved = false;
const drugFunction = {
    intent: 'drug_info',
    name: 'search_drug_info',
    description: '약품 조회',
    parameters: {
        type: 'object',
        properties: {
            drug_name: { type: 'string' },
            query_kind: { type: 'string', enum: ['product', 'ingredient_or_class'] },
        },
        required: ['drug_name', 'query_kind'],
        additionalProperties: false,
    },
    resultMode: 'synthesize' as const,
    followupWebSearch: true,
    execute: async () => '',
};
const synthesisResult = await generateOpenAIChat({
    model: 'gpt-5.6-luna', apiKey: 'test-key', instructions: '테스트',
    messages: [new HumanMessage('우파다시티닙 알려줘')], useWebSearch: false, maxOutputTokens: 512,
    functionTool: { ...drugFunction, execute: async () => '[DRUG_DATA]\n공식 근거' },
    fetchImpl: (async (_input, init) => {
        synthesisCalls++;
        if (synthesisCalls === 1) {
            return new Response(JSON.stringify({
                status: 'completed',
                output: [
                    { type: 'reasoning', id: 'reasoning_1', summary: [] },
                    { type: 'function_call', name: drugFunction.name, call_id: 'call_drug', arguments: '{"drug_name":"우파다시티닙","query_kind":"ingredient_or_class"}' },
                ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const body = JSON.parse(String(init?.body));
        synthesisInputPreserved = body.input.some((item: any) => item.type === 'reasoning')
            && body.input.some((item: any) => item.type === 'function_call')
            && body.input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call_drug')
            && body.tools?.[0]?.type === 'web_search'
            && body.tool_choice === 'required'
            && !body.tools.some((tool: any) => tool.type === 'function')
            && body.instructions.includes('provider=OpenAI Web Search');
        return new Response(JSON.stringify({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: '근거 기반 약품 답변', annotations: [] }] }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
});
check('합성 도구는 reasoning·호출·출력을 보존해 두 번째 요청', synthesisCalls === 2 && synthesisInputPreserved);
check('합성 도구 최종 텍스트 반환', synthesisResult.text === '근거 기반 약품 답변');

let capturedAuthorization = '';
const result = await generateOpenAIChat({
    model: 'gpt-5.4-mini',
    apiKey: 'test-key',
    instructions: '테스트',
    messages: [new HumanMessage('응답해줘')],
    useWebSearch: true,
    maxOutputTokens: 1024,
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
        return new Response(JSON.stringify({
            status: 'completed',
            output: [
                { type: 'web_search_call', action: { sources: [
                    { title: '공식 문서', url: 'https://example.com/source?utm_source=openai' },
                    { title: '인용되지 않은 문서', url: 'https://example.net/consulted' },
                ] } },
                { type: 'message', content: [{
                    type: 'output_text',
                    text: '테스트 응답 ([example.com](https://example.com/source?utm_source=openai))',
                    annotations: [{
                        type: 'url_citation', title: '공식 문서',
                        url: 'https://example.com/source?utm_source=openai', start_index: 7, end_index: 72,
                    }],
                }] },
            ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
});
check('응답의 도메인 인용을 클릭 가능한 번호로 변환', result.text === '테스트 응답 [1](https://example.com/source)');
check('실제 인용 출처에 번호 메타데이터 부여',
    result.sources[0]?.title === '공식 문서'
    && result.sources[0]?.uri === 'https://example.com/source'
    && result.sources[0]?.citationNumber === 1
    && result.sources[0]?.cited === true);
check('검색했지만 인용하지 않은 출처는 기본 배지에서 제외', result.sources.length === 1);
check('서버 키가 Authorization 헤더로만 전달', capturedAuthorization === 'Bearer test-key');

const annotationOnlyText = '근거가 확인됩니다.';
const annotationOnly = normalizeOpenAIWebCitations({
    output: [{ type: 'message', content: [{ type: 'output_text', text: annotationOnlyText, annotations: [{
        type: 'url_citation', title: '근거 문서', url: 'https://example.org/evidence',
        start_index: 0, end_index: annotationOnlyText.length,
    }] }] }],
}, annotationOnlyText);
check('Markdown 링크가 없는 annotation은 범위 끝에 번호 삽입',
    annotationOnly.text === '근거가 확인됩니다. [1](https://example.org/evidence)');

let quotaError: unknown;
try {
    await generateOpenAIChat({
        model: 'gpt-5.6-luna', apiKey: 'test-key', instructions: '테스트',
        messages: [new HumanMessage('응답')], useWebSearch: false, maxOutputTokens: 100,
        fetchImpl: (async () => new Response(JSON.stringify({
            error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'quota exhausted' },
        }), { status: 429, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    });
} catch (error) { quotaError = error; }
check('OpenAI quota 코드 보존', quotaError instanceof OpenAIChatError && quotaError.status === 429 && quotaError.code === 'insufficient_quota');

// ── Gemini grounding 인용 번호화 (2026-08-24 실측: segment 오프셋은 UTF-8 바이트) ──
const koreanText = '광진동물의료센터는 24시간 진료합니다. 전화는 02-446-8175입니다.';
const firstSentence = '광진동물의료센터는 24시간 진료합니다.';
const geminiMeta = {
    groundingChunks: [
        { web: { uri: 'https://example.com/a', title: 'a.com' } },
        { web: { uri: 'https://example.com/b', title: 'b.com' } },
        { web: { uri: 'https://example.com/a', title: 'a.com' } },
    ],
    groundingSupports: [
        { segment: { endIndex: Buffer.byteLength(firstSentence, 'utf8'), text: firstSentence }, groundingChunkIndices: [0, 1] },
    ],
};
const cited = applyGeminiCitations(koreanText, geminiMeta);
check('바이트 오프셋을 문자 인덱스로 변환해 마커 삽입',
    cited.text.startsWith(firstSentence + '[1](https://example.com/a)[2](https://example.com/b)'));
check('마커를 빼면 원문이 그대로 복원됨(한글 깨짐 없음)',
    cited.text.replace(/\[\d+\]\(https?:\/\/[^)]+\)/g, '') === koreanText);
check('중복 URI는 한 번호로 합쳐짐', cited.sources.length === 2);
check('출처에 번호 부여', cited.sources[0]?.citationNumber === 1 && cited.sources[1]?.citationNumber === 2);
check('가짜 번호만 제거', stripFabricatedCitations('근거 [3] 있음 [1](https://x.test)') === '근거 있음 [1](https://x.test)');

const noSupports = applyGeminiCitations('본문 [2] 입니다', { groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'a' } }] });
check('supports 없으면 번호 없이 기존 동작', noSupports.text === '본문 입니다' && noSupports.sources[0]?.citationNumber === undefined);

const clamped = applyGeminiCitations('짧은 문장', {
    groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'a' } }],
    groundingSupports: [{ segment: { endIndex: 9999 }, groundingChunkIndices: [0] }],
});
check('범위 밖 오프셋은 문장 끝으로 클램프', clamped.text === '짧은 문장[1](https://example.com/a)');

// 실측 2026-08-24 00:20 KST: `오늘 나온 AI 뉴스`에 검색 결과 게시일(8/23)을 오늘로 답했다.
check('오늘 날짜는 주입된 시스템 시각만 근거로 삼도록 고정',
    generatorSource.includes("This is the ONLY source for today's date"));
check('자정 직후 검색 결과가 날짜를 뒤집지 못하게 명시',
    generatorSource.includes('Just after midnight most search results are from the previous day'));
check('generator가 grounding 인용 변환을 사용', generatorSource.includes('applyGeminiCitations('));
check('generator에 가짜번호 선삭제가 남아 있지 않음', !generatorSource.includes("*\\]/g, '')"));

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
