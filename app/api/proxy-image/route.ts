import { NextRequest, NextResponse } from 'next/server';
import { BROWSER_UA } from '../../../server/browser-ua';
import { assertPublicUrl, safeFetch } from '../../../server/ssrf';

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
        // 내부 주소 차단 — 리다이렉트 대상까지 safeFetch 가 hop 마다 다시 검사한다(server/ssrf.ts).
        try { await assertPublicUrl(targetUrl); }
        catch { return NextResponse.json({ error: 'URL not allowed' }, { status: 400 }); }

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
            response = await safeFetch(finalUrl, {
                signal: controller.signal,
                headers: {
                    Referer: referer,
                    'User-Agent': BROWSER_UA,
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
