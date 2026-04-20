import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        let targetUrl = url;
        if (url.includes('arxiv.org/pdf/')) {
            targetUrl = url.replace('arxiv.org/pdf/', 'arxiv.org/abs/').replace('.pdf', '');
        }

        const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

        if (isYoutube) {
            // OEmbed: 8초 timeout
            const oembedController = new AbortController();
            const oembedTimeout = setTimeout(() => oembedController.abort(), 8000);
            let oData: any = {};
            try {
                const oRes = await fetch(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
                    { signal: oembedController.signal }
                );
                if (oRes.ok) oData = await oRes.json();
            } catch (e) {
                console.warn('[fetch-url] YouTube oembed timeout or failed');
            } finally {
                clearTimeout(oembedTimeout);
            }

            // 페이지 description: 10초 timeout
            const pageController = new AbortController();
            const pageTimeout = setTimeout(() => pageController.abort(), 10000);
            let description = "";
            try {
                const pageRes = await fetch(targetUrl, { signal: pageController.signal });
                if (pageRes.ok) {
                    const text = await pageRes.text();
                    const descMatch =
                        text.match(/<meta\s+(?:name|property)="[^"]*?description"\s+content="([^"]+)"/i) ||
                        text.match(/<meta\s+content="([^"]+)"\s+(?:name|property)="[^"]*?description"/i);
                    if (descMatch) description = descMatch[1];
                }
            } catch (e) {
                console.warn('[fetch-url] YouTube page fetch timeout or failed');
            } finally {
                clearTimeout(pageTimeout);
            }

            return res.status(200).json({
                content: `[YOUTUBE_VIDEO_INFO]\nURL: ${url}\nTitle: ${oData.title || "Unknown Title"}\nChannel: ${oData.author_name || "Unknown Channel"}\nDescription: ${description || "No description available."}`
            });
        }

        // 일반 URL: 10초 timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let html: string;
        try {
            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            });
            if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
            html = await response.text();
        } finally {
            clearTimeout(timeout);
        }

        // 메타 정보 추출 (og:title, og:description — 본문 보조용)
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
                     || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
                     || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
                     || '';
        const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
                    || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
                    || '';

        // 노이즈 제거: script, style, nav, header, footer, aside, iframe, noscript
        let cleaned = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<(nav|header|footer|aside|iframe|noscript|figure|form)[^>]*>[\s\S]*?<\/\1>/gi, '');

        // 본문 추출 우선순위: <article> → <main> → class/id 패턴 → 전체
        // <article>/<main>은 명확한 닫는 태그가 있으므로 그대로 사용.
        // div/section 기반 패턴은 중첩 div 문제로 인해 닫는 태그 매칭 대신
        // 열리는 태그 이후 전체를 가져오는 방식으로 처리.
        const semanticMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
                           || cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

        // div/section: (열리는태그)(이후 전체) — group[2]가 본문
        const divMatch = !semanticMatch && (
            cleaned.match(/(<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:article[-_](?:view[-_](?:content|body|text)|content|body|text)|post[-_](?:content|body|text)|news[-_](?:view|content|body|text)|view[-_](?:content|body|con)|read[-_](?:body|content)|content[-_](?:area|wrap|body|view))[^"']*["'][^>]*>)([\s\S]+)/i)
            || cleaned.match(/(<(?:div|section)[^>]*id=["'](?:article[-_]view|article[-_]content|article[-_]body|newsview|news[-_]view|read[-_]content)[^"']*["'][^>]*>)([\s\S]+)/i)
        );

        const bodyHtml = semanticMatch
            ? (semanticMatch[1] || semanticMatch[0])
            : divMatch
            ? divMatch[2]
            : cleaned;

        const bodyText = bodyHtml
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\[\d+\]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 15000);

        // og 메타 + 본문 조합
        let content = '';
        if (ogTitle) content += `제목: ${ogTitle.trim()}\n`;
        if (ogDesc) content += `요약: ${ogDesc.trim()}\n\n`;
        content += bodyText;

        return res.status(200).json({ content: content.trim().slice(0, 17000) });
    } catch (error: any) {
        console.warn('[fetch-url] Failed:', error.message);
        return res.status(200).json({ content: `[FETCH_ERROR: ${error.message}]` });
    }
}
