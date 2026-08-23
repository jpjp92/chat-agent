import {
    DEFAULT_OPENAI_URL_FETCH_MODEL,
    openAIModelCapabilities,
} from './models';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_URL_FETCH_TIMEOUT_MS = 45000;
const OPENAI_URL_FETCH_MAX_OUTPUT_TOKENS = 6000;
const OPENAI_FETCH_FAILED_TOKEN = 'OPENAI_WEB_FETCH_FAILED';
const MIN_CONTENT_CHARS = 300;
const MAX_CONTENT_CHARS = 17000;

const OPENAI_URL_FALLBACK_HOSTS = ['wikidocs.net', 'brunch.co.kr'] as const;
const SECURITY_PATTERNS = [
    'just a moment',
    'verifying you are not a bot',
    'performing security verification',
    'sorry, you have been blocked',
    'cloudflare ray id',
    'warning: this page maybe requiring captcha',
    'verify you are human',
];

export type OpenAIUrlFetchFailureReason =
    | 'host_not_allowed'
    | 'key_missing'
    | 'unsupported_model'
    | 'auth'
    | 'quota'
    | 'rate_limit'
    | 'timeout'
    | 'network'
    | 'http_error'
    | 'incomplete'
    | 'web_search_failed'
    | 'empty_content'
    | 'security_block'
    | 'url_mismatch';

export type OpenAIUrlFetchResult = {
    content: string | null;
    reason?: OpenAIUrlFetchFailureReason;
    status?: number;
    model: string;
    elapsedMs: number;
    exactUrlEvidence: boolean;
    textChars: number;
    usage?: unknown;
    errorCode?: string;
    errorType?: string;
    errorMessage?: string;
};

type FetchOptions = {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
};

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const isOpenAIUrlFallbackHost = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase();
    return OPENAI_URL_FALLBACK_HOSTS.some(host => normalized === host || normalized.endsWith(`.${host}`));
};

export const normalizeOpenAIEvidenceUrl = (value: string): string => {
    try {
        const url = new URL(value);
        url.hash = '';
        url.pathname = decodeURIComponent(url.pathname);
        for (const key of [...url.searchParams.keys()]) {
            if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
        }
        url.searchParams.sort();
        if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString();
    } catch {
        return '';
    }
};

const responseOutputText = (json: JsonObject): string => {
    const shortcut = asString(json.output_text);
    if (shortcut) return shortcut.trim();

    return asArray(json.output)
        .map(asObject)
        .filter((item): item is JsonObject => item?.type === 'message')
        .flatMap(item => asArray(item.content))
        .map(asObject)
        .filter((part): part is JsonObject => part?.type === 'output_text')
        .map(part => asString(part.text) ?? '')
        .join('\n')
        .trim();
};

const responseEvidence = (json: JsonObject) => {
    const output = asArray(json.output).map(asObject).filter((item): item is JsonObject => Boolean(item));
    const webSearchCalls = output.filter(item => item.type === 'web_search_call');
    const completed = webSearchCalls.some(item => item.status === 'completed');
    const urls: string[] = [];

    for (const item of webSearchCalls) {
        const action = asObject(item.action);
        const actionUrl = asString(action?.url);
        if (actionUrl) urls.push(actionUrl);
        for (const sourceValue of asArray(action?.sources)) {
            const sourceUrl = asString(asObject(sourceValue)?.url);
            if (sourceUrl) urls.push(sourceUrl);
        }
    }

    for (const item of output.filter(value => value.type === 'message')) {
        for (const contentValue of asArray(item.content)) {
            const content = asObject(contentValue);
            for (const annotationValue of asArray(content?.annotations)) {
                const annotationUrl = asString(asObject(annotationValue)?.url);
                if (annotationUrl) urls.push(annotationUrl);
            }
        }
    }

    return { completed, urls: [...new Set(urls)] };
};

const classifyHttpFailure = (status: number, json: JsonObject): OpenAIUrlFetchFailureReason => {
    if (status === 401 || status === 403) return 'auth';
    if (status === 402) return 'quota';
    if (status === 429) {
        const error = asObject(json.error);
        const detail = `${asString(error?.code) ?? ''} ${asString(error?.type) ?? ''} ${asString(error?.message) ?? ''}`.toLowerCase();
        return /quota|billing|credit/.test(detail) ? 'quota' : 'rate_limit';
    }
    return 'http_error';
};

const failure = (
    started: number,
    model: string,
    reason: OpenAIUrlFetchFailureReason,
    extra: Partial<OpenAIUrlFetchResult> = {},
): OpenAIUrlFetchResult => ({
    content: null,
    reason,
    model,
    elapsedMs: Date.now() - started,
    exactUrlEvidence: false,
    textChars: 0,
    ...extra,
});

export async function fetchUrlContentWithOpenAI(
    targetUrl: string,
    options: FetchOptions = {},
): Promise<OpenAIUrlFetchResult> {
    const started = Date.now();
    const model = options.model || process.env.OPENAI_URL_FETCH_MODEL || DEFAULT_OPENAI_URL_FETCH_MODEL;
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY_TIER1;
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? OPENAI_URL_FETCH_TIMEOUT_MS;

    let target: URL;
    try {
        target = new URL(targetUrl);
    } catch {
        return failure(started, model, 'host_not_allowed');
    }
    const hostname = target.hostname.toLowerCase();
    if (target.protocol !== 'https:' || !isOpenAIUrlFallbackHost(hostname)) {
        return failure(started, model, 'host_not_allowed');
    }
    if (!apiKey) return failure(started, model, 'key_missing');

    const capabilities = openAIModelCapabilities(model);
    if (!capabilities.webSearch || !capabilities.webSearchDomainFilters || !capabilities.reasoningEffort) {
        return failure(started, model, 'unsupported_model');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(OPENAI_RESPONSES_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                store: false,
                tools: [{
                    type: 'web_search',
                    filters: { allowed_domains: [hostname] },
                }],
                tool_choice: 'required',
                max_tool_calls: 1,
                max_output_tokens: OPENAI_URL_FETCH_MAX_OUTPUT_TOKENS,
                reasoning: { effort: capabilities.reasoningEffort },
                include: ['web_search_call.action.sources'],
                input: [
                    `Retrieve this exact URL: ${targetUrl}`,
                    'Do not substitute a similarly titled page, search result, or another URL.',
                    `If the exact URL cannot be retrieved, answer exactly: ${OPENAI_FETCH_FAILED_TOKEN}`,
                    'Return only the page title and its substantive content as clean Markdown.',
                    'Preserve headings, paragraphs, lists, tables, links, and code when present.',
                    'Exclude navigation, advertisements, cookie notices, and your own commentary. Do not summarize.',
                ].join('\n'),
            }),
        });

        let json: JsonObject = {};
        try {
            json = asObject(await response.json()) ?? {};
        } catch {
            // Non-JSON provider failures are handled by status below.
        }
        const error = asObject(json.error);
        const errorCode = asString(error?.code);
        const errorType = asString(error?.type);
        const errorMessage = asString(error?.message);
        if (!response.ok) {
            return failure(started, model, classifyHttpFailure(response.status, json), {
                status: response.status,
                errorCode,
                errorType,
                errorMessage,
            });
        }
        if (json.status !== 'completed') {
            return failure(started, model, 'incomplete', { status: response.status, usage: json.usage });
        }

        const text = responseOutputText(json);
        const evidence = responseEvidence(json);
        const requestedUrl = normalizeOpenAIEvidenceUrl(targetUrl);
        const exactUrlEvidence = evidence.urls.some(url => normalizeOpenAIEvidenceUrl(url) === requestedUrl);
        const securityBlock = SECURITY_PATTERNS.some(pattern => text.toLowerCase().includes(pattern));

        if (!evidence.completed) return failure(started, model, 'web_search_failed', { status: response.status, usage: json.usage });
        if (!text || text.includes(OPENAI_FETCH_FAILED_TOKEN) || text.length < MIN_CONTENT_CHARS) {
            return failure(started, model, 'empty_content', { status: response.status, usage: json.usage, textChars: text.length });
        }
        if (securityBlock) return failure(started, model, 'security_block', { status: response.status, usage: json.usage, textChars: text.length });
        if (!exactUrlEvidence) return failure(started, model, 'url_mismatch', { status: response.status, usage: json.usage, textChars: text.length });

        const content = text.slice(0, MAX_CONTENT_CHARS);
        return {
            content,
            status: response.status,
            model,
            elapsedMs: Date.now() - started,
            exactUrlEvidence: true,
            textChars: content.length,
            usage: json.usage,
        };
    } catch (error: unknown) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        return failure(started, model, isAbort ? 'timeout' : 'network');
    } finally {
        clearTimeout(timer);
    }
}
