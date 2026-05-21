import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Block requests to private/metadata IP ranges to prevent SSRF
    // Covers: localhost, loopback, AWS/GCP metadata server, link-local
    // Note: redirect-based bypass is a known limitation of hostname-only checks
    try {
        const { hostname } = new URL(url);
        const blocked = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i.test(hostname);
        if (blocked) return res.status(400).json({ error: 'URL not allowed' });
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        let targetUrl = url;
        if (url.includes('arxiv.org/pdf/')) {
            targetUrl = url.replace('arxiv.org/pdf/', 'arxiv.org/abs/').replace('.pdf', '');
        }

        const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

        if (isYoutube) {
            // OEmbed + 페이지 description 병렬 fetch
            // allSettled: 한쪽 실패해도 다른 쪽 결과 유지 (독립 폴백)
            const oembedController = new AbortController();
            const pageController = new AbortController();
            const oembedTimeout = setTimeout(() => oembedController.abort(), 8000);
            const pageTimeout = setTimeout(() => pageController.abort(), 10000);

            const [oembedResult, pageResult] = await Promise.allSettled([
                fetch(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
                    { signal: oembedController.signal }
                ),
                fetch(targetUrl, { signal: pageController.signal }),
            ]);
            clearTimeout(oembedTimeout);
            clearTimeout(pageTimeout);

            let oData: any = {};
            if (oembedResult.status === 'fulfilled' && oembedResult.value.ok) {
                try { oData = await oembedResult.value.json(); } catch {}
            } else {
                console.warn('[fetch-url] YouTube oembed timeout or failed');
            }

            let description = "";
            if (pageResult.status === 'fulfilled' && pageResult.value.ok) {
                try {
                    const text = await pageResult.value.text();
                    const descMatch =
                        text.match(/<meta\s+(?:name|property)="[^"]*?description"\s+content="([^"]+)"/i) ||
                        text.match(/<meta\s+content="([^"]+)"\s+(?:name|property)="[^"]*?description"/i);
                    if (descMatch) description = descMatch[1];
                } catch {}
            } else {
                console.warn('[fetch-url] YouTube page fetch timeout or failed');
            }

            return res.status(200).json({
                content: `[YOUTUBE_VIDEO_INFO]\nURL: ${url}\nTitle: ${oData.title || "Unknown Title"}\nChannel: ${oData.author_name || "Unknown Channel"}\nDescription: ${description || "No description available."}`
            });
        }

        // 일반 URL: 10초 timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let html = '';
        let directFetchBlocked = false;
        try {
            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                }
            });
            html = await response.text();
            // Cloudflare challenge 감지: 403 또는 <title>Just a moment...</title>
            // 다른 패턴(cf-chl, challenge-platform 등)은 정상 사이트에서 오탐 가능하여 제외.
            if (!response.ok || html.match(/<title[^>]*>\s*just a moment/i)) {
                directFetchBlocked = true;
            }
        } catch (fetchError: any) {
            // 네트워크 오류·타임아웃 등 fetch 자체 실패 → Jina 폴백 경로로 진입
            console.warn('[fetch-url] Direct fetch threw:', fetchError.message);
            directFetchBlocked = true;
        } finally {
            clearTimeout(timeout);
        }

        // Jina Reader 응답에 보안 챌린지 페이지 여부 감지
        // Jina가 200으로 응답해도 내부 콘텐츠가 Cloudflare/CAPTCHA 페이지일 수 있음
        const isJinaSecurityBlock = (text: string): boolean => {
            const t = text.toLowerCase();
            return (
                t.includes('just a moment') ||
                t.includes('performing security verification') ||
                t.includes('security service to protect') ||
                t.includes('warning: target url returned error 403') ||
                t.includes('warning: this page maybe requiring captcha') ||
                t.includes('verifying you are not a bot') ||
                t.includes('please enable cookies')
            );
        };

        // Cloudflare 차단 감지 시 Jina Reader로 폴백
        if (directFetchBlocked) {
            console.warn('[fetch-url] Direct fetch blocked, fallback to Jina Reader');
            const readerUrl = `https://r.jina.ai/${targetUrl}`;
            const jinaController = new AbortController();
            const jinaTimeout = setTimeout(() => jinaController.abort(), 20000);
            try {
                const jinaRes = await fetch(readerUrl, {
                    signal: jinaController.signal,
                    headers: { 'Accept': 'text/plain, text/markdown, */*' },
                });
                const jinaText = await jinaRes.text();
                if (jinaRes.ok && jinaText.trim().length >= 100) {
                    if (isJinaSecurityBlock(jinaText)) {
                        console.warn('[fetch-url] Jina returned security challenge page, treating as blocked');
                        return res.status(502).json({ content: '[FETCH_ERROR: 보안 인증이 필요한 페이지로 내용을 가져올 수 없습니다.]' });
                    }
                    return res.status(200).json({ content: jinaText.replace(/\s+/g, ' ').trim().slice(0, 17000) });
                }
            } catch (jinaError: any) {
                console.warn('[fetch-url] Jina Reader failed:', jinaError.message);
            } finally {
                clearTimeout(jinaTimeout);
            }
            return res.status(502).json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' });
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

        // SPA/JS-heavy 감지: body 추출 결과가 너무 짧으면 Jina로 재시도
        // (Cloudflare 비차단 SPA는 200을 반환하지만 실제 본문이 JS 번들뿐인 경우)
        if (bodyText.length < 300) {
            console.warn('[fetch-url] Extracted body too short (' + bodyText.length + ' chars), trying Jina Reader');
            const spaJinaController = new AbortController();
            const spaJinaTimeout = setTimeout(() => spaJinaController.abort(), 20000);
            try {
                const spaJinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
                    signal: spaJinaController.signal,
                    headers: { 'Accept': 'text/plain, text/markdown, */*' },
                });
                const spaJinaText = await spaJinaRes.text();
                if (spaJinaRes.ok && spaJinaText.trim().length >= 100) {
                    if (isJinaSecurityBlock(spaJinaText)) {
                        console.warn('[fetch-url] Jina (SPA path) returned security challenge page');
                        return res.status(502).json({ content: '[FETCH_ERROR: 보안 인증이 필요한 페이지로 내용을 가져올 수 없습니다.]' });
                    }
                    return res.status(200).json({ content: spaJinaText.replace(/\s+/g, ' ').trim().slice(0, 17000) });
                }
            } catch (e: any) {
                console.warn('[fetch-url] Jina fallback for SPA failed:', e.message);
            } finally {
                clearTimeout(spaJinaTimeout);
            }
        }

        // og 메타 + 본문 조합
        let content = '';
        if (ogTitle) content += `제목: ${ogTitle.trim()}\n`;
        if (ogDesc) content += `요약: ${ogDesc.trim()}\n\n`;
        content += bodyText;

        if (!content.trim()) {
            return res.status(502).json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' });
        }

        return res.status(200).json({ content: content.trim().slice(0, 17000) });
    } catch (error: any) {
        console.warn('[fetch-url] Failed:', error.message);
        return res.status(502).json({ content: '[FETCH_ERROR: 페이지를 가져올 수 없습니다.]' });
    }
}
