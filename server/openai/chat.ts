import { isOpenAIChatModel, openAIModelCapabilities } from './models';
import { withSearchProviderInstruction } from '../agent/search-provider';
import type { LocalFunctionTool } from '../agent/local-tool-registry';
import { assertSafeFastPassOutput, cardHasResults, pinCardToProse } from '../agent/card-tool-output';
import { buildEmptyCardRules } from '../agent/card-followup';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_CHAT_TIMEOUT_MS = 60_000;

type JsonObject = Record<string, any>;

export type OpenAIChatSource = {
    title: string;
    uri: string;
    citationNumber?: number;
    cited?: boolean;
};

export type OpenAIChatResult = {
    text: string;
    sources: OpenAIChatSource[];
    usage?: unknown;
};

export type OpenAIChatOptions = {
    model: string;
    messages: any[];
    instructions: string;
    useWebSearch: boolean;
    maxOutputTokens: number;
    apiKey?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    functionTool?: LocalFunctionTool;
};

type OpenAIRequestState = {
    input?: JsonObject[];
    functionPhase?: 'initial' | 'followup';
    /**
     * 이번 요청에만 얹는 지시. 🔴 조회가 빈손일 때 "카드만 남기지 말고 답하라" 를 붙인다 —
     * 이 경로는 그래프 tool 노드를 거치지 않아 generator 의 주입이 닿지 않는다(§6.29).
     */
    extraInstructions?: string;
    followupWebSearch?: boolean;
};

export class OpenAIChatError extends Error {
    status?: number;
    code?: string;
    type?: string;

    constructor(message: string, details: { status?: number; code?: string; type?: string } = {}) {
        super(message);
        this.name = 'OpenAIChatError';
        Object.assign(this, details);
    }
}

const messageRole = (message: any): 'user' | 'assistant' =>
    message?._getType?.() === 'ai' ? 'assistant' : 'user';

const toInputContent = (message: any, role: 'user' | 'assistant'): string | JsonObject[] => {
    const value = message?.content;
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return String(value ?? '');

    const content: JsonObject[] = [];
    for (const part of value) {
        if (part?.type === 'text' || part?.type === 'input_text' || part?.type === 'output_text') {
            content.push({ type: 'input_text', text: String(part.text ?? '') });
        } else if (role === 'user' && part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
            content.push({ type: 'input_image', image_url: part.image_url.url, detail: 'auto' });
        }
    }

    // Responses API의 수동 멀티턴 공식 형식은 이전 assistant 메시지를
    // `{ role: 'assistant', content: '...' }`로 다시 전달한다. assistant에
    // input_text content part 배열을 붙이면 첫 턴은 성공해도 후속 턴이 400으로 실패할 수 있다.
    // user도 텍스트뿐이면 같은 easy-input 문자열 형식을 쓰고, 이미지를 동반할 때만 배열을 쓴다.
    const hasImage = content.some(part => part.type === 'input_image');
    if (role === 'assistant' || !hasImage) {
        return content
            .filter(part => part.type === 'input_text')
            .map(part => String(part.text ?? ''))
            .join('\n');
    }
    return content;
};

export const buildOpenAIChatRequest = (options: Pick<OpenAIChatOptions,
    'model' | 'messages' | 'instructions' | 'useWebSearch' | 'maxOutputTokens' | 'functionTool'>,
    requestState: OpenAIRequestState = {},
): JsonObject => {
    const capabilities = openAIModelCapabilities(options.model);
    if (!isOpenAIChatModel(options.model) || !capabilities.chatReasoningEffort) {
        throw new OpenAIChatError(`Unsupported OpenAI chat model: ${options.model}`);
    }

    const hostedWebSearch = capabilities.webSearch
        && (options.useWebSearch || requestState.followupWebSearch === true);
    const body: JsonObject = {
        model: options.model,
        store: false,
        instructions: withSearchProviderInstruction(
            requestState.extraInstructions
                ? `${options.instructions}\n\n${requestState.extraInstructions}`
                : options.instructions,
            hostedWebSearch ? 'openai' : 'none',
        ),
        input: requestState.input ?? options.messages.map(message => {
            const role = messageRole(message);
            return { role, content: toInputContent(message, role) };
        }),
        max_output_tokens: options.maxOutputTokens,
        reasoning: { effort: capabilities.chatReasoningEffort },
    };

    if (hostedWebSearch) {
        if (options.functionTool && requestState.functionPhase !== 'followup') {
            throw new OpenAIChatError('Hosted web search and a forced local function cannot share the same request', {
                status: 500,
                code: 'tool_policy_conflict',
            });
        }
        body.tools = [{ type: 'web_search' }];
        body.tool_choice = 'required';
        body.include = ['web_search_call.action.sources'];
    } else if (options.functionTool && requestState.functionPhase !== 'followup') {
        body.tools = [{
            type: 'function',
            name: options.functionTool.name,
            description: options.functionTool.description,
            parameters: options.functionTool.parameters,
            strict: true,
        }];
        body.tool_choice = { type: 'function', name: options.functionTool.name };
        body.parallel_tool_calls = false;
    }
    return body;
};

const extractText = (json: JsonObject): string => {
    if (typeof json.output_text === 'string') return json.output_text.trim();
    return (Array.isArray(json.output) ? json.output : [])
        .filter((item: any) => item?.type === 'message')
        .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
        .filter((part: any) => part?.type === 'output_text')
        .map((part: any) => typeof part.text === 'string' ? part.text : '')
        .join('\n')
        .trim();
};

const normalizeSourceUrl = (value: string): string => {
    try {
        const url = new URL(value);
        for (const key of [...url.searchParams.keys()]) {
            if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
        }
        url.hash = '';
        return url.toString();
    } catch {
        return value;
    }
};

type UrlCitation = OpenAIChatSource & { startIndex?: number; endIndex?: number };

const extractUrlCitations = (json: JsonObject): UrlCitation[] => {
    const citations: UrlCitation[] = [];
    for (const item of Array.isArray(json.output) ? json.output : []) {
        if (item?.type !== 'message') continue;
        for (const part of Array.isArray(item.content) ? item.content : []) {
            for (const rawAnnotation of Array.isArray(part?.annotations) ? part.annotations : []) {
                // Responses API는 url/title을 annotation 최상위에 둔다. 일부 호환 응답의
                // `{ url_citation: {...} }` 형식도 함께 받되, 화면에는 원시 annotation을 노출하지 않는다.
                const annotation = rawAnnotation?.url_citation ?? rawAnnotation;
                const rawUrl = annotation?.url;
                if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) continue;
                const uri = normalizeSourceUrl(rawUrl);
                let fallbackTitle = uri;
                try { fallbackTitle = new URL(uri).hostname; } catch {}
                citations.push({
                    title: typeof annotation?.title === 'string' && annotation.title ? annotation.title : fallbackTitle,
                    uri,
                    cited: true,
                    startIndex: Number.isInteger(annotation?.start_index) ? annotation.start_index : undefined,
                    endIndex: Number.isInteger(annotation?.end_index) ? annotation.end_index : undefined,
                });
            }
        }
    }
    return citations;
};

/** OpenAI의 도메인형 Markdown 인용을 짧은 클릭 가능 번호로 바꾼다. */
export const normalizeOpenAIWebCitations = (
    json: JsonObject,
    rawText: string,
): { text: string; sources: OpenAIChatSource[] } => {
    const citations = extractUrlCitations(json);
    const uniqueCitations = [...new Map(citations.map(source => [source.uri, source])).values()]
        .map((source, index) => ({ ...source, citationNumber: index + 1 }));

    if (uniqueCitations.length > 0) {
        const byUri = new Map(uniqueCitations.map(source => [source.uri, source]));
        const markdownLinkedUris = new Set<string>();
        const markdownLinkPattern = /\(?\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)\)?/g;
        let text = rawText.replace(markdownLinkPattern, (full, _label: string, href: string) => {
            const normalizedHref = normalizeSourceUrl(href);
            const citation = byUri.get(normalizedHref);
            if (!citation?.citationNumber) return full;
            markdownLinkedUris.add(normalizedHref);
            return `[${citation.citationNumber}](${citation.uri})`;
        });

        // 일부 Responses 응답은 링크 문자열 대신 annotation 범위만 제공한다.
        // 그런 경우에만 원문의 범위 끝에 번호 링크를 삽입한다. 기존 Markdown 링크는 위에서
        // 이미 교체했으므로 중복 번호를 만들지 않는다.
        const insertions = citations
            .filter(citation => !markdownLinkedUris.has(citation.uri) && Number.isInteger(citation.endIndex))
            .map(citation => ({
                index: citation.endIndex as number,
                source: byUri.get(citation.uri),
            }))
            .filter((item): item is { index: number; source: OpenAIChatSource & { citationNumber: number } } =>
                !!item.source?.citationNumber && item.index >= 0 && item.index <= rawText.length)
            .sort((a, b) => b.index - a.index);

        // 인덱스는 rawText 기준이다. Markdown 치환으로 길이가 바뀐 응답에는 별도 삽입을 하지
        // 않고, annotation-only 응답에서만 안전하게 사용한다.
        if (markdownLinkedUris.size === 0) {
            for (const insertion of insertions) {
                const marker = `[${insertion.source.citationNumber}](${insertion.source.uri})`;
                text = `${text.slice(0, insertion.index)} ${marker}${text.slice(insertion.index)}`;
            }
        }

        return {
            text,
            sources: uniqueCitations.map(({ startIndex: _startIndex, endIndex: _endIndex, ...source }) => source),
        };
    }

    // 검색 결과를 모델이 실제로 인용하지 않은 예외 응답에서도 검색 수행 여부와 하단 출처는
    // 보존한다. 다만 번호를 부여하지 않아 본문 인용처럼 오해시키지 않는다.
    const consulted: OpenAIChatSource[] = [];
    for (const item of Array.isArray(json.output) ? json.output : []) {
        if (item?.type !== 'web_search_call') continue;
        for (const source of Array.isArray(item.action?.sources) ? item.action.sources : []) {
            if (typeof source?.url !== 'string' || !source.url.startsWith('http')) continue;
            const uri = normalizeSourceUrl(source.url);
            let fallbackTitle = uri;
            try { fallbackTitle = new URL(uri).hostname; } catch {}
            consulted.push({
                title: typeof source.title === 'string' && source.title ? source.title : fallbackTitle,
                uri,
                cited: false,
            });
        }
    }
    return { text: rawText, sources: [...new Map(consulted.map(source => [source.uri, source])).values()] };
};

export async function generateOpenAIChat(options: OpenAIChatOptions): Promise<OpenAIChatResult> {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY_TIER1;
    if (!apiKey) throw new OpenAIChatError('OPENAI_API_KEY_TIER1 is not configured', { status: 401, code: 'key_missing' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS);
    try {
        const request = async (body: JsonObject) => {
            const response = await (options.fetchImpl ?? fetch)(OPENAI_RESPONSES_URL, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            const json = await response.json().catch(() => ({})) as JsonObject;
            if (!response.ok) {
                const detail = json?.error ?? {};
                throw new OpenAIChatError(detail.message || `OpenAI request failed (${response.status})`, {
                    status: response.status,
                    code: detail.code,
                    type: detail.type,
                });
            }
            return json;
        };

        let input = options.messages.map(message => {
            const role = messageRole(message);
            return { role, content: toInputContent(message, role) };
        });
        let json = await request(buildOpenAIChatRequest(options, {
            input,
            functionPhase: 'initial',
        }));

        let pinnedCardOutput = '';
        /** 이번 턴의 로컬 조회가 빈손이었나 — followup 요청에 규칙을 얹을지 정한다. */
        let emptyCardTurn = false;
        if (options.functionTool) {
            // Responses의 reasoning/function_call 항목도 원형 그대로 다음 input에 되돌려야 한다.
            // parallel_tool_calls=false이지만 응답 방어 차원에서 배열 전체를 처리한다.
            const calls = (Array.isArray(json.output) ? json.output : [])
                .filter((item: any) => item?.type === 'function_call');
            if (calls.length > 0) {
                const outputs: JsonObject[] = [];
                for (const call of calls) {
                    if (call.name !== options.functionTool.name || typeof call.call_id !== 'string') {
                        throw new OpenAIChatError('OpenAI requested an unavailable local function', {
                            status: 502,
                            code: 'unknown_function_call',
                        });
                    }
                    let argumentsValue: Record<string, unknown>;
                    try {
                        argumentsValue = typeof call.arguments === 'string'
                            ? JSON.parse(call.arguments)
                            : call.arguments;
                    } catch {
                        throw new OpenAIChatError('OpenAI returned invalid function arguments', {
                            status: 502,
                            code: 'invalid_function_arguments',
                        });
                    }
                    if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
                        throw new OpenAIChatError('OpenAI returned invalid function arguments', {
                            status: 502,
                            code: 'invalid_function_arguments',
                        });
                    }
                    let output: string;
                    try {
                        output = await options.functionTool.execute(argumentsValue);
                    } catch (error: any) {
                        throw new OpenAIChatError(error?.message || 'Local function execution failed', {
                            status: 502,
                            code: 'function_execution_error',
                        });
                    }
                    /**
                     * 🔴 **빈 카드는 fast-pass 하지 않는다.** 카드 펜스만 보고 돌려보내면
                     * 산문이 0줄인 막다른 길이 된다(실측: `이혼 소송 비용 얼마나 들어?` →
                     * 법령 카드만, 답변 없음). langchain-path 와 같은 결함이 이 경로에도 있었다.
                     * 비면 아래 synthesize 경로로 떨어뜨려 모델이 질문에 답하게 한다.
                     */
                    const hasResults = cardHasResults(output);
                    if (!hasResults) emptyCardTurn = true;
                    // 🔴 이 줄은 남겨 둔다. 카드 경로에서 값이 어디서 사라지는지 볼 수 있는
                    // 유일한 관측점이다 — 없앴다가 화면만 보고 세 번 헛짚었다(§6.30).
                    // (followup 산문 길이는 안 찍는다 — 빈 응답이면 아래에서 예외가 난다.)
                    console.log(`[OpenAI] local tool "${options.functionTool.name}" → ` +
                        `${output.length}자 · cardHasResults=${hasResults} · ` +
                        `${options.functionTool.resultMode === 'fast-pass' && hasResults ? 'fast-pass' : 'synthesize(빈 카드 복구)'}`);
                    if (options.functionTool.resultMode === 'fast-pass' && hasResults) {
                        try {
                            assertSafeFastPassOutput(output, options.functionTool.cardType);
                        } catch (error: any) {
                            throw new OpenAIChatError(error?.message || 'Local function returned unsafe output', {
                                status: 502,
                                code: 'invalid_function_output',
                            });
                        }
                        return { text: output, sources: [], usage: json.usage };
                    }
                    pinnedCardOutput = output;
                    outputs.push({ type: 'function_call_output', call_id: call.call_id, output });
                }

                input = [
                    ...input,
                    ...(Array.isArray(json.output) ? json.output : []),
                    ...outputs,
                ];
                // 현재 intent는 정확히 한 로컬 함수를 강제한다. 결과 종합 단계에서는 도구를
                // 다시 노출하지 않아 무한 재호출과 공급자 전환 충돌을 원천 차단한다.
                json = await request(buildOpenAIChatRequest(options, {
                    input,
                    functionPhase: 'followup',
                    extraInstructions: emptyCardTurn ? buildEmptyCardRules() : undefined,
                    followupWebSearch: options.functionTool.followupWebSearch,
                }));
            }
        }

        const rawText = extractText(json);
        if (!rawText) {
            throw new OpenAIChatError('OpenAI returned empty response text', {
                status: json.status === 'incomplete' ? 503 : 502,
                code: json.incomplete_details?.reason,
            });
        }
        const normalized = normalizeOpenAIWebCitations(json, rawText);
        // 합성 모드라도 카드가 있는 intent 는 카드를 도구 출력으로 고정한다(모델 재작성 금지).
        if (pinnedCardOutput && options.functionTool?.cardType) {
            normalized.text = pinCardToProse(normalized.text, pinnedCardOutput, options.functionTool.cardType);
        }
        return { ...normalized, usage: json.usage };
    } catch (error: any) {
        if (error instanceof OpenAIChatError) throw error;
        if (error?.name === 'AbortError') throw new OpenAIChatError('OpenAI request timed out', { status: 504, code: 'timeout' });
        throw new OpenAIChatError(error?.message || 'OpenAI network request failed', { code: 'network_error' });
    } finally {
        clearTimeout(timer);
    }
}
