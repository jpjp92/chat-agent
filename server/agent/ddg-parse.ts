/**
 * DuckDuckGo HTML 결과 파서 — **순수 함수**(네트워크·`server-only` 없음). 하니스가 실제 응답 조각을
 * 픽스처로 고정해 DDG 마크업 변화를 잡는다(`tests/test-ddg-parse.mts`).
 *
 * **속성 순서를 가정하지 않고**(`<a rel="nofollow" class="result__a" href="…">` 등),
 * `uddg=` 리디렉션과 직접 href 를 **둘 다** 받는다. URL 추출이 0건이면 근거를 요구하는 호출부는
 * 결과를 버리고, 그렇지 않은 호출부는 출처 없이 답하게 된다 → DEV_260818
 */

type DdgResult = { title: string; url: string; snippet: string };

const decode = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
     .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');

const stripTags = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** `uddg=` 리디렉션이면 실제 URL 을 꺼내고, 아니면 그대로 쓴다. */
export const resolveDdgHref = (raw: string): string => {
    const href = decode(raw);
    try {
        const base = href.startsWith('http') ? href : 'https:' + (href.startsWith('//') ? href : '//duckduckgo.com' + href);
        const uddg = new URL(base).searchParams.get('uddg');
        if (uddg) return decodeURIComponent(uddg);
        return base.startsWith('http') ? base : href;
    } catch {
        return href;
    }
};

/**
 * 결과 블록을 순서대로 뽑는다. 제목/URL 과 스니펫은 **같은 순번끼리** 짝짓는다 —
 * 근접 정규식으로 묶으면 DDG 가 사이에 요소를 넣을 때마다 깨진다.
 */
export const parseDdgHtml = (html: string, limit = 4): DdgResult[] => {
    const anchors: { title: string; url: string }[] = [];
    // 속성 순서를 가정하지 않는다 — 태그 전체를 잡고 안에서 class·href 를 따로 읽는다
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        const attrs = m[1];
        if (!/class="[^"]*\bresult__a\b/.test(attrs)) continue;
        const href = attrs.match(/href="([^"]+)"/)?.[1];
        if (!href) continue;
        const url = resolveDdgHref(href);
        if (!url.startsWith('http')) continue;
        if (anchors.some(a => a.url === url)) continue;
        anchors.push({ title: stripTags(m[2]) || url, url });
    }

    const snippets: string[] = [];
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        if (!/class="[^"]*\bresult__snippet\b/.test(m[1])) continue;
        snippets.push(stripTags(m[2]));
    }

    return anchors.slice(0, limit).map((a, i) => ({ ...a, snippet: snippets[i] ?? '' }));
};

/** 모델에 넘길 텍스트. 출처 URL 을 **본문과 같이** 준다 — 인용을 강제하려면 붙어 있어야 한다. */
export const formatDdgResults = (query: string, results: DdgResult[]): string => {
    if (results.length === 0) return `웹 검색 결과가 없습니다. 질의: ${query}`;
    const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`).join('\n\n');
    const urls = results.map(r => `${r.url} | ${r.title}`).join('\n');
    return `[WEB_SEARCH_RESULTS for "${query}"]\n${body}\n\n[WEB_SOURCE_URLS]\n${urls}`;
};
