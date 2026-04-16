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
            const response = await fetch(targetUrl, { signal: controller.signal });
            if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
            html = await response.text();
        } finally {
            clearTimeout(timeout);
        }

        const cleanContent = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20000);

        return res.status(200).json({ content: cleanContent });
    } catch (error: any) {
        console.warn('[fetch-url] Failed:', error.message);
        return res.status(200).json({ content: `[FETCH_ERROR: ${error.message}]` });
    }
}
