import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. URL 쿼리 파라미터 확인
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Image URL is required' });
    }

    try {
        console.log(`[Proxy] original url: ${url}`);

        // 1. URL Auto-Repair (Hallucination Fix)
        let repairedUrl = url;

        // CASE A: https://health.kr/https://pstatic.net/... (Double HTTPS)
        const secondHttpsIndex = url.indexOf('https://', 8);
        if (secondHttpsIndex > -1) {
            repairedUrl = url.substring(secondHttpsIndex);
            console.log(`[Proxy] Repaired double-HTTPS hybrid URL: ${repairedUrl}`);
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
                        console.log(`[Proxy] Repaired nested-domain hybrid URL: ${repairedUrl}`);
                    }
                } catch (e) {
                    repairedUrl = candidate; // If original is too mangled to parse as URL
                }
            }
        }

        console.log(`[Proxy] Final target URL: ${repairedUrl}`);

        // 2. Naver dthumb-phinf 처리 (중첩된 src 추출)
        let finalUrl = repairedUrl;
        if (url.includes('dthumb-phinf.pstatic.net') && url.includes('src=')) {
            try {
                const urlObj = new URL(url);
                const srcParam = urlObj.searchParams.get('src');
                if (srcParam) {
                    const cleanedSrc = srcParam.replace(/^"|"$/g, '');
                    finalUrl = decodeURIComponent(cleanedSrc);
                    console.log(`[Proxy] Extracted nested Naver image URL: ${finalUrl}`);
                }
            } catch (pErr) {
                console.warn(`[Proxy] Failed to parse nested Naver URL, using original:`, pErr);
            }
        }

        const targetUrl = new URL(finalUrl);
        let referer = targetUrl.origin + '/';

        // 네이버 지식백과 및 ConnectDI의 경우 적절한 Referer 요구됨
        if (targetUrl.hostname.includes('pstatic.net') || targetUrl.hostname.includes('naver.com')) {
            referer = 'https://terms.naver.com/';
        } else if (targetUrl.hostname.includes('connectdi.com')) {
            referer = 'https://www.connectdi.com/';
        }

        // 3. 외부 이미지 요청 (차단 우회)
        const response = await fetch(finalUrl, {
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            console.error(`[Proxy] Failed to fetch image: ${response.status} ${response.statusText}`);
            return res.status(response.status).json({ error: 'Failed to fetch external image' });
        }

        // 3. 컨텐츠 타입 확인 및 전송
        const contentType = response.headers.get('content-type') || 'image/jpeg';
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
