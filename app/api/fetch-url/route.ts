import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SSRF_BLOCK = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i;

const isJinaSecurityBlock = (text: string) => {
    const t = text.toLowerCase();
    return t.includes('just a moment') || t.includes('performing security verification') ||
        t.includes('security service to protect') || t.includes('warning: target url returned error 403') ||
        t.includes('warning: this page maybe requiring captcha') ||
        t.includes('verifying you are not a bot') || t.includes('please enable cookies');
};

export async function POST(req: NextRequest) {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    try {
        const { hostname } = new URL(url);
        if (SSRF_BLOCK.test(hostname)) return NextResponse.json({ error: 'URL not allowed' }, { status: 400 });
    } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    try {
        let targetUrl = url;
        if (url.includes('arxiv.org/pdf/')) {
            targetUrl = url.replace('arxiv.org/pdf/', 'arxiv.org/abs/').replace('.pdf', '');
        }

        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const oembedCtrl = new AbortController();
            const pageCtrl = new AbortController();
            const t1 = setTimeout(() => oembedCtrl.abort(), 8000);
            const t2 = setTimeout(() => pageCtrl.abort(), 10000);

            const [oembedResult, pageResult] = await Promise.allSettled([
                fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: oembedCtrl.signal }),
                fetch(targetUrl, { signal: pageCtrl.signal }),
            ]);
            clearTimeout(t1); clearTimeout(t2);

            let oData: any = {};
            if (oembedResult.status === 'fulfilled' && oembedResult.value.ok) {
                try { oData = await oembedResult.value.json(); } catch {}
            }
            let description = '';
            if (pageResult.status === 'fulfilled' && pageResult.value.ok) {
                try {
                    const text = await pageResult.value.text();
                    const m = text.match(/<meta\s+(?:name|property)="[^"]*?description"\s+content="([^"]+)"/i) ||
                               text.match(/<meta\s+content="([^"]+)"\s+(?:name|property)="[^"]*?description"/i);
                    if (m) description = m[1];
                } catch {}
            }
            return NextResponse.json({
                content: `[YOUTUBE_VIDEO_INFO]\nURL: ${url}\nTitle: ${oData.title || 'Unknown Title'}\nChannel: ${oData.author_name || 'Unknown Channel'}\nDescription: ${description || 'No description available.'}`
            });
        }

        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        let html = '';
        let directFetchBlocked = false;
        try {
            const response = await fetch(targetUrl, {
                signal: ctrl.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                },
            });
            html = await response.text();
            if (!response.ok || html.match(/<title[^>]*>\s*just a moment/i)) directFetchBlocked = true;
        } catch (e: any) {
            directFetchBlocked = true;
        } finally {
            clearTimeout(t);
        }

        const jinaFetch = async () => {
            const jCtrl = new AbortController();
            const jt = setTimeout(() => jCtrl.abort(), 20000);
            try {
                const res = await fetch(`https://r.jina.ai/${targetUrl}`, { signal: jCtrl.signal, headers: { Accept: 'text/plain, text/markdown, */*' } });
                const text = await res.text();
                if (res.ok && text.trim().length >= 100) {
                    if (isJinaSecurityBlock(text)) return null;
                    return text.replace(/\s+/g, ' ').trim().slice(0, 17000);
                }
                return null;
            } catch { return null; } finally { clearTimeout(jt); }
        };

        if (directFetchBlocked) {
            const jinaText = await jinaFetch();
            if (jinaText) return NextResponse.json({ content: jinaText });
            return NextResponse.json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' }, { status: 502 });
        }

        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
        const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';

        let cleaned = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<(nav|header|footer|aside|iframe|noscript|figure|form)[^>]*>[\s\S]*?<\/\1>/gi, '');

        const semanticMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        const divMatch = !semanticMatch && (
            cleaned.match(/(<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:article[-_](?:view[-_](?:content|body|text)|content|body|text)|post[-_](?:content|body|text)|news[-_](?:view|content|body|text)|view[-_](?:content|body|con)|read[-_](?:body|content)|content[-_](?:area|wrap|body|view))[^"']*["'][^>]*>)([\s\S]+)/i)
        );
        const bodyHtml = semanticMatch ? (semanticMatch[1] || semanticMatch[0]) : divMatch ? divMatch[2] : cleaned;
        const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 15000);

        if (bodyText.length < 300) {
            const jinaText = await jinaFetch();
            if (jinaText) return NextResponse.json({ content: jinaText });
        }

        let content = '';
        if (ogTitle) content += `제목: ${ogTitle.trim()}\n`;
        if (ogDesc) content += `요약: ${ogDesc.trim()}\n\n`;
        content += bodyText;

        if (!content.trim()) return NextResponse.json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' }, { status: 502 });
        return NextResponse.json({ content: content.trim().slice(0, 17000) });
    } catch (error: any) {
        return NextResponse.json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' }, { status: 502 });
    }
}
