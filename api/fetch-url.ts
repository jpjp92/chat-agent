import { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEYS = [
    process.env.API_KEY,
    process.env.API_KEY2,
    process.env.API_KEY3,
    process.env.API_KEY4,
    process.env.API_KEY5,
].filter(Boolean) as string[];

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
            // First try to get OEmbed for basic info
            const oRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
            let oData: any = {};
            if (oRes.ok) oData = await oRes.json();

            // Next, try to get the page description from raw HTML with more robust regex
            const pageRes = await fetch(targetUrl);
            let description = "";
            if (pageRes.ok) {
                const text = await pageRes.text();
                // Match both name="description" and property="og:description"
                const descMatch = text.match(/<meta\s+(?:name|property)="[^"]*?description"\s+content="([^"]+)"/i) ||
                                 text.match(/<meta\s+content="([^"]+)"\s+(?:name|property)="[^"]*?description"/i);
                if (descMatch) description = descMatch[1];
            }

            return res.status(200).json({
                content: `[YOUTUBE_VIDEO_INFO]\nURL: ${url}\nTitle: ${oData.title || "Unknown Title"}\nChannel: ${oData.author_name || "Unknown Channel"}\nDescription: ${description || "No description available."}`
            });
        }

        const response = await fetch(targetUrl);
        if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);

        const html = await response.text();
        // Since we are in a serverless function, we don't have DOMParser.
        // We'll return the raw text cleaned of scripts/styles using regex or just the whole thing for the model.
        // For simplicity and to let the model handle it:
        const cleanContent = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20000);

        return res.status(200).json({ content: cleanContent });
    } catch (error: any) {
        return res.status(200).json({ content: `[FETCH_ERROR: ${error.message}]` });
    }
}
