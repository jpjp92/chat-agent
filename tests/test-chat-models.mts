/** 채팅 모델 레지스트리 + OpenAI Responses 배선 회귀 하니스. */
import fs from 'node:fs';
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
check('OpenAI 모델 배치', CHAT_MODEL_OPTIONS.filter(option => option.section === 'openai').map(option => option.id).join(',') === 'gpt-5.4-mini,gpt-5.6-luna');
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

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
