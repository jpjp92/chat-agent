import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../api/_lib/supabase';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;

const inflightRequests = new Map<string, Promise<{ publicUrl: string; pillVisual: any } | null>>();

export async function POST(req: NextRequest) {
    let url: string, imprint_front: string, imprint_back: string, drug_name: string;
    try {
        ({ url, imprint_front, imprint_back, drug_name } = await req.json());
    } catch {
        return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
    }

    if (!url || typeof url !== 'string') {
        return NextResponse.json({ error: 'Image URL is required' }, { status: 400 });
    }

    let fileName: string | undefined;
    let resolveInflight: ((v: { publicUrl: string; pillVisual: any } | null) => void) | undefined;
    const completeInflight = (value: { publicUrl: string; pillVisual: any } | null) => {
        resolveInflight?.(value);
        if (fileName) inflightRequests.delete(fileName);
    };

    try {
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

        const cacheKey = drug_name ? `${repairedUrl}::${drug_name}` : repairedUrl;
        const urlHash = crypto.createHash('md5').update(cacheKey).digest('hex');
        fileName = `drug-cache/${urlHash}.jpg`;

        if (inflightRequests.has(fileName)) {
            const result = await inflightRequests.get(fileName)!;
            if (result) return NextResponse.json(result);
        }
        inflightRequests.set(fileName, new Promise(r => { resolveInflight = r; }));

        const { data: publicUrlData } = supabase.storage.from('chat-imgs').getPublicUrl(fileName);
        if (publicUrlData?.publicUrl) {
            try {
                const headCtrl = new AbortController();
                const headTimeout = setTimeout(() => headCtrl.abort(), 5000);
                let headCheck: Response;
                try { headCheck = await fetch(publicUrlData.publicUrl, { method: 'HEAD', signal: headCtrl.signal }); }
                finally { clearTimeout(headTimeout); }
                const cachedType = headCheck.headers.get('content-type') || '';
                if (headCheck.ok && (cachedType.includes('image/') || cachedType.includes('application/octet-stream'))) {
                    let pillVisual = null;
                    if (repairedUrl.includes('connectdi.com')) {
                        const html = await fetchConnectDIDetailHTML(repairedUrl);
                        if (html) pillVisual = extractPillVisual(html);
                    }
                    return NextResponse.json({ publicUrl: publicUrlData.publicUrl, pillVisual });
                }
            } catch {}
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
        const ALLOWED_DRUG_HOSTS = ['nedrug.mfds.go.kr', 'pstatic.net', 'connectdi.com', 'terms.naver.com', 'health.kr'];
        const isAllowedHost = ALLOWED_DRUG_HOSTS.some(h => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h));
        if (!isAllowedHost) {
            resolveInflight!(null);
            inflightRequests.delete(fileName!);
            return NextResponse.json({ error: 'URL not allowed' }, { status: 400 });
        }

        let referer = targetUrl.origin + '/';
        if (targetUrl.hostname.includes('pstatic.net') || targetUrl.hostname.includes('naver.com')) referer = 'https://terms.naver.com/';

        const fetchHeaders = {
            Referer: referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        const fetchWithRetry = async (retries = 1): Promise<Response> => {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 12000);
            try { return await fetch(finalUrl, { headers: fetchHeaders, signal: ctrl.signal }); }
            catch (e: any) {
                if (retries > 0 && e.name !== 'AbortError' && (e.code === 'ECONNRESET' || e.message?.includes('fetch failed'))) {
                    await new Promise(r => setTimeout(r, 800));
                    return fetchWithRetry(retries - 1);
                }
                throw e;
            } finally { clearTimeout(t); }
        };
        const externalResponse = await fetchWithRetry();

        if (!externalResponse.ok) {
            if (finalUrl.includes('nedrug.mfds.go.kr') && drug_name) {
                const fallbackResult = await tryConnectDIFallback(drug_name, fileName!, imprint_front, imprint_back);
                if (fallbackResult) { completeInflight(fallbackResult); return NextResponse.json(fallbackResult); }
            }
            completeInflight(null);
            return NextResponse.json({ error: 'External image not found' }, { status: externalResponse.status });
        }

        const contentType = externalResponse.headers.get('content-type') || '';
        const isNaverEntry = finalUrl.includes('terms.naver.com');
        const isConnectDIEntry = finalUrl.includes('connectdi.com');

        if (contentType.includes('text/html') && (isNaverEntry || isConnectDIEntry)) {
            const html = await externalResponse.text();
            let targetScrapedUrl: string | null = null;

            if (isNaverEntry) {
                const drugPhotoMatch = html.match(/https?:\/\/(?:fdb|d)bscthumb-phinf\.pstatic\.net\/[^"'\s>]+(?:type=[^"'\s>]+)?/gi);
                if (drugPhotoMatch) {
                    const filtered = drugPhotoMatch.filter(u => !u.includes('_au_') && !u.includes('profile') && !u.includes('video-phinf'));
                    if (filtered.length > 0) targetScrapedUrl = filtered.find(u => u.includes('pms') || u.includes('type=w') || u.includes('type=m4500')) || filtered[0];
                }
                if (!targetScrapedUrl) {
                    const og = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
                    if (og?.[1] && !og[1].includes('og.png')) targetScrapedUrl = og[1];
                }
            } else if (isConnectDIEntry) {
                const isSearchResult = finalUrl.includes('search_result');
                if (isSearchResult) {
                    const items = parseMedList(html);
                    let targetItem: MedListItem | null = null;
                    if (drug_name && items.length > 0) {
                        const scored = items.filter(i => i.imgUrl).map(i => ({ ...i, score: scoreNameMatch(drug_name, i.name) })).sort((a, b) => b.score - a.score);
                        if (scored.length > 0 && scored[0].score >= 40) targetItem = scored[0];
                    }
                    if (!targetItem) targetItem = items.find(i => i.imgUrl) || null;
                    targetScrapedUrl = targetItem?.imgUrl || null;
                } else {
                    const drugMatch = html.match(/src=["'](\/design\/img\/drug\/[^"']+)["']/i);
                    if (drugMatch?.[1]) targetScrapedUrl = 'https://www.connectdi.com' + drugMatch[1];
                }
            }

            if (targetScrapedUrl) {
                const sCtrl = new AbortController();
                const sTimeout = setTimeout(() => sCtrl.abort(), 8000);
                let scrapedResponse: Response;
                try {
                    scrapedResponse = await fetch(targetScrapedUrl, {
                        signal: sCtrl.signal,
                        headers: { Referer: isNaverEntry ? 'https://terms.naver.com/' : 'https://www.connectdi.com/', 'User-Agent': fetchHeaders['User-Agent'] },
                    });
                } finally { clearTimeout(sTimeout); }

                if (scrapedResponse.ok) {
                    const buf = Buffer.from(await scrapedResponse.arrayBuffer());
                    const result = await uploadAndReturn(buf, scrapedResponse.headers.get('content-type') || 'image/jpeg', fileName);
                    let pillVisual = null;
                    if (isConnectDIEntry) {
                        const dHtml = await fetchConnectDIDetailHTML(finalUrl);
                        if (dHtml) pillVisual = extractPillVisual(dHtml);
                    }
                    const payload = { ...result, pillVisual };
                    completeInflight(payload);
                    return NextResponse.json(payload);
                }
            }

            completeInflight(null);
            return NextResponse.json({ error: 'No image found on page' }, { status: 404 });
        }

        if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
            if (finalUrl.includes('nedrug.mfds.go.kr') && drug_name) {
                const fallbackResult = await tryConnectDIFallback(drug_name, fileName!, imprint_front, imprint_back);
                if (fallbackResult) { completeInflight(fallbackResult); return NextResponse.json(fallbackResult); }
            }
            completeInflight(null);
            return NextResponse.json({ error: 'URL did not return an image', contentType }, { status: 422 });
        }

        const buffer = Buffer.from(await externalResponse.arrayBuffer());
        const result = await uploadAndReturn(buffer, contentType, fileName);
        let pillVisual = null;
        if (isConnectDIEntry) {
            const dHtml = await fetchConnectDIDetailHTML(finalUrl);
            if (dHtml) pillVisual = extractPillVisual(dHtml);
        }
        const payload = { ...result, pillVisual };
        completeInflight(payload);
        return NextResponse.json(payload);

    } catch (error: any) {
        console.error('[Sync] Fatal error:', error);
        if (drug_name && fileName) {
            try {
                const fallbackResult = await tryConnectDIFallback(drug_name, fileName, imprint_front, imprint_back);
                if (fallbackResult) { completeInflight(fallbackResult); return NextResponse.json(fallbackResult); }
            } catch {}
        }
        try { completeInflight(null); } catch {}
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ─── helpers (business logic unchanged) ──────────────────────────────────────

function extractBaseName(name: string) {
    return name.replace(/\(.*?\)/g, '').replace(/[\d.]+\s*(밀리그램|밀리그람|마이크로그램|마이크로그람|그램|그람|mg|mcg|g)/gi, '').replace(/\s+/g, '').trim();
}
function extractDosageNumbers(name: string) {
    return (name.replace(/밀리그[램람]|마이크로그[램람]|그[램람]/g, '').match(/[\d.]+/g) || []) as string[];
}
function scoreNameMatch(targetName: string, candidateName: string) {
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/밀리그[램람]/g, 'mg').replace(/마이크로그[램람]/g, 'mcg').toLowerCase();
    const t = norm(targetName), c = norm(candidateName);
    if (c === t) return 100;
    const tBase = extractBaseName(t), cBase = extractBaseName(c);
    const tDosages = extractDosageNumbers(t), cDosages = extractDosageNumbers(c);
    if (cBase === tBase) return tDosages.length > 0 && tDosages.every(d => cDosages.includes(d)) ? 80 : 60;
    if (c.includes(tBase) || t.includes(cBase)) return 40;
    return 0;
}
interface MedListItem { name: string; imgUrl: string | null; detailUrl: string; }
function parseMedList(html: string): MedListItem[] {
    const items: MedListItem[] = [];
    for (const m of html.matchAll(/<a\s+href="([^"]*pap=detail[^"]*)">([\s\S]*?)<\/a>/gi)) {
        const imgMatch = m[2].match(/src="(\/design\/img\/drug\/[^"]+)"/i);
        const nameMatch = m[2].match(/<dt>([^<]+)<\/dt>/i);
        const dp = m[1];
        items.push({ name: nameMatch?.[1]?.trim() || '', imgUrl: imgMatch ? 'https://www.connectdi.com' + imgMatch[1] : null, detailUrl: dp.startsWith('http') ? dp : 'https://www.connectdi.com' + dp });
    }
    return items;
}
async function tryConnectDIFallback(drugName: string, fileName: string, imprintFront?: string, imprintBack?: string): Promise<{ publicUrl: string; pillVisual: any } | null> {
    try {
        const baseName = extractBaseName(drugName);
        const sCtrl = new AbortController(); const st = setTimeout(() => sCtrl.abort(), 10000);
        let searchResponse: Response;
        try { searchResponse = await fetch(`https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=${encodeURIComponent(baseName)}`, { signal: sCtrl.signal, headers: { Referer: 'https://www.connectdi.com/', 'User-Agent': 'Mozilla/5.0', Accept: 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9' } }); }
        finally { clearTimeout(st); }
        if (!searchResponse.ok) return null;
        const items = parseMedList(await searchResponse.text());
        if (items.length === 0) return null;
        const scored = items.filter(i => i.imgUrl).map(i => ({ ...i, score: scoreNameMatch(drugName, i.name) })).sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best || best.score < 40) return null;
        const iCtrl = new AbortController(); const it = setTimeout(() => iCtrl.abort(), 8000);
        let imgResponse: Response;
        try { imgResponse = await fetch(best.imgUrl!, { signal: iCtrl.signal, headers: { Referer: 'https://www.connectdi.com/', 'User-Agent': 'Mozilla/5.0' } }); }
        finally { clearTimeout(it); }
        if (!imgResponse.ok || !imgResponse.headers.get('content-type')?.includes('image')) return null;
        const result = await uploadAndReturn(Buffer.from(await imgResponse.arrayBuffer()), 'image/jpeg', fileName);
        let pillVisual = null;
        try { const dHtml = await fetchConnectDIDetailHTML(best.detailUrl); if (dHtml) pillVisual = extractPillVisual(dHtml); } catch {}
        return { ...result, pillVisual };
    } catch { return null; }
}
async function fetchConnectDIDetailHTML(url: string): Promise<string | null> {
    try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
        let res: Response;
        try { res = await fetch(url, { signal: ctrl.signal, headers: { Referer: 'https://www.connectdi.com/', 'User-Agent': 'Mozilla/5.0' } }); }
        finally { clearTimeout(t); }
        if (!res.ok) return null;
        let html = await res.text();
        if (url.includes('search_result')) {
            const m = html.match(/href=["']([^"']*pap=detail[^"']*)["']/i);
            if (m) {
                const dp = m[1];
                const detailUrl = dp.startsWith('http') ? dp : `https://www.connectdi.com${dp.startsWith('/') ? '' : '/mobile/drug/'}${dp}`;
                const dCtrl = new AbortController(); const dt = setTimeout(() => dCtrl.abort(), 8000);
                let dRes: Response;
                try { dRes = await fetch(detailUrl, { signal: dCtrl.signal, headers: { Referer: 'https://www.connectdi.com/', 'User-Agent': 'Mozilla/5.0' } }); }
                finally { clearTimeout(dt); }
                if (dRes.ok) html = await dRes.text();
            }
        }
        return html;
    } catch { return null; }
}
function extractPillVisual(html: string) {
    try {
        const pillVisual: any = {};
        const shapeMatch = html.match(/<th>의약품모양<\/th>\s*<td>([^<]+)<\/td>/i);
        const colorMatch = html.match(/<th>색깔\(앞\)<\/th>\s*<td>([^<]+)<\/td>/i);
        const frontMatch = html.match(/<th>표시\(앞\)<\/th>\s*<td>([^<]+)<\/td>/i);
        const backMatch = html.match(/<th>표시\(뒤\)<\/th>\s*<td>([^<]+)<\/td>/i);
        const shapeMap: Record<string, string> = { '원형': 'round', '타원형': 'oval', '장방형': 'capsule', '사각형': 'square', '오각형': 'pentagon', '육각형': 'hexagon', '팔각형': 'octagon', '마름모형': 'diamond', '반원형': 'semicircle', '삼각형': 'triangle' };
        const colorMap: Record<string, string> = { '하양': 'white', '노랑': 'yellow', '주황': 'orange', '분홍': 'pink', '빨강': 'red', '갈색': 'brown', '연두': 'light green', '초록': 'green', '청록': 'cyan', '파랑': 'blue', '남색': 'navy', '자주': 'purple', '보라': 'violet', '회색': 'gray', '검정': 'black', '투명': 'clear' };
        if (shapeMatch) pillVisual.shape = shapeMap[shapeMatch[1].trim()] || shapeMatch[1].trim();
        if (colorMatch) pillVisual.color = colorMap[colorMatch[1].trim()] || colorMatch[1].trim();
        for (const [match, side] of [[frontMatch, 'imprint_front'], [backMatch, 'imprint_back']] as const) {
            if (match) {
                let val = match[1].trim();
                if (val === '마크' || val === '각인' || val === 'mark') {
                    const mk = html.match(new RegExp(`<th>마크내용\\(${side === 'imprint_front' ? '앞' : '뒤'}\\)<\\/th>\\s*<td>([^<]+)<\\/td>`, 'i'));
                    if (mk?.[1]?.trim() && mk[1].trim() !== '-') val = mk[1].trim();
                }
                if (val && val !== '-' && val !== '없음' && val !== '마크' && val !== '각인') pillVisual[side] = val;
            }
        }
        return Object.keys(pillVisual).length > 0 ? pillVisual : null;
    } catch { return null; }
}
async function uploadAndReturn(buffer: Buffer, contentType: string, fileName: string) {
    const { error: uploadError } = await supabase.storage.from('chat-imgs').upload(fileName, buffer, { contentType, upsert: true });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from('chat-imgs').getPublicUrl(fileName);
    return { publicUrl };
}
