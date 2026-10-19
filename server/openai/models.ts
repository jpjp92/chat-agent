/**
 * OpenAI 모델 capability 레지스트리.
 *
 * URL fetch와 추후 채팅 모델 선택이 모델 문자열/파라미터 판정을 각자 복사하지 않도록
 * 공급자별 사실을 한곳에 둔다. 검증하지 않은 모델은 자동 활성화하지 않는다.
 */

type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type OpenAIModelCapabilities = {
    webSearch: boolean;
    webSearchDomainFilters: boolean;
    reasoningEffort?: OpenAIReasoningEffort;
    chatReasoningEffort?: OpenAIReasoningEffort;
    /**
     * 웹 검색을 붙인 채팅 요청만 쓰는 effort. `none` 은 검색 1회 후 페이지를 열지 않고 답해
     * 날짜 없는 페이지를 출처로 단 채 날짜를 지어냈다(10-19 "변호사 시험" GPT-5.6 접수일 0/5 → low 3/3).
     * 함수 호출 요청은 검색과 같이 실리지 않으므로 chatReasoningEffort(none) 그대로다.
     */
    webSearchReasoningEffort?: OpenAIReasoningEffort;
    imageInput?: boolean;
};

const OPENAI_MODELS = {
    GPT_5_MINI: 'gpt-5-mini',
    GPT_5_4_MINI: 'gpt-5.4-mini',
    GPT_5_6_LUNA: 'gpt-5.6-luna',
    GPT_6_LUNA: 'gpt-6-luna',
} as const;

export const DEFAULT_OPENAI_URL_FETCH_MODEL = OPENAI_MODELS.GPT_5_MINI;

const OPENAI_MODEL_CAPS: Record<string, OpenAIModelCapabilities> = {
    // web_search 는 minimal 을 400 으로 거부한다.
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
        webSearchReasoningEffort: 'low',
        imageInput: true,
    },
    // 아래 값은 **모델 카드 기재 사항**이고 실호출로 확인하는 하니스는
    // `tests/manual/live-openai-chat-models.mts` 다.
    //   · reasoning.effort: none·low·medium(기본)·high·xhigh·max — `minimal` 은 없다
    //   · chatReasoningEffort 를 'none' 으로 두는 건 취향이 아니다. 카드가
    //     "Chat Completions supports function calling only with reasoning_effort set to none"
    //     이라고 못 박았다 — 다른 값으로 올리면 **도구 호출이 조용히 사라진다.**
    //   · 이미지 입력 지원, 오디오·영상 미지원. 컨텍스트 1,050,000 / 출력 128,000.
    [OPENAI_MODELS.GPT_6_LUNA]: {
        webSearch: true,
        webSearchDomainFilters: true,
        chatReasoningEffort: 'none',
        webSearchReasoningEffort: 'low',
        imageInput: true,
    },
};

export const openAIModelCapabilities = (model: string): OpenAIModelCapabilities =>
    OPENAI_MODEL_CAPS[model] ?? { webSearch: false, webSearchDomainFilters: false };

/**
 * 채팅으로 쓸 수 있는 OpenAI 모델.
 *
 * 선택 UI 에서 `legacy` 로 내린 모델도 **여기엔 남는다.** 내린다는 건 새로 고르기 어렵게
 * 한다는 뜻이지 못 쓰게 한다는 뜻이 아니다 — 이미 그 모델로 쓰던 세션의 `preferred_model`
 * 로컬 스토리지 값이 그대로 올라오는데, 여기서 빼면 그 사용자는 **오류를 본다.**
 */
export const isOpenAIChatModel = (
    model: string,
): model is typeof OPENAI_MODELS.GPT_5_4_MINI | typeof OPENAI_MODELS.GPT_5_6_LUNA | typeof OPENAI_MODELS.GPT_6_LUNA =>
    model === OPENAI_MODELS.GPT_5_4_MINI
    || model === OPENAI_MODELS.GPT_5_6_LUNA
    || model === OPENAI_MODELS.GPT_6_LUNA;
