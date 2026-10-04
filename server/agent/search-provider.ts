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
/**
 * 🔴 OpenAI web_search 는 순위 질문을 웹이 아니라 내부 스포츠 API(`oai-sports`)로 푼다(2026-10-04 직접 호출로 확인).
 *    그 데이터는 **승·패만** 있어 축구의 무승부가 사라지고(브렌트퍼드 2승3무 → "2승 0패"), 출처가 URL 이 아니라
 *    (`{type:'api'}`) 출처 칩도 안 붙는다. 스포츠 매체 페이지를 찾게 하면 3회 중 2회 전체 표 + 웹 출처가 나왔다.
 *    Gemini 는 google_search 가 웹 페이지를 주므로 해당 없음 — OpenAI 에만 붙인다.
 */
const OPENAI_SPORTS_STANDINGS_RULE = `- League standings: a win-loss-only sports data feed is incomplete (football has draws). Search sports media pages (BBC Sport, ESPN, Sky Sports, livesport, flashscore) for the current full table and answer as a Markdown table with played, won, drawn, lost, goal difference and points, citing those pages. Never present a win-loss-only table.`;

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
- Never print or simulate tool-call syntax; use the declared capability through the API.${provider === 'openai' ? `\n${OPENAI_SPORTS_STANDINGS_RULE}` : ''}`
        : `- No hosted web search capability is declared for this response.
- Do not claim that a live search occurred and do not fabricate citations, source URLs, or search results.`}
[/ACTIVE_WEB_SEARCH]`;
};

export const withSearchProviderInstruction = (
    instruction: string,
    provider: SearchProvider,
): string => `${instruction}\n\n${buildSearchProviderInstruction(provider)}`;
