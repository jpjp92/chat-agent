import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url');
    if (!url) return NextResponse.json({ error: 'Image URL is required' }, { status: 400 });

    try {
        // URL Auto-Repair
        let repairedUrl = url;
        const secondHttpsIndex = url.indexOf('https://', 8);
        if (secondHttpsIndex > -1) {
            repairedUrl = url.substring(secondHttpsIndex);
        } else if (url.includes('pstatic.net')) {
            const pstaticMatch = url.match(/((?:fdb|d)bscthumb-phinf\.pstatic\.net\/[^?\s]+|dthumb-phinf\.pstatic\.net\/[^?\s]+)/i);
            if (pstaticMatch) {
                const candidate = 'https://' + pstaticMatch[1];
                try {
                    const originalUrlObj = new URL(url);
                    if (!originalUrlObj.hostname.includes('pstatic.net')) repairedUrl = candidate;
                } catch { repairedUrl = candidate; }
            }
        }

        let finalUrl = repairedUrl;
        if (url.includes('dthumb-phinf.pstatic.net') && url.includes('src=')) {
            try {
                const urlObj = new URL(url);
                const srcParam = urlObj.searchParams.get('src');
                if (srcParam) finalUrl = decodeURIComponent(srcParam.replace(/^"|"$/g, ''));
            } catch {}
        }

        const targetUrl = new URL(finalUrl);
        const blockedHost = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i.test(targetUrl.hostname);
        if (blockedHost) return NextResponse.json({ error: 'URL not allowed' }, { status: 400 });

        let referer = targetUrl.origin + '/';
        if (targetUrl.hostname.includes('pstatic.net') || targetUrl.hostname.includes('naver.com')) {
            referer = 'https://terms.naver.com/';
        } else if (targetUrl.hostname.includes('connectdi.com')) {
            referer = 'https://www.connectdi.com/';
        } else if (targetUrl.hostname.includes('nedrug.mfds.go.kr')) {
            referer = 'https://nedrug.mfds.go.kr/';
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response: Response;
        try {
            response = await fetch(finalUrl, {
                signal: controller.signal,
                headers: {
                    Referer: referer,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch external image' }, { status: response.status });
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
            return NextResponse.json({ error: 'URL did not return an image', contentType }, { status: 422 });
        }

        const buffer = await response.arrayBuffer();
        return new Response(buffer, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, s-maxage=86400',
            },
        });
    } catch (error: any) {
        console.error('[Proxy] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
