import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. URL 쿼리 파라미터 확인
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Image URL is required' });
    }

    try {
        // 1. URL Auto-Repair (Hallucination Fix)
        let repairedUrl = url;

        // CASE A: https://health.kr/https://pstatic.net/... (Double HTTPS)
        const secondHttpsIndex = url.indexOf('https://', 8);
        if (secondHttpsIndex > -1) {
            repairedUrl = url.substring(secondHttpsIndex);
        }
        // CASE B: https://health.kr/images/dthumb-phinf.pstatic.net/... (Nested domain without second protocol)
        else if (url.includes('pstatic.net')) {
            const pstaticMatch = url.match(/((?:fdb|d)bscthumb-phinf\.pstatic\.net\/[^?\s]+|dthumb-phinf\.pstatic\.net\/[^?\s]+)/i);
            if (pstaticMatch) {
                const candidate = 'https://' + pstaticMatch[1];
                try {
                    const originalUrlObj = new URL(url);
                    if (!originalUrlObj.hostname.includes('pstatic.net')) {
                        repairedUrl = candidate;
                    }
                } catch (e) {
                    repairedUrl = candidate; // If original is too mangled to parse as URL
                }
            }
        }

        // 2. Naver dthumb-phinf 처리 (중첩된 src 추출)
        let finalUrl = repairedUrl;
        if (url.includes('dthumb-phinf.pstatic.net') && url.includes('src=')) {
            try {
                const urlObj = new URL(url);
                const srcParam = urlObj.searchParams.get('src');
                if (srcParam) {
                    const cleanedSrc = srcParam.replace(/^"|"$/g, '');
                    finalUrl = decodeURIComponent(cleanedSrc);
                }
            } catch (pErr) {
                // Failed to parse nested Naver URL, using original
            }
        }

        const targetUrl = new URL(finalUrl);

        // Block SSRF: localhost, loopback, private ranges, AWS/GCP metadata, link-local, IPv6 private
        const blockedHost = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i.test(targetUrl.hostname);
        if (blockedHost) return res.status(400).json({ error: 'URL not allowed' });

        let referer = targetUrl.origin + '/';

        // 네이버 지식백과 및 ConnectDI의 경우 적절한 Referer 요구됨
        if (targetUrl.hostname.includes('pstatic.net') || targetUrl.hostname.includes('naver.com')) {
            referer = 'https://terms.naver.com/';
        } else if (targetUrl.hostname.includes('connectdi.com')) {
            referer = 'https://www.connectdi.com/';
        } else if (targetUrl.hostname.includes('nedrug.mfds.go.kr')) {
            referer = 'https://nedrug.mfds.go.kr/';
        }

        // 3. 외부 이미지 요청 (차단 우회, 10s timeout)
        const proxyController = new AbortController();
        const proxyTimeout = setTimeout(() => proxyController.abort(), 10000);
        let response: Response;
        try {
            response = await fetch(finalUrl, {
                signal: proxyController.signal,
                headers: {
                    'Referer': referer,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
        } finally {
            clearTimeout(proxyTimeout);
        }

        if (!response.ok) {
            console.error(`[Proxy] Failed to fetch image: ${response.status} ${response.statusText}`);
            return res.status(response.status).json({ error: 'Failed to fetch external image' });
        }

        // 3. 컨텐츠 타입 확인 — 이미지가 아니면 거부 (HTML 점검 페이지 차단)
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
            console.error(`[Proxy] Non-image content-type: ${contentType} from ${finalUrl}`);
            return res.status(422).json({ error: 'URL did not return an image', contentType });
        }
        const buffer = await response.arrayBuffer();

        // 브라우저 캐싱 허용 (성능 최적화)
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.setHeader('Content-Type', contentType);

        return res.status(200).send(Buffer.from(buffer));

    } catch (error: any) {
        console.error(`[Proxy] Error:`, error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
