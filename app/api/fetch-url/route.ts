import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '../../../server/supabase';

export const runtime = 'nodejs';
export const maxDuration = 120;

const FETCH_FAILED_CONTENT = '[FETCH_ERROR: 해당 페이지는 보안 정책, 접속 제한 또는 사이트 차단으로 인해 서버에서 직접 접근할 수 없습니다.]';
const SCRAPER_API_TIMEOUT_MS = 45000;
const SCRAPINGBEE_TIMEOUT_MS = 40000;
const SCRAPINGBEE_STATIC_TIMEOUT_MS = 15000; // no render_js — SSR 사이트용 빠른 경로
const BROWSERLESS_TIMEOUT_MS = 30000;
const BROWSERLESS_BASE = (process.env.BROWSERLESS_REST_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, '');
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14일

// cache 쓰기는 서비스키 우선(없으면 anon). 근거: docs/logs/DEV_260606.md §11
const db = supabaseAdmin ?? supabase;

const SSRF_BLOCK = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:|fe80:)/i;

const isSecurityBlock = (text: string) => {
    const t = text.toLowerCase();
    return t.includes('just a moment') || t.includes('performing security verification') ||
        t.includes('security service to protect') || t.includes('warning: target url returned error 403') ||
        t.includes('warning: this page maybe requiring captcha') ||
        t.includes('verifying you are not a bot') || t.includes('please enable cookies') ||
        // 광범위한 'cloudflare'/'cf-ray' 대신 챌린지 페이지 고유 문구만 매칭.
        // (정상 기사가 본문에서 'Cloudflare'를 언급하면 오판해 fetch를 실패로 뒤집던 버그 — wikidocs 블로그 502)
        t.includes('attention required! | cloudflare') || t.includes('sorry, you have been blocked') ||
        t.includes('cloudflare ray id') ||
        t.includes('보안 확인 수행 중') || t.includes('악의적인 봇') ||
        t.includes('잠시만 기다리십시오');
};

const isWikidocsHost = (hostname: string) => hostname === 'wikidocs.net' || hostname.endsWith('.wikidocs.net');

// 본문 없이 푸터·약관·robots 공지만 추출된 경우(SPA 정적 셸·embed 카드 등) 판정.
// 예: fotmob /embed/news는 React SPA라 직접 fetch가 © Copyright/Terms/"robots, crawler not permitted"
// 푸터만 긁어옴 → 모델이 본문으로 오인해 제목 기반 추정을 유발. 이런 결과는 실패로 처리한다.
const isBoilerplateOnly = (text: string): boolean => {
    const t = text.toLowerCase();
    const hasLegal = t.includes('copyright') || t.includes('©') || t.includes('terms of use') || t.includes('privacy policy');
    const hasFooter = t.includes('automatic services') || t.includes('robots, crawler') || t.includes('cookie policy') || t.includes('follow us');
    return hasLegal && hasFooter && text.length < 1500;
};

const normalizeKey = (u: string) => {
    try { const url = new URL(u); url.hash = ''; return url.toString(); } catch { return u; }
};

const getCached = async (key: string): Promise<string | null> => {
    try {
        const { data, error } = await db.from('url_cache').select('content, fetched_at').eq('url_key', key).maybeSingle();
        if (error || !data) return null;
        if (Date.now() - new Date(data.fetched_at).getTime() > CACHE_TTL_MS) return null;
        return data.content as string;
    } catch { return null; }
};

const setCached = async (key: string, content: string, provider: string): Promise<void> => {
    try {
        await db.from('url_cache').upsert(
            { url_key: key, content, status: 'ok', provider, fetched_at: new Date().toISOString() },
            { onConflict: 'url_key' },
        );
    } catch { /* 캐시는 best-effort */ }
};

const extractReadableContent = (html: string) => {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';

    const cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<(nav|header|footer|aside|iframe|noscript|figure|form)[^>]*>[\s\S]*?<\/\1>/gi, '');

    const htmlTextLen = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
    // 모든 <article>/<main> 블록 중 텍스트가 가장 많은 것 선택.
    // (aitimes 등은 폰트크기 위젯 <article>이 본문 <article>보다 HTML상 먼저 나와 first-match가 깨짐)
    const semanticBlocks: { html: string; tag: 'article' | 'main' }[] = [];
    for (const re of [/<article[^>]*>([\s\S]*?)<\/article>/gi, /<main[^>]*>([\s\S]*?)<\/main>/gi]) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(cleaned))) semanticBlocks.push({ html: m[1] || '', tag: m[0].toLowerCase().startsWith('<article') ? 'article' : 'main' });
    }
    semanticBlocks.sort((a, b) => htmlTextLen(b.html) - htmlTextLen(a.html));
    const semanticBest = semanticBlocks[0] && htmlTextLen(semanticBlocks[0].html) >= 300 ? semanticBlocks[0] : null;

    const divMatch = !semanticBest && (
        cleaned.match(/(<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:page[-_]content|book[-_]content|book_content|article[-_](?:view[-_](?:content|body|text)|content|body|text)|post[-_](?:content|body|text)|news[-_](?:view|content|body|text)|view[-_](?:content|body|con)|read[-_](?:body|content)|content[-_](?:area|wrap|body|view))[^"']*["'][^>]*>)([\s\S]+)/i)
    );
    const selector = semanticBest ? semanticBest.tag : divMatch ? 'content' : 'body';
    const bodyHtml = semanticBest ? semanticBest.html : divMatch ? divMatch[2] : cleaned;
    const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 15000);

    let content = '';
    if (ogTitle) content += `제목: ${ogTitle.trim()}\n`;
    if (ogDesc) content += `요약: ${ogDesc.trim()}\n\n`;
    content += bodyText;

    return {
        content: content.trim().slice(0, 17000),
        bodyText,
        ogTitle,
        ogDesc,
        selector,
    };
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
        const targetHostname = new URL(targetUrl).hostname.toLowerCase();
        const useCloudflareUnblock = isWikidocsHost(targetHostname);
        const cacheKey = normalizeKey(targetUrl);

        // 1) 캐시 조회 — HIT면 즉시 반환 (browserless/scraper unit 절약)
        const cached = await getCached(cacheKey);
        if (cached) {
            console.info('[fetch-url] cache hit', { url: targetUrl });
            return NextResponse.json({ content: cached, cached: true });
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

        let html = '';
        // wikidocs는 Cloudflare가 항상 403 "Just a moment" 챌린지를 반환 → direct fetch 10s는 순수 낭비.
        // 바로 ScrapingBee(render_js) CF 우회 체인으로 보낸다 (캐시 미스 시 ~10s 단축).
        let directFetchBlocked = useCloudflareUnblock;
        if (!useCloudflareUnblock) {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 10000);
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
                if (!response.ok || isSecurityBlock(html) || html.match(/<title[^>]*>\s*just a moment/i)) directFetchBlocked = true;
            } catch (e: any) {
                directFetchBlocked = true;
            } finally {
                clearTimeout(t);
            }
        }

        // browserless /unblock (datacenter) — Cloudflare 1차 우회. 근거: DEV_260606.md §11
        const browserlessFetch = async () => {
            const token = process.env.BROWSERLESS_KEY || process.env.BROWSERLESS_TOKEN;
            if (!token) {
                console.warn('[fetch-url] browserless skipped: BROWSERLESS_KEY missing', { url: targetUrl });
                return null;
            }
            const bCtrl = new AbortController();
            const bt = setTimeout(() => bCtrl.abort(), BROWSERLESS_TIMEOUT_MS);
            try {
                const res = await fetch(`${BROWSERLESS_BASE}/unblock?token=${encodeURIComponent(token)}`, {
                    method: 'POST',
                    signal: bCtrl.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: targetUrl, content: true }),
                });
                const raw = await res.text();
                if (!res.ok) {
                    console.warn('[fetch-url] browserless non-ok', { url: targetUrl, status: res.status, sample: raw.slice(0, 120) });
                    return null;
                }
                let json: any;
                try { json = JSON.parse(raw); } catch { json = { content: raw }; }
                const cv = json.content || json.html || '';
                const content = typeof cv === 'string' ? cv : JSON.stringify(cv);
                const extracted = extractReadableContent(content);
                // security-block 판정은 추출 본문만 (raw JSON의 cf_clearance 오탐 방지)
                const securityBlock = isSecurityBlock(`${extracted.ogTitle}\n${extracted.bodyText}`);
                if (extracted.bodyText.length >= 300 && !securityBlock) {
                    console.info('[fetch-url] browserless succeeded', { url: targetUrl, selector: extracted.selector, textChars: extracted.bodyText.length });
                    return extracted.content;
                }
                console.warn('[fetch-url] browserless failed', { url: targetUrl, textChars: extracted.bodyText.length, securityBlock });
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] browserless error', { url: targetUrl, timeoutMs: BROWSERLESS_TIMEOUT_MS, error: error?.message ?? String(error) });
                return null;
            } finally {
                clearTimeout(bt);
            }
        };

        const scraperApiFetch = async () => {
            const apiKey = process.env.SCRAPER_KEY || process.env.SCRAPERAPI_KEY;
            if (!apiKey) {
                console.warn('[fetch-url] ScraperAPI fallback skipped: SCRAPER_KEY missing', { url: targetUrl });
                return null;
            }

            const sCtrl = new AbortController();
            const st = setTimeout(() => sCtrl.abort(), SCRAPER_API_TIMEOUT_MS);
            try {
                const params = new URLSearchParams({
                    api_key: apiKey,
                    url: targetUrl,
                    render: 'true',
                });
                const res = await fetch(`https://api.scraperapi.com/?${params.toString()}`, {
                    signal: sCtrl.signal,
                    headers: { Accept: 'text/html, text/plain, */*' },
                });
                const renderedHtml = await res.text();
                const extracted = extractReadableContent(renderedHtml);
                const cost = res.headers.get('sa-credit-cost');
                const finalUrl = res.headers.get('sa-final-url');
                const securityBlock = isSecurityBlock(`${extracted.ogTitle}\n${extracted.bodyText}`);

                if (res.ok && extracted.bodyText.length >= 300 && !securityBlock) {
                    console.info('[fetch-url] ScraperAPI fallback succeeded', {
                        url: targetUrl,
                        status: res.status,
                        finalUrl,
                        selector: extracted.selector,
                        textChars: extracted.bodyText.length,
                        cost,
                    });
                    return extracted.content;
                }

                console.warn('[fetch-url] ScraperAPI fallback failed', {
                    url: targetUrl,
                    status: res.status,
                    finalUrl,
                    selector: extracted.selector,
                    textChars: extracted.bodyText.length,
                    cost,
                    sample: extracted.bodyText.slice(0, 180),
                });
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] ScraperAPI fallback error', {
                    url: targetUrl,
                    timeoutMs: SCRAPER_API_TIMEOUT_MS,
                    error: error?.message ?? String(error),
                });
                return null;
            } finally {
                clearTimeout(st);
            }
        };

        // ScrapingBee static (no render_js) — SSR 뉴스/블로그 사이트용 빠른 경로 (~3-5s).
        // render_js=false이므로 Chrome headless 불필요 → 크레딧 절약 + 지연 최소화.
        const scrapingBeeStaticFetch = async () => {
            const apiKey = process.env.SCRAPINGBEE_KEY;
            if (!apiKey) return null;
            const sbCtrl = new AbortController();
            const sbt = setTimeout(() => sbCtrl.abort(), SCRAPINGBEE_STATIC_TIMEOUT_MS);
            try {
                const params = new URLSearchParams({
                    api_key: apiKey,
                    url: targetUrl,
                    render_js: 'false',
                    country_code: 'kr',
                });
                const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
                    signal: sbCtrl.signal,
                    headers: { Accept: 'text/html, text/plain, */*' },
                });
                const renderedHtml = await res.text();
                const extracted = extractReadableContent(renderedHtml);
                const cost = res.headers.get('spb-cost');
                const securityBlock = isSecurityBlock(`${extracted.ogTitle}\n${extracted.bodyText}`);
                const boilerplate = isBoilerplateOnly(extracted.bodyText);
                if (res.ok && extracted.bodyText.length >= 300 && !securityBlock && !boilerplate) {
                    console.info('[fetch-url] ScrapingBee(static) succeeded', { url: targetUrl, selector: extracted.selector, textChars: extracted.bodyText.length, cost });
                    return extracted.content;
                }
                console.warn('[fetch-url] ScrapingBee(static) failed', { url: targetUrl, textChars: extracted.bodyText.length, securityBlock, boilerplate, cost });
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] ScrapingBee(static) error', { url: targetUrl, error: error?.message ?? String(error) });
                return null;
            } finally {
                clearTimeout(sbt);
            }
        };

        // ScrapingBee render_js (render_js + premium_proxy) — wikidocs Cloudflare 우회 검증됨(2026-06-22, ~4.6s).
        // SPA·CF 챌린지 사이트 전용. 느리지만(~15-40s) JS 렌더링 필요 시 사용.
        const scrapingBeeFetch = async () => {
            const apiKey = process.env.SCRAPINGBEE_KEY;
            if (!apiKey) {
                console.warn('[fetch-url] ScrapingBee skipped: SCRAPINGBEE_KEY missing', { url: targetUrl });
                return null;
            }
            const sbCtrl = new AbortController();
            const sbt = setTimeout(() => sbCtrl.abort(), SCRAPINGBEE_TIMEOUT_MS);
            try {
                const params = new URLSearchParams({
                    api_key: apiKey,
                    url: targetUrl,
                    render_js: 'true',
                    premium_proxy: 'true',
                    country_code: 'kr',
                });
                const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, {
                    signal: sbCtrl.signal,
                    headers: { Accept: 'text/html, text/plain, */*' },
                });
                const renderedHtml = await res.text();
                const extracted = extractReadableContent(renderedHtml);
                const cost = res.headers.get('spb-cost');
                const securityBlock = isSecurityBlock(`${extracted.ogTitle}\n${extracted.bodyText}`);
                const boilerplate = isBoilerplateOnly(extracted.bodyText);
                if (res.ok && extracted.bodyText.length >= 300 && !securityBlock && !boilerplate) {
                    console.info('[fetch-url] ScrapingBee(render) succeeded', { url: targetUrl, status: res.status, selector: extracted.selector, textChars: extracted.bodyText.length, cost });
                    return extracted.content;
                }
                console.warn('[fetch-url] ScrapingBee(render) failed', { url: targetUrl, status: res.status, textChars: extracted.bodyText.length, securityBlock, boilerplate, cost, sample: extracted.bodyText.slice(0, 180) });
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] ScrapingBee(render) error', { url: targetUrl, timeoutMs: SCRAPINGBEE_TIMEOUT_MS, error: error?.message ?? String(error) });
                return null;
            } finally {
                clearTimeout(sbt);
            }
        };

        // Cloudflare 차단 사이트(wikidocs): ScrapingBee(render) 1차 → browserless /unblock → ScraperAPI
        const cloudflareUnblock = async (): Promise<string | null> => {
            const sb = await scrapingBeeFetch();
            if (sb) { await setCached(cacheKey, sb, 'scrapingbee'); return sb; }
            const bl = await browserlessFetch();
            if (bl) { await setCached(cacheKey, bl, 'browserless'); return bl; }
            const sc = await scraperApiFetch();
            if (sc) { await setCached(cacheKey, sc, 'scraperapi'); return sc; }
            return null;
        };

        // 비-wikidocs 폴백: static(~3s) → render_js(~40s) 2단계.
        // SSR 사이트(뉴스·블로그)는 static으로 충분. SPA만 render_js까지 진행.
        // 폴백 실패 시 FETCH_FAILED — 모델의 제목 기반 추정 차단.
        const renderFallback = async (): Promise<string | null> => {
            if (useCloudflareUnblock) return await cloudflareUnblock();
            const sbStatic = await scrapingBeeStaticFetch();
            if (sbStatic) { await setCached(cacheKey, sbStatic, 'scrapingbee-static'); return sbStatic; }
            const sb = await scrapingBeeFetch();
            if (sb) { await setCached(cacheKey, sb, 'scrapingbee'); return sb; }
            return null;
        };

        if (directFetchBlocked) {
            const text = await renderFallback();
            if (text) return NextResponse.json({ content: text });
            return NextResponse.json({ content: FETCH_FAILED_CONTENT }, { status: 502 });
        }

        const extracted = extractReadableContent(html);
        const bodyText = extracted.bodyText;

        if (bodyText.length < 300 || isBoilerplateOnly(bodyText)) {
            const text = await renderFallback();
            if (text) return NextResponse.json({ content: text });
            return NextResponse.json({ content: FETCH_FAILED_CONTENT }, { status: 502 });
        }

        if (!extracted.content.trim()) return NextResponse.json({ content: FETCH_FAILED_CONTENT }, { status: 502 });
        await setCached(cacheKey, extracted.content, 'direct');
        return NextResponse.json({ content: extracted.content });
    } catch (error: any) {
        return NextResponse.json({ content: FETCH_FAILED_CONTENT }, { status: 502 });
    }
}
