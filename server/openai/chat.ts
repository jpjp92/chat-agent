import { isOpenAIChatModel, openAIModelCapabilities } from './models';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_CHAT_TIMEOUT_MS = 60_000;

type JsonObject = Record<string, any>;

export type OpenAIChatSource = { title: string; uri: string };

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

const toInputContent = (message: any): JsonObject[] => {
    const value = message?.content;
    if (typeof value === 'string') return [{ type: 'input_text', text: value }];
    if (!Array.isArray(value)) return [{ type: 'input_text', text: String(value ?? '') }];

    const content: JsonObject[] = [];
    for (const part of value) {
        if (part?.type === 'text') {
            content.push({ type: 'input_text', text: String(part.text ?? '') });
        } else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
            content.push({ type: 'input_image', image_url: part.image_url.url, detail: 'auto' });
        }
    }
    return content.length > 0 ? content : [{ type: 'input_text', text: '' }];
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
        instructions: options.instructions,
        input: options.messages.map(message => ({
            role: messageRole(message),
            content: toInputContent(message),
        })),
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

const extractSources = (json: JsonObject): OpenAIChatSource[] => {
    const sources: OpenAIChatSource[] = [];
    const add = (url: unknown, title: unknown) => {
        if (typeof url !== 'string' || !url.startsWith('http')) return;
        sources.push({ title: typeof title === 'string' && title ? title : new URL(url).hostname, uri: url });
    };

    for (const item of Array.isArray(json.output) ? json.output : []) {
        if (item?.type === 'web_search_call') {
            for (const source of Array.isArray(item.action?.sources) ? item.action.sources : []) {
                add(source?.url, source?.title);
            }
        }
        if (item?.type === 'message') {
            for (const part of Array.isArray(item.content) ? item.content : []) {
                for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
                    add(annotation?.url, annotation?.title);
                }
            }
        }
    }
    return [...new Map(sources.map(source => [source.uri, source])).values()];
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
        const text = extractText(json);
        if (!text) {
            throw new OpenAIChatError('OpenAI returned empty response text', {
                status: json.status === 'incomplete' ? 503 : 502,
                code: json.incomplete_details?.reason,
            });
        }
        return { text, sources: extractSources(json), usage: json.usage };
    } catch (error: any) {
        if (error instanceof OpenAIChatError) throw error;
        if (error?.name === 'AbortError') throw new OpenAIChatError('OpenAI request timed out', { status: 504, code: 'timeout' });
        throw new OpenAIChatError(error?.message || 'OpenAI network request failed', { code: 'network_error' });
    } finally {
        clearTimeout(timer);
    }
}
