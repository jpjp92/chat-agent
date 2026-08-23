export type SearchProvider = 'google' | 'openai' | 'none';

export type SearchProviderProfile = {
    provider: SearchProvider;
    label: string;
    toolName: string;
};

export const SEARCH_PROVIDER_PROFILES: Record<SearchProvider, SearchProviderProfile> = {
    google: { provider: 'google', label: 'Google Search', toolName: 'googleSearch' },
    openai: { provider: 'openai', label: 'OpenAI Web Search', toolName: 'web_search' },
    none: { provider: 'none', label: 'None', toolName: 'none' },
};

/**
 * The system prompt is shared by Gemini and OpenAI, but their hosted search tools
 * have different runtime names. Inject the tool that is actually declared for this
 * request so the model never assumes a Google-only tool on an OpenAI turn.
 */
export const buildSearchProviderInstruction = (provider: SearchProvider): string => {
    const profile = SEARCH_PROVIDER_PROFILES[provider];
    const enabled = provider !== 'none';

    return `[ACTIVE_WEB_SEARCH]
enabled=${enabled}
provider=${profile.label}
tool=${profile.toolName}
${enabled
        ? `- The runtime has declared the ${profile.toolName} hosted search capability for this response.
- Use web-derived claims and citations only when that capability actually returns search results.
- Never print or simulate tool-call syntax; use the declared capability through the API.`
        : `- No hosted web search capability is declared for this response.
- Do not claim that a live search occurred and do not fabricate citations, source URLs, or search results.`}
[/ACTIVE_WEB_SEARCH]`;
};

export const withSearchProviderInstruction = (
    instruction: string,
    provider: SearchProvider,
): string => `${instruction}\n\n${buildSearchProviderInstruction(provider)}`;
