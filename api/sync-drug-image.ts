import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase.js';
import crypto from 'crypto';

// In-flight deduplication: prevents duplicate concurrent downloads for the same fileName
const inflightRequests = new Map<string, Promise<{ publicUrl: string; pillVisual: any } | null>>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url, imprint_front, imprint_back, drug_name } = req.body;

    if (!url || typeof url !== 'string') {
        console.error('[Sync] Error: Missing or invalid URL in request body');
        return res.status(400).json({ error: 'Image URL is required' });
    }

    console.log(`[Sync] Imprint verification data - Front: "${imprint_front}", Back: "${imprint_back}"`);

    // Declare outside try so catch/finally can access for cleanup
    let fileName: string | undefined;
    let resolveInflight: ((v: { publicUrl: string; pillVisual: any } | null) => void) | undefined;

    try {
        console.log(`[Sync] original url: ${url}`);

        // 0. URL Auto-Repair (Hallucination Fix)
        let repairedUrl = url;

        // CASE A: https://health.kr/https://pstatic.net/... (Double HTTPS)
        const secondHttpsIndex = url.indexOf('https://', 8);
        if (secondHttpsIndex > -1) {
            repairedUrl = url.substring(secondHttpsIndex);
            console.log(`[Sync] Repaired double-HTTPS hybrid URL: ${repairedUrl}`);
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
                        console.log(`[Sync] Repaired nested-domain hybrid URL: ${repairedUrl}`);
                    }
                } catch (e) {
                    repairedUrl = candidate;
                }
            }
        }

        console.log(`[Sync] Request received for URL (repaired): ${repairedUrl}`);

        // 1. URL 해싱을 통한 중복 체크 (repairedUrl + drug_name 기준으로 용량별 분리)
        const cacheKey = drug_name ? `${repairedUrl}::${drug_name}` : repairedUrl;
        const urlHash = crypto.createHash('md5').update(cacheKey).digest('hex');
        fileName = `drug-cache/${urlHash}.jpg`;
        console.log(`[Sync] Cache key: ${drug_name || '(no name)'} | fileName: ${fileName}`);

        // 2a. In-flight deduplication: wait for an already-running request for the same file
        if (inflightRequests.has(fileName)) {
            console.log(`[Sync] Coalescing duplicate request for: ${fileName}`);
            const result = await inflightRequests.get(fileName)!;
            if (result) return res.status(200).json(result);
            console.log(`[Sync] Previous inflight failed, retrying independently...`);
        }

        // Register promise immediately so concurrent requests coalesce into this one
        inflightRequests.set(fileName, new Promise(r => { resolveInflight = r; }));

        // 2b. 이미 존재하는지 확인
        const { data: publicUrlData } = supabase.storage
            .from('chat-imgs')
            .getPublicUrl(fileName);

        if (publicUrlData && publicUrlData.publicUrl) {
            console.log(`[Sync] Checking if file already exists at: ${publicUrlData.publicUrl}`);
            try {
                const headController = new AbortController();
                const headTimeout = setTimeout(() => headController.abort(), 5000);
                let headCheck: Response;
                try {
                    headCheck = await fetch(publicUrlData.publicUrl, { method: 'HEAD', signal: headController.signal });
                } finally {
                    clearTimeout(headTimeout);
                }
                // Validate it's actually an image, not a previously-cached HTML error page
                const cachedType = headCheck.headers.get('content-type') || '';
                if (headCheck.ok && (cachedType.includes('image/') || cachedType.includes('application/octet-stream'))) {
                    console.log(`[Sync] File exists (${cachedType}). Returning cached URL.`);

                    // Even if cached, extract pill visual from ConnectDI if applicable
                    let pillVisual = null;
                    const isConnectDI = repairedUrl.includes('connectdi.com');

                    if (isConnectDI) {
                        try {
                            console.log(`[Sync] Fetching ConnectDI HTML for pill visual extraction...`);
                            const html = await fetchConnectDIDetailHTML(repairedUrl);

                            if (html) {
                                pillVisual = extractPillVisual(html);
                            }
                        } catch (e) {
                            console.warn('[Sync] Failed to extract pill visual from cached ConnectDI:', e);
                        }
                    }

                    return res.status(200).json({ publicUrl: publicUrlData.publicUrl, pillVisual });
                }
            } catch (headErr) {
                console.warn(`[Sync] HEAD check failed (file probably doesn't exist yet):`, headErr);
            }
        }

        // 3. 외부 이미지 다운로드 (Referer 우회 포함)
        let finalUrl = repairedUrl;
        if (url.includes('dthumb-phinf.pstatic.net') && url.includes('src=')) {
            try {
                const urlObj = new URL(url);
                const srcParam = urlObj.searchParams.get('src');
                if (srcParam) {
                    const cleanedSrc = srcParam.replace(/^"|"$/g, '');
                    finalUrl = decodeURIComponent(cleanedSrc);
                    console.log(`[Sync] Extracted nested Naver image URL: ${finalUrl}`);
                }
            } catch (pErr) {
                console.warn(`[Sync] Failed to parse nested Naver URL, using original:`, pErr);
            }
        }

        console.log(`[Sync] Fetching external image from: ${finalUrl}`);
        const targetUrl = new URL(finalUrl);
        let referer = targetUrl.origin + '/';
        if (targetUrl.hostname.includes('pstatic.net') || targetUrl.hostname.includes('naver.com')) {
            referer = 'https://terms.naver.com/';
        }

        // Retry once on ECONNRESET (nedrug.mfds.go.kr occasionally resets connections)
        const fetchHeaders = {
            'Referer': referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const fetchWithRetry = async (retries = 1): Promise<Response> => {
            const attemptController = new AbortController();
            const attemptTimeout = setTimeout(() => attemptController.abort(), 12000);
            try {
                return await fetch(finalUrl, { headers: fetchHeaders, signal: attemptController.signal });
            } catch (e: any) {
                if (retries > 0 && e.name !== 'AbortError' && (e.code === 'ECONNRESET' || e.message?.includes('fetch failed'))) {
                    console.warn(`[Sync] Fetch failed (${e.code || e.message}), retrying in 800ms...`);
                    await new Promise(r => setTimeout(r, 800));
                    return fetchWithRetry(retries - 1);
                }
                throw e;
            } finally {
                clearTimeout(attemptTimeout);
            }
        };
        const externalResponse = await fetchWithRetry();

        if (!externalResponse.ok) {
            console.warn(`[Sync] External image fetch failed for ${finalUrl}: ${externalResponse.status}`);

            // ConnectDI fallback when MFDS (nedrug.mfds.go.kr) is unavailable
            if (finalUrl.includes('nedrug.mfds.go.kr') && drug_name) {
                console.log(`[Sync] MFDS unavailable, attempting ConnectDI fallback for "${drug_name}"...`);
                const fallbackResult = await tryConnectDIFallback(drug_name, fileName!, imprint_front, imprint_back);
                if (fallbackResult) {
                    resolveInflight!(fallbackResult);
                    inflightRequests.delete(fileName!);
                    return res.status(200).json(fallbackResult);
                }
                console.warn(`[Sync] ConnectDI fallback also failed for "${drug_name}"`);
            }

            resolveInflight(null);
            inflightRequests.delete(fileName);
            return res.status(externalResponse.status).json({
                error: 'External image not found',
                message: `The provided image URL returned a ${externalResponse.status}`
            });
        }

        const contentType = externalResponse.headers.get('content-type') || '';

        // --- 3.5. Scraping Fallbacks ---
        const isNaverEntry = finalUrl.includes('terms.naver.com');
        const isConnectDIEntry = finalUrl.includes('connectdi.com');
        const isPharmOrKr = finalUrl.includes('pharm.or.kr');
        let html = ''; // Declare outside for wider scope

        if (contentType.includes('text/html') && (isNaverEntry || isConnectDIEntry || isPharmOrKr)) {
            console.log(`[Sync] HTML content detected, searching for pill photo in ${isNaverEntry ? 'Naver' : isPharmOrKr ? 'Pharm.or.kr' : 'ConnectDI'}...`);
            html = await externalResponse.text();
            let targetScrapedUrl = null;

            if (isPharmOrKr) {
                // pharm.or.kr detail page: health.kr CDN 이미지 추출
                // 큰 이미지(_b.jpg) 우선, 없으면 소형(_s.jpg) 사용
                const healthKrBig = html.match(/https?:\/\/common\.health\.kr\/shared\/images\/sb_photo\/[^"'\s>]+_b\.jpg/i);
                if (healthKrBig) {
                    targetScrapedUrl = healthKrBig[0];
                    console.log(`[Sync] Pharm.or.kr: found big image: ${targetScrapedUrl}`);
                } else {
                    const healthKrAny = html.match(/https?:\/\/common\.health\.kr\/shared\/images\/sb_photo\/[^"'\s>]+\.jpg/i);
                    if (healthKrAny) {
                        // 소형(_s.jpg) → 대형(_b.jpg) 시도
                        targetScrapedUrl = healthKrAny[0].replace(/_s\.jpg$/i, '_b.jpg');
                        console.log(`[Sync] Pharm.or.kr: promoting small→big: ${targetScrapedUrl}`);
                    }
                }

                if (targetScrapedUrl) {
                    const pharmImgCtrl1 = new AbortController();
                    const pharmImgT1 = setTimeout(() => pharmImgCtrl1.abort(), 8000);
                    let scrapedResponse: Response;
                    try {
                        scrapedResponse = await fetch(targetScrapedUrl, {
                            signal: pharmImgCtrl1.signal,
                            headers: {
                                'Referer': 'https://www.pharm.or.kr/',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            }
                        });
                    } finally {
                        clearTimeout(pharmImgT1);
                    }
                    if (!scrapedResponse.ok) {
                        // _b.jpg 없으면 _s.jpg로 재시도
                        targetScrapedUrl = targetScrapedUrl.replace(/_b\.jpg$/i, '_s.jpg');
                        console.log(`[Sync] Pharm.or.kr: big image returned ${scrapedResponse.status}, falling back to _s.jpg: ${targetScrapedUrl}`);
                        const pharmImgCtrl2 = new AbortController();
                        const pharmImgT2 = setTimeout(() => pharmImgCtrl2.abort(), 8000);
                        let retryResponse: Response;
                        try {
                            retryResponse = await fetch(targetScrapedUrl, {
                                signal: pharmImgCtrl2.signal,
                                headers: {
                                    'Referer': 'https://www.pharm.or.kr/',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                }
                            });
                        } finally {
                            clearTimeout(pharmImgT2);
                        }
                        if (retryResponse.ok) {
                            const retryBuffer = Buffer.from(await retryResponse.arrayBuffer());
                            const result = await uploadAndReturn(retryBuffer, 'image/jpeg', fileName!);
                            resolveInflight!(result);
                            inflightRequests.delete(fileName!);
                            return res.status(200).json(result);
                        }
                    } else {
                        const scrapedBuffer = Buffer.from(await scrapedResponse.arrayBuffer());
                        const result = await uploadAndReturn(scrapedBuffer, 'image/jpeg', fileName!);
                        resolveInflight!(result);
                        inflightRequests.delete(fileName!);
                        return res.status(200).json(result);
                    }
                }

                console.warn(`[Sync] No image found on pharm.or.kr page.`);
                resolveInflight!(null);
                inflightRequests.delete(fileName!);
                return res.status(404).json({ error: 'No image found on pharm.or.kr page' });
            }

            if (isNaverEntry) {
                // 1. Naver Logic
                const drugPhotoMatch = html.match(/https?:\/\/(?:fdb|d)bscthumb-phinf\.pstatic\.net\/[^"'\s>]+(?:type=[^"'\s>]+)?/gi);

                if (drugPhotoMatch && drugPhotoMatch.length > 0) {
                    // 필터링: 저자 사진(_au_), 비디오, 프로필 등 제외
                    const filtered = drugPhotoMatch.filter(u =>
                        !u.includes('_au_') &&
                        !u.includes('profile') &&
                        !u.includes('video-phinf')
                    );

                    if (filtered.length > 0) {
                        // 우선순위: pms(Pill Management System), w450, m4500 등 약 사진 태그 포함된 것
                        targetScrapedUrl = filtered.find(u =>
                            u.includes('pms') ||
                            u.includes('type=w') ||
                            u.includes('type=m4500')
                        ) || filtered[0];
                    }
                }

                if (!targetScrapedUrl) {
                    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
                    if (ogImageMatch && ogImageMatch[1] && !ogImageMatch[1].includes('og.png')) {
                        targetScrapedUrl = ogImageMatch[1];
                    }
                }
            } else if (isConnectDIEntry) {
                // 2. ConnectDI Logic
                const isSearchResult = finalUrl.includes('search_result');
                console.log(`[Sync] ConnectDI content detected (${isSearchResult ? 'Search Result' : 'Detail Page'})...`);

                if (isSearchResult) {
                    const items = parseMedList(html);
                    console.log(`[Sync] ConnectDI: parsed ${items.length} items from medList`);

                    let targetItem: MedListItem | null = null;

                    // Name-based scoring (primary selection)
                    if (drug_name && items.length > 0) {
                        const scored = items
                            .filter(item => item.imgUrl)
                            .map(item => ({ ...item, score: scoreNameMatch(drug_name, item.name) }))
                            .sort((a, b) => b.score - a.score);

                        if (scored.length > 0 && scored[0].score >= 40) {
                            targetItem = scored[0];
                            console.log(`[Sync] ConnectDI: name-matched "${targetItem.name}" (score=${scored[0].score})`);
                        }
                    }

                    // Fallback: first item with an image
                    if (!targetItem) {
                        targetItem = items.find(item => item.imgUrl) || null;
                        if (targetItem) console.log(`[Sync] ConnectDI: using first available item "${targetItem.name}"`);
                    }

                    targetScrapedUrl = targetItem?.imgUrl || null;
                } else {
                    const drugMatch = html.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                    if (drugMatch && drugMatch[1]) {
                        targetScrapedUrl = 'https://www.connectdi.com' + drugMatch[1];
                    }
                }
            }

            if (targetScrapedUrl) {
                console.log(`[Sync] Found scraped URL: ${targetScrapedUrl}`);
                const scrapedCtrl = new AbortController();
                const scrapedTimeout = setTimeout(() => scrapedCtrl.abort(), 8000);
                let scrapedResponse: Response;
                try {
                    scrapedResponse = await fetch(targetScrapedUrl, {
                        signal: scrapedCtrl.signal,
                        headers: {
                            'Referer': isNaverEntry ? 'https://terms.naver.com/' : 'https://www.connectdi.com/',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });
                } finally {
                    clearTimeout(scrapedTimeout);
                }

                if (scrapedResponse.ok) {
                    const scrapedBuffer = Buffer.from(await scrapedResponse.arrayBuffer());
                    const scrapedContentType = scrapedResponse.headers.get('content-type') || 'image/jpeg';
                    const result = await uploadAndReturn(scrapedBuffer, scrapedContentType, fileName);

                    // Extract pill visual info from ConnectDI HTML (fetch detail page if needed)
                    let pillVisual = null;
                    if (isConnectDIEntry) {
                        const detailHtml = await fetchConnectDIDetailHTML(finalUrl);
                        if (detailHtml) {
                            pillVisual = extractPillVisual(detailHtml);
                        }
                    }

                    const scrapedPayload = { ...result, pillVisual };
                    resolveInflight(scrapedPayload);
                    inflightRequests.delete(fileName);
                    return res.status(200).json(scrapedPayload);
                }
            }

            console.warn(`[Sync] No valid pill photo found on ${isNaverEntry ? 'Naver' : 'ConnectDI'} page.`);
            resolveInflight(null);
            inflightRequests.delete(fileName);
            return res.status(404).json({ error: 'No image found on page' });
        }

        // Direct image download (e.g. nedrug.mfds.go.kr)
        // Reject non-image responses to prevent caching HTML error pages
        if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
            console.warn(`[Sync] Rejected non-image content-type: ${contentType}`);
            resolveInflight(null);
            inflightRequests.delete(fileName);
            return res.status(422).json({ error: 'URL did not return an image', contentType });
        }

        const buffer = Buffer.from(await externalResponse.arrayBuffer());
        console.log(`[Sync] Downloaded ${buffer.length} bytes. Type: ${contentType}`);

        const result = await uploadAndReturn(buffer, contentType, fileName);

        // Extract pill visual info if ConnectDI (fetch detail page if needed)
        let pillVisual = null;
        if (isConnectDIEntry) {
            const detailHtml = await fetchConnectDIDetailHTML(finalUrl);
            if (detailHtml) {
                pillVisual = extractPillVisual(detailHtml);
            }
        }

        const directPayload = { ...result, pillVisual };
        resolveInflight(directPayload);
        inflightRequests.delete(fileName);
        return res.status(200).json(directPayload);

    } catch (error: any) {
        console.error(`[Sync] Fatal error during sync:`, error);
        try { resolveInflight?.(null); } catch {}
        try { inflightRequests.delete(fileName); } catch {}
        return res.status(500).json({
            error: 'Internal Server Error during image sync',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

// ─── ConnectDI name-matching helpers ────────────────────────────────────────

function extractBaseName(name: string): string {
    return name
        .replace(/\(.*?\)/g, '')
        .replace(/[\d.]+\s*(밀리그램|밀리그람|마이크로그램|마이크로그람|그램|그람|mg|mcg|g)/gi, '')
        .replace(/\s+/g, '')
        .trim();
}

function extractDosageNumbers(name: string): string[] {
    return (name.replace(/밀리그[램람]|마이크로그[램람]|그[램람]/g, '').match(/[\d.]+/g) || []);
}

function scoreNameMatch(targetName: string, candidateName: string): number {
    const norm = (s: string) =>
        s.replace(/\s+/g, '')
         .replace(/밀리그[램람]/g, 'mg')
         .replace(/마이크로그[램람]/g, 'mcg')
         .toLowerCase();
    const t = norm(targetName);
    const c = norm(candidateName);
    if (c === t) return 100;
    const tBase = extractBaseName(t);
    const cBase = extractBaseName(c);
    const tDosages = extractDosageNumbers(t);
    const cDosages = extractDosageNumbers(c);
    if (cBase === tBase) {
        const dosageMatch = tDosages.length > 0 && tDosages.every(d => cDosages.includes(d));
        return dosageMatch ? 80 : 60;
    }
    if (c.includes(tBase) || t.includes(cBase)) return 40;
    return 0;
}

interface MedListItem { name: string; imgUrl: string | null; detailUrl: string; }

function parseMedList(html: string): MedListItem[] {
    const items: MedListItem[] = [];
    const blockRegex = /<a\s+href="([^"]*pap=detail[^"]*)">([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(blockRegex)) {
        const detailPath = m[1];
        const block = m[2];
        const imgMatch = block.match(/src="(\/design\/img\/drug\/[^"]+)"/i);
        const imgUrl = imgMatch ? 'https://www.connectdi.com' + imgMatch[1] : null;
        const nameMatch = block.match(/<dt>([^<]+)<\/dt>/i);
        const name = nameMatch ? nameMatch[1].trim() : '';
        const detailUrl = detailPath.startsWith('http')
            ? detailPath
            : 'https://www.connectdi.com' + detailPath;
        items.push({ name, imgUrl, detailUrl });
    }
    return items;
}

// ConnectDI fallback: MFDS(nedrug.mfds.go.kr) 장애 시 동명 약품을 ConnectDI에서 검색·다운로드
async function tryConnectDIFallback(
    drugName: string,
    fileName: string,
    imprintFront?: string,
    imprintBack?: string
): Promise<{ publicUrl: string; pillVisual: any } | null> {
    try {
        const baseName = extractBaseName(drugName);
        const searchUrl = `https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=${encodeURIComponent(baseName)}`;
        console.log(`[Sync] ConnectDI fallback: searching "${baseName}" → ${searchUrl}`);

        const searchCtrl = new AbortController();
        const searchTimeout = setTimeout(() => searchCtrl.abort(), 10000);
        let searchResponse: Response;
        try {
            searchResponse = await fetch(searchUrl, {
                signal: searchCtrl.signal,
                headers: {
                    'Referer': 'https://www.connectdi.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                }
            });
        } finally {
            clearTimeout(searchTimeout);
        }

        if (!searchResponse.ok) {
            console.warn(`[Sync] ConnectDI fallback: search failed (${searchResponse.status})`);
            return null;
        }

        const searchHtml = await searchResponse.text();
        const items = parseMedList(searchHtml);
        console.log(`[Sync] ConnectDI fallback: found ${items.length} results`);
        if (items.length === 0) return null;

        // Score by drug name and pick best match
        const scored = items
            .filter(item => item.imgUrl)
            .map(item => ({ ...item, score: scoreNameMatch(drugName, item.name) }))
            .sort((a, b) => b.score - a.score);

        const best = scored[0];
        if (!best || best.score < 40) {
            console.warn(`[Sync] ConnectDI fallback: no sufficient match (best="${best?.name}", score=${best?.score ?? 0})`);
            return null;
        }
        console.log(`[Sync] ConnectDI fallback: best match "${best.name}" (score=${best.score}) → ${best.imgUrl}`);

        // Download image
        const imgCtrl = new AbortController();
        const imgTimeout = setTimeout(() => imgCtrl.abort(), 8000);
        let imgResponse: Response;
        try {
            imgResponse = await fetch(best.imgUrl!, {
                signal: imgCtrl.signal,
                headers: {
                    'Referer': 'https://www.connectdi.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
        } finally {
            clearTimeout(imgTimeout);
        }

        if (!imgResponse.ok || !imgResponse.headers.get('content-type')?.includes('image')) {
            console.warn(`[Sync] ConnectDI fallback: image download failed (${imgResponse.status})`);
            return null;
        }

        const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
        const result = await uploadAndReturn(imgBuffer, 'image/jpeg', fileName);

        // Extract pill visual from detail page
        let pillVisual = null;
        try {
            const detailHtml = await fetchConnectDIDetailHTML(best.detailUrl);
            if (detailHtml) pillVisual = extractPillVisual(detailHtml);
        } catch (e) {
            console.warn('[Sync] ConnectDI fallback: pill visual extraction failed', e);
        }

        console.log(`[Sync] ConnectDI fallback: successfully cached image for "${drugName}"`);
        return { ...result, pillVisual };
    } catch (e: any) {
        console.error('[Sync] ConnectDI fallback error:', e.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────

// Fetch ConnectDI detail page HTML (handles search result redirect)
async function fetchConnectDIDetailHTML(url: string): Promise<string | null> {
    try {
        const htmlCtrl = new AbortController();
        const htmlTimeout = setTimeout(() => htmlCtrl.abort(), 8000);
        let htmlResponse: Response;
        try {
            htmlResponse = await fetch(url, {
                signal: htmlCtrl.signal,
                headers: {
                    'Referer': 'https://www.connectdi.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
        } finally {
            clearTimeout(htmlTimeout);
        }

        if (!htmlResponse.ok) return null;

        let html = await htmlResponse.text();

        // If it's a search result page, extract detail page link
        if (url.includes('search_result')) {
            console.log('[Sync] Search result page detected, looking for detail page link...');
            const detailLinkMatch = html.match(/href=["']([^"']*pap=detail[^"']*)["']/i);

            if (detailLinkMatch) {
                const detailPath = detailLinkMatch[1];
                const detailUrl = detailPath.startsWith('http')
                    ? detailPath
                    : `https://www.connectdi.com${detailPath.startsWith('/') ? '' : '/mobile/drug/'}${detailPath}`;

                console.log(`[Sync] Found detail page: ${detailUrl}`);

                // Fetch detail page
                const detailCtrl = new AbortController();
                const detailTimeout = setTimeout(() => detailCtrl.abort(), 8000);
                let detailResponse: Response;
                try {
                    detailResponse = await fetch(detailUrl, {
                        signal: detailCtrl.signal,
                        headers: {
                            'Referer': 'https://www.connectdi.com/',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                } finally {
                    clearTimeout(detailTimeout);
                }

                if (detailResponse.ok) {
                    html = await detailResponse.text();
                }
            } else {
                console.warn('[Sync] No detail page link found in search results');
            }
        }

        return html;
    } catch (e) {
        console.error('[Sync] Error fetching ConnectDI HTML:', e);
        return null;
    }
}

// Extract pill identification info from ConnectDI HTML
function extractPillVisual(html: string): {
    shape?: string;
    color?: string;
    imprint_front?: string;
    imprint_back?: string;
} | null {
    try {
        const pillVisual: any = {};

        // Extract from identification table
        const shapeMatch = html.match(/<th>의약품모양<\/th>\s*<td>([^<]+)<\/td>/i);
        const colorMatch = html.match(/<th>색깔\(앞\)<\/th>\s*<td>([^<]+)<\/td>/i);
        const frontMatch = html.match(/<th>표시\(앞\)<\/th>\s*<td>([^<]+)<\/td>/i);
        const backMatch = html.match(/<th>표시\(뒤\)<\/th>\s*<td>([^<]+)<\/td>/i);

        console.log('[Sync] Regex matches:', {
            shape: shapeMatch ? shapeMatch[1] : 'NOT FOUND',
            color: colorMatch ? colorMatch[1] : 'NOT FOUND',
            front: frontMatch ? frontMatch[1] : 'NOT FOUND',
            back: backMatch ? backMatch[1] : 'NOT FOUND'
        });

        if (shapeMatch) {
            const shapeKo = shapeMatch[1].trim();
            const shapeMap: Record<string, string> = {
                '원형': 'round',
                '타원형': 'oval',
                '장방형': 'capsule',
                '사각형': 'square',
                '오각형': 'pentagon',
                '육각형': 'hexagon',
                '팔각형': 'octagon',
                '마름모형': 'diamond',
                '반원형': 'semicircle',
                '삼각형': 'triangle'
            };
            pillVisual.shape = shapeMap[shapeKo] || shapeKo;
        }

        if (colorMatch) {
            const colorKo = colorMatch[1].trim();
            const colorMap: Record<string, string> = {
                '하양': 'white',
                '노랑': 'yellow',
                '주황': 'orange',
                '분홍': 'pink',
                '빨강': 'red',
                '갈색': 'brown',
                '연두': 'light green',
                '초록': 'green',
                '청록': 'cyan',
                '파랑': 'blue',
                '남색': 'navy',
                '자주': 'purple',
                '보라': 'violet',
                '회색': 'gray',
                '검정': 'black',
                '투명': 'clear'
            };
            pillVisual.color = colorMap[colorKo] || colorKo;
        }

        if (frontMatch) {
            let front = frontMatch[1].trim();

            // If "표시" is generic (마크, 각인, etc.), try "마크내용" instead
            if (front === '마크' || front === '각인' || front === 'mark') {
                const markMatch = html.match(/<th>마크내용\(앞\)<\/th>\s*<td>([^<]+)<\/td>/i);
                if (markMatch && markMatch[1].trim() && markMatch[1].trim() !== '-') {
                    front = markMatch[1].trim();
                }
            }

            if (front && front !== '-' && front !== '없음' && front !== '마크' && front !== '각인') {
                pillVisual.imprint_front = front;
            }
        }

        if (backMatch) {
            let back = backMatch[1].trim();

            // If "표시" is generic, try "마크내용" instead
            if (back === '마크' || back === '각인' || back === 'mark') {
                const markMatch = html.match(/<th>마크내용\(뒤\)<\/th>\s*<td>([^<]+)<\/td>/i);
                if (markMatch && markMatch[1].trim() && markMatch[1].trim() !== '-') {
                    back = markMatch[1].trim();
                }
            }

            if (back && back !== '-' && back !== '없음' && back !== '마크' && back !== '각인') {
                pillVisual.imprint_back = back;
            }
        }

        console.log(`[Sync] Extracted pill visual:`, pillVisual);
        return Object.keys(pillVisual).length > 0 ? pillVisual : null;
    } catch (e) {
        console.error('[Sync] Error extracting pill visual:', e);
        return null;
    }
}

async function uploadAndReturn(buffer: Buffer, contentType: string, fileName: string) {
    console.log(`[Sync] Uploading to Supabase bucket 'chat-imgs'...`);
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('chat-imgs')
        .upload(fileName, buffer, {
            contentType,
            upsert: true
        });

    if (uploadError) {
        console.error('[Sync] Supabase upload error details:', uploadError);
        throw uploadError;
    }

    const { data: finalPublicData } = supabase.storage
        .from('chat-imgs')
        .getPublicUrl(fileName);

    console.log(`[Sync] Successfully synced! Public URL: ${finalPublicData.publicUrl}`);
    return { publicUrl: finalPublicData.publicUrl };
}
