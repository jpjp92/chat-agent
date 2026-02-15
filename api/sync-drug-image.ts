import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url, imprint_front, imprint_back } = req.body;

    if (!url || typeof url !== 'string') {
        console.error('[Sync] Error: Missing or invalid URL in request body');
        return res.status(400).json({ error: 'Image URL is required' });
    }

    console.log(`[Sync] Imprint verification data - Front: "${imprint_front}", Back: "${imprint_back}"`);

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
        let html = ''; // Declare outside for wider scope

        if (contentType.includes('text/html') && (isNaverEntry || isConnectDIEntry)) {
            console.log(`[Sync] HTML content detected, searching for pill photo in ${isNaverEntry ? 'Naver' : 'ConnectDI'}...`);
            html = await externalResponse.text();
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
                // 2. ConnectDI Logic with Imprint Verification
                const isSearchResult = finalUrl.includes('search_result');
                console.log(`[Sync] ConnectDI content detected (${isSearchResult ? 'Search Result' : 'Detail Page'})...`);

                if (isSearchResult && (imprint_front || imprint_back)) {
                    console.log(`[Sync] Searching for product with matching imprint...`);
                    const productBlocks = html.split(/<div[^>]*class="[^"]*drug_list[^"]*"[^>]*>/i).slice(1);

                    for (const block of productBlocks) {
                        const frontMatch = block.match(/표시\s*\(앞\)[^<]*<[^>]*>([^<]+)</i);
                        const backMatch = block.match(/표시\s*\(뒤\)[^<]*<[^>]*>([^<]+)</i);
                        const blockFront = frontMatch ? frontMatch[1].trim() : '';
                        const blockBack = backMatch ? backMatch[1].trim() : '';

                        const normalizeFront = (s: string) => s.replace(/\s+/g, '').toUpperCase();
                        const normalizeBack = (s: string) => s.replace(/\s+/g, '').toUpperCase().replace(/없음|NONE|-/g, '');
                        const frontMatches = !imprint_front || normalizeFront(blockFront) === normalizeFront(imprint_front);
                        const backMatches = !imprint_back || normalizeBack(blockBack) === normalizeBack(imprint_back || '');

                        console.log(`[Sync] Checking - Front: "${blockFront}" (${frontMatches}), Back: "${blockBack}" (${backMatches})`);

                        if (frontMatches && backMatches) {
                            const imgMatch = block.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                            if (imgMatch && imgMatch[1]) {
                                targetScrapedUrl = 'https://www.connectdi.com' + imgMatch[1];
                                console.log(`[Sync] ✅ Found matching product: ${targetScrapedUrl}`);
                                break;
                            }
                        }
                    }

                    if (!targetScrapedUrl) {
                        console.warn(`[Sync] ⚠️ No match for Front:"${imprint_front}" Back:"${imprint_back}"`);
                        const drugMatch = html.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                        if (drugMatch && drugMatch[1]) {
                            targetScrapedUrl = 'https://www.connectdi.com' + drugMatch[1];
                            console.log(`[Sync] Using fallback (first image)`);
                        }
                    }
                } else {
                    const drugMatch = html.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                    if (drugMatch && drugMatch[1]) {
                        targetScrapedUrl = 'https://www.connectdi.com' + drugMatch[1];
                    }
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

                    // Extract pill visual info from ConnectDI HTML (fetch detail page if needed)
                    let pillVisual = null;
                    if (isConnectDIEntry) {
                        const detailHtml = await fetchConnectDIDetailHTML(finalUrl);
                        if (detailHtml) {
                            pillVisual = extractPillVisual(detailHtml);
                        }
                    }

                    return res.status(200).json({ ...result, pillVisual });
                }
            }

            console.warn(`[Sync] No valid pill photo found on ${isNaverEntry ? 'Naver' : 'ConnectDI'} page.`);
            return res.status(404).json({ error: 'No image found on page' });
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

        return res.status(200).json({ ...result, pillVisual });

    } catch (error: any) {
        console.error(`[Sync] Fatal error during sync:`, error);
        return res.status(500).json({
            error: 'Internal Server Error during image sync',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

// Fetch ConnectDI detail page HTML (handles search result redirect)
async function fetchConnectDIDetailHTML(url: string): Promise<string | null> {
    try {
        const htmlResponse = await fetch(url, {
            headers: {
                'Referer': 'https://www.connectdi.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

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
                const detailResponse = await fetch(detailUrl, {
                    headers: {
                        'Referer': 'https://www.connectdi.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

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
