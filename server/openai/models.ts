/**
 * OpenAI 모델 capability 레지스트리.
 *
 * URL fetch와 추후 채팅 모델 선택이 모델 문자열/파라미터 판정을 각자 복사하지 않도록
 * 공급자별 사실을 한곳에 둔다. 검증하지 않은 모델은 자동 활성화하지 않는다.
 */

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type OpenAIModelCapabilities = {
    webSearch: boolean;
    webSearchDomainFilters: boolean;
    reasoningEffort?: OpenAIReasoningEffort;
    chatReasoningEffort?: OpenAIReasoningEffort;
    imageInput?: boolean;
};

export const OPENAI_MODELS = {
    GPT_5_MINI: 'gpt-5-mini',
    GPT_5_4_MINI: 'gpt-5.4-mini',
    GPT_5_6_LUNA: 'gpt-5.6-luna',
} as const;

export const DEFAULT_OPENAI_URL_FETCH_MODEL = OPENAI_MODELS.GPT_5_MINI;

export const OPENAI_MODEL_CAPS: Record<string, OpenAIModelCapabilities> = {
    // 2026-08-23 TIER1 실측: web_search는 minimal을 400으로 거부한다.
    // URL fetch는 웹 검색과 함께 허용되는 최저 reasoning effort인 low를 사용한다.
    [OPENAI_MODELS.GPT_5_MINI]: {
        webSearch: true,
        webSearchDomainFilters: true,
        reasoningEffort: 'low',
    },
    [OPENAI_MODELS.GPT_5_4_MINI]: {
        webSearch: true,
        webSearchDomainFilters: true,
        chatReasoningEffort: 'none',
        imageInput: true,
    },
    [OPENAI_MODELS.GPT_5_6_LUNA]: {
        webSearch: true,
        webSearchDomainFilters: true,
        chatReasoningEffort: 'none',
        imageInput: true,
    },
};

export const openAIModelCapabilities = (model: string): OpenAIModelCapabilities =>
    OPENAI_MODEL_CAPS[model] ?? { webSearch: false, webSearchDomainFilters: false };

export const isOpenAIChatModel = (model: string): model is typeof OPENAI_MODELS.GPT_5_4_MINI | typeof OPENAI_MODELS.GPT_5_6_LUNA =>
    model === OPENAI_MODELS.GPT_5_4_MINI || model === OPENAI_MODELS.GPT_5_6_LUNA;
