import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
        console.error('[Sync] Error: Missing or invalid URL in request body');
        return res.status(400).json({ error: 'Image URL is required' });
    }

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

        // 1. URL 해싱을 통한 중복 체크 (repairedUrl 기준)
        const urlHash = crypto.createHash('md5').update(repairedUrl).digest('hex');
        const fileName = `drug-cache/${urlHash}.jpg`;
        console.log(`[Sync] Generated fileName: ${fileName}`);

        // 2. 이미 존재하는지 확인
        const { data: publicUrlData } = supabase.storage
            .from('chat-imgs')
            .getPublicUrl(fileName);

        if (publicUrlData && publicUrlData.publicUrl) {
            console.log(`[Sync] Checking if file already exists at: ${publicUrlData.publicUrl}`);
            try {
                const headCheck = await fetch(publicUrlData.publicUrl, { method: 'HEAD' });
                if (headCheck.ok) {
                    console.log(`[Sync] File exists. Returning cached URL.`);
                    return res.status(200).json({ publicUrl: publicUrlData.publicUrl });
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

        const externalResponse = await fetch(finalUrl, {
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!externalResponse.ok) {
            console.warn(`[Sync] External image fetch failed for ${finalUrl}: ${externalResponse.status}`);
            return res.status(externalResponse.status).json({
                error: 'External image not found',
                message: `The provided image URL returned a ${externalResponse.status}`
            });
        }

        const contentType = externalResponse.headers.get('content-type') || '';

        // --- 3.5. Scraping Fallbacks ---
        const isNaverEntry = finalUrl.includes('terms.naver.com');
        const isConnectDIEntry = finalUrl.includes('connectdi.com');

        if (contentType.includes('text/html') && (isNaverEntry || isConnectDIEntry)) {
            console.log(`[Sync] HTML content detected, searching for pill photo in ${isNaverEntry ? 'Naver' : 'ConnectDI'}...`);
            const html = await externalResponse.text();
            let targetScrapedUrl = null;

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

                // Example: <img src="/design/img/drug/1PEPKBUcmBO.jpg" alt="">
                const drugMatch = html.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                if (drugMatch && drugMatch[1]) {
                    targetScrapedUrl = 'https://www.connectdi.com' + drugMatch[1];
                }
            }

            if (targetScrapedUrl) {
                console.log(`[Sync] Found scraped URL: ${targetScrapedUrl}`);
                const scrapedResponse = await fetch(targetScrapedUrl, {
                    headers: {
                        'Referer': isNaverEntry ? 'https://terms.naver.com/' : 'https://www.connectdi.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (scrapedResponse.ok) {
                    const scrapedBuffer = Buffer.from(await scrapedResponse.arrayBuffer());
                    const scrapedContentType = scrapedResponse.headers.get('content-type') || 'image/jpeg';
                    const result = await uploadAndReturn(scrapedBuffer, scrapedContentType, fileName);
                    return res.status(200).json(result);
                }
            }

            console.warn(`[Sync] No valid pill photo found on ${isNaverEntry ? 'Naver' : 'ConnectDI'} page.`);
            return res.status(404).json({ error: 'No image found on page' });
        }

        const buffer = Buffer.from(await externalResponse.arrayBuffer());
        console.log(`[Sync] Downloaded ${buffer.length} bytes. Type: ${contentType}`);

        const result = await uploadAndReturn(buffer, contentType, fileName);
        return res.status(200).json(result);

    } catch (error: any) {
        console.error(`[Sync] Fatal error during sync:`, error);
        return res.status(500).json({
            error: 'Internal Server Error during image sync',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
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
