import { isOpenAIChatModel, openAIModelCapabilities } from './models';
import { withSearchProviderInstruction } from '../agent/search-provider';

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

type OpenAIChatOptions = {
    model: string;
    messages: any[];
    instructions: string;
    useWebSearch: boolean;
    maxOutputTokens: number;
    apiKey?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
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
    'model' | 'messages' | 'instructions' | 'useWebSearch' | 'maxOutputTokens'>): JsonObject => {
    const capabilities = openAIModelCapabilities(options.model);
    if (!isOpenAIChatModel(options.model) || !capabilities.chatReasoningEffort) {
        throw new OpenAIChatError(`Unsupported OpenAI chat model: ${options.model}`);
    }

    const body: JsonObject = {
        model: options.model,
        store: false,
        instructions: withSearchProviderInstruction(
            options.instructions,
            options.useWebSearch && capabilities.webSearch ? 'openai' : 'none',
        ),
        input: options.messages.map(message => {
            const role = messageRole(message);
            return { role, content: toInputContent(message, role) };
        }),
        max_output_tokens: options.maxOutputTokens,
        reasoning: { effort: capabilities.chatReasoningEffort },
    };

    if (options.useWebSearch && capabilities.webSearch) {
        body.tools = [{ type: 'web_search' }];
        body.tool_choice = 'required';
        body.include = ['web_search_call.action.sources'];
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
        const response = await (options.fetchImpl ?? fetch)(OPENAI_RESPONSES_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildOpenAIChatRequest(options)),
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
        const rawText = extractText(json);
        if (!rawText) {
            throw new OpenAIChatError('OpenAI returned empty response text', {
                status: json.status === 'incomplete' ? 503 : 502,
                code: json.incomplete_details?.reason,
            });
        }
        const normalized = normalizeOpenAIWebCitations(json, rawText);
        return { ...normalized, usage: json.usage };
    } catch (error: any) {
        if (error instanceof OpenAIChatError) throw error;
        if (error?.name === 'AbortError') throw new OpenAIChatError('OpenAI request timed out', { status: 504, code: 'timeout' });
        throw new OpenAIChatError(error?.message || 'OpenAI network request failed', { code: 'network_error' });
    } finally {
        clearTimeout(timer);
    }
}
