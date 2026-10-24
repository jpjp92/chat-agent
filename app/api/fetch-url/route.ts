import { NextRequest, NextResponse } from 'next/server';
import { assertPublicUrl, safeFetch, SsrfError } from '../../../server/ssrf';
import { isPdfResponse, isPdfText } from '../../../server/pdf-sniff';
import { extractPdfTextOnServer } from '../../../server/pdf-text-node';

// 대체 스크래퍼가 PDF 바이너리를 글자로 돌려준 경우의 표지 — 캐시에 넣지 않고 isPdf 로 응답한다.
const PDF_DETECTED = '\u0000PDF_DETECTED';
import { supabase, supabaseAdmin } from '../../../server/supabase';
import { requireProfile } from '../../../lib/supabase/route';
import { consumeAuxQuota } from '../../../server/aux-quota';
import { BROWSER_UA } from '../../../server/browser-ua';
import { fetchUrlContentWithOpenAI, isOpenAIUrlFallbackHost } from '../../../server/openai/url-fetch';

export const runtime = 'nodejs';
export const maxDuration = 120;

const FETCH_FAILED_CONTENT = '[FETCH_ERROR: 해당 페이지는 보안 정책, 접속 제한 또는 사이트 차단으로 인해 서버에서 직접 접근할 수 없습니다.]';
const SCRAPINGBEE_TIMEOUT_MS = 40000;
const SCRAPINGBEE_STATIC_TIMEOUT_MS = 15000; // no render_js — SSR 사이트용 빠른 경로
const BROWSERLESS_TIMEOUT_MS = 30000;
const BROWSERLESS_BASE = (process.env.BROWSERLESS_REST_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, '');
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14일
// 실험 중인 OpenAI web_search 폴백은 명시적으로 켠 환경에서만 사용한다.
// 기본값은 OFF: Wikidocs는 ScrapingBee(render/premium/KR)를 우선 사용한다.
const OPENAI_URL_FALLBACK_ENABLED = process.env.OPENAI_URL_FALLBACK_ENABLED === 'true';

// cache 쓰기는 서비스키 우선(없으면 anon). 근거: docs/logs/DEV_260606.md §11
const db = supabaseAdmin ?? supabase;


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

/**
 * 프로바이더의 쿼터·인증 실패(401/402/429)를 일반 실패와 구분해 로그에 남긴다.
 * 본문이 없는 것과 크레딧이 없는 것을 같은 문장으로 찍으면 원인을 엉뚱한 데서 찾게 된다.
 * 폴백으로 흘러가 동작은 멀쩡해 보이므로 상태코드를 그대로 드러낸다 → DEV_260822
 */
const logProviderAuthFailure = (provider: string, status: number, body: string, url: string): boolean => {
    if (status !== 401 && status !== 402 && status !== 429) return false;
    const reason = status === 401 ? '인증/쿼터' : status === 402 ? '결제·크레딧' : '레이트리밋';
    console.error(`[fetch-url] 🔴 ${provider} ${status} (${reason}) — 사이트 차단이 아니라 **우리 계정 문제**다:`,
        body.slice(0, 200), { url });
    return true;
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

/**
 * 캐시 실패를 삼키지 않는다.
 * 캐시는 best-effort 지만 실패(테이블 없음·upsert 오류)를 캐시 미스와 같은 값으로 만들면
 * 매 요청이 유료 스크래퍼를 태워도 아무도 모른다. 동작은 그대로 두고 실패만 로그로 드러낸다
 *   - `getCached`: 오류와 미스를 구분해 기록
 *   - `setCached`: upsert 반환 `error` 를 기록 → DEV_260817
 */
const getCached = async (key: string): Promise<string | null> => {
    try {
        const { data, error } = await db.from('url_cache').select('content, fetched_at').eq('url_key', key).maybeSingle();
        if (error) {
            console.error('[fetch-url] 캐시 조회 실패 — 매번 스크래퍼를 태우게 된다:', error.message, error.code ?? '');
            return null;
        }
        if (!data) return null;   // 진짜 미스
        if (Date.now() - new Date(data.fetched_at).getTime() > CACHE_TTL_MS) return null;
        return data.content as string;
    } catch (e) {
        console.error('[fetch-url] 캐시 조회 예외:', e instanceof Error ? e.message : e);
        return null;
    }
};

const setCached = async (key: string, content: string, provider: string): Promise<void> => {
    try {
        const { error } = await db.from('url_cache').upsert(
            { url_key: key, content, status: 'ok', provider, fetched_at: new Date().toISOString() },
            { onConflict: 'url_key' },
        );
        // 쓰기가 계속 실패하면 히트율이 영원히 0 이다 — 조용히 두면 안 된다
        if (error) console.error('[fetch-url] 캐시 쓰기 실패 — 히트율 0 이 된다:', error.message, error.code ?? '');
    } catch (e) {
        console.error('[fetch-url] 캐시 쓰기 예외:', e instanceof Error ? e.message : e);
    }
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

// 직접 받기 상한 — 10초 abort 만으로는 Vercel 대역폭에서 수백 MB 를 받을 수 있다(PLAN_SECURITY_REVIEW_261023 #3).
// 30MB: 큰 보고서 PDF 도 덮는다. 텍스트 추출은 20만 자에서 멈춰(lib/pdf-text.ts) 크기만큼 파싱이 늘지 않는다.
const MAX_DIRECT_BYTES = 30 * 1024 * 1024;

/** 상한까지만 읽는다. Content-Length 가 이미 넘으면 본문 앞부분(형식 판별용)만 읽고 끊는다. */
async function readCapped(res: Response, max: number): Promise<{ buf: Uint8Array; truncated: boolean }> {
    const declared = Number(res.headers.get('content-length') || 0);
    const limit = declared > max ? 1024 : max;
    const reader = res.body?.getReader();
    if (!reader) return { buf: new Uint8Array(), truncated: false };
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = declared > max;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total > limit) { truncated = true; await reader.cancel().catch(() => {}); break; }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return { buf, truncated };
}

export async function POST(req: NextRequest) {
    // 유료 폴백(browserless·ScrapingBee·OpenAI)과 service_role 캐시 쓰기를 가진 라우트다 — 인증을 맨 앞에.
    // 캐시 히트도 인증 뒤: 캐시 응답만으로도 공개 프록시처럼 쓸 수 있다 → PLAN_PUBLIC_ROUTE_AUTH_261017
    const auth = await requireProfile(req, 'fetch-url');
    if (auth.res) return auth.res;

    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    try {
        await assertPublicUrl(url);
    } catch (e) {
        return NextResponse.json({ error: e instanceof SsrfError && e.message !== 'invalid url' ? 'URL not allowed' : 'Invalid URL' }, { status: 400 });
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

        const quotaRes = await consumeAuxQuota(auth, 'fetch_url', 'fetch-url');
        if (quotaRes) return quotaRes;

        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const oembedCtrl = new AbortController();
            const pageCtrl = new AbortController();
            const t1 = setTimeout(() => oembedCtrl.abort(), 8000);
            const t2 = setTimeout(() => pageCtrl.abort(), 10000);

            const [oembedResult, pageResult] = await Promise.allSettled([
                fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: oembedCtrl.signal }),
                safeFetch(targetUrl, { signal: pageCtrl.signal }),
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

        // 보류 중인 Brunch/Wikidocs 보조 공급자. 기본값은 OFF이며, ScrapingBee와 browserless가
        // 모두 실패한 뒤 OPENAI_URL_FALLBACK_ENABLED=true인 경우에만 호출한다.
        const openAIUrlFallback = async (): Promise<string | null> => {
            const result = await fetchUrlContentWithOpenAI(targetUrl);
            if (result.content) {
                console.info('[fetch-url] OpenAI URL fallback succeeded', {
                    url: targetUrl,
                    model: result.model,
                    elapsedMs: result.elapsedMs,
                    textChars: result.textChars,
                    exactUrlEvidence: result.exactUrlEvidence,
                    usage: result.usage,
                });
                await setCached(cacheKey, result.content, 'openai-web-search');
                return result.content;
            }
            console.error('[fetch-url] OpenAI URL fallback failed ' + JSON.stringify({
                url: targetUrl,
                model: result.model,
                elapsedMs: result.elapsedMs,
                status: result.status,
                reason: result.reason,
                errorCode: result.errorCode,
                errorType: result.errorType,
                errorMessage: result.errorMessage,
            }));
            return null;
        };

        let html = '';
        // wikidocs는 Cloudflare가 항상 403 "Just a moment" 챌린지를 반환 → direct fetch 10s는 순수 낭비.
        // 캐시 미스면 바로 ScrapingBee(render_js + premium_proxy + KR) 경로로 보낸다.
        let directFetchBlocked = useCloudflareUnblock;
        if (!useCloudflareUnblock) {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 10000);
            try {
                const response = await safeFetch(targetUrl, {
                    signal: ctrl.signal,
                    headers: {
                        'User-Agent': BROWSER_UA,
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                    },
                });
                // 다운로드형 PDF(`callDownload.do` 등)는 확장자로 못 알아본다 — Content-Type 없이
                // `Content-Disposition: attachment; filename="….pdf"` + `%PDF-` 본문만 주는 서버가 있다.
                // text() 로 읽으면 바이너리가 HTML 스크래핑으로 흘러 깨진 글자가 요약되므로, PDF 면 본문 대신
                // isPdf 만 돌려주고 클라이언트가 URL 을 PDF 링크로 붙인다(두 모델 모두 이 URL 을 직접 읽는다) → DEV_261014
                const { buf, truncated } = await readCapped(response, MAX_DIRECT_BYTES);
                if (truncated) {
                    // 큰 PDF 는 서버에서 텍스트층을 만들지 않는다(파싱은 취소가 안 돼 함수 시간을 붙잡는다).
                    // 첫 턴은 모델이 URL 을 직접 읽으므로 isPdf 만 알려 준다 — 후속 턴 근거만 빠진다.
                    if (response.ok && isPdfResponse(response.headers, buf)) {
                        console.warn('[fetch-url] PDF over byte cap — skipping text layer', { url: targetUrl, cap: MAX_DIRECT_BYTES });
                        return NextResponse.json({ isPdf: true, content: '' });
                    }
                    console.warn('[fetch-url] body over byte cap', { url: targetUrl, cap: MAX_DIRECT_BYTES });
                    return NextResponse.json({ error: 'Content too large' }, { status: 413 });
                }
                if (response.ok && isPdfResponse(response.headers, buf)) {
                    // 바이트를 이미 받았으니 텍스트층도 여기서 — 후속 턴 근거(lastActiveDoc.pdfText). 첫 턴은 URL 그대로 모델이 읽는다.
                    const pdfText = await extractPdfTextOnServer(buf);
                    console.info('[fetch-url] PDF download detected', { url: targetUrl, bytes: buf.length, pdfTextChars: pdfText.length });
                    return NextResponse.json({ isPdf: true, content: '', pdfText });
                }
                html = new TextDecoder().decode(buf);
                if (!response.ok || isSecurityBlock(html) || html.match(/<title[^>]*>\s*just a moment/i)) directFetchBlocked = true;
            } catch (e: any) {
                console.warn('[fetch-url] direct fetch failed', { url: targetUrl, error: e?.message });
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
                    if (!logProviderAuthFailure('browserless', res.status, raw, targetUrl)) {
                        console.warn('[fetch-url] browserless non-ok', { url: targetUrl, status: res.status, sample: raw.slice(0, 120) });
                    }
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

        // ScraperAPI 는 체인에서 뺐다 — 보호 도메인은 premium 파라미터 없이는 실패하고 타임아웃 예산만 먹는다.
        // 되살리려면 premium 파라미터가 선행 조건이다(구현은 git 이력) → DEV_260822

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
                if (!logProviderAuthFailure('ScrapingBee(static)', res.status, renderedHtml, targetUrl)) {
                    console.warn('[fetch-url] ScrapingBee(static) failed', { url: targetUrl, status: res.status, textChars: extracted.bodyText.length, securityBlock, boilerplate, cost });
                }
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] ScrapingBee(static) error', { url: targetUrl, error: error?.message ?? String(error) });
                return null;
            } finally {
                clearTimeout(sbt);
            }
        };

        // ScrapingBee render_js (render_js + premium_proxy) — wikidocs 등 Cloudflare 챌린지·SPA 사이트용.
        // 느리지만(~15-40s) JS 렌더링이 필요할 때 쓴다.
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
                if (!logProviderAuthFailure('ScrapingBee(render)', res.status, renderedHtml, targetUrl)) {
                    console.warn('[fetch-url] ScrapingBee(render) failed', { url: targetUrl, status: res.status, textChars: extracted.bodyText.length, securityBlock, boilerplate, cost, sample: extracted.bodyText.slice(0, 180) });
                }
                return null;
            } catch (error: any) {
                console.warn('[fetch-url] ScrapingBee(render) error', { url: targetUrl, timeoutMs: SCRAPINGBEE_TIMEOUT_MS, error: error?.message ?? String(error) });
                return null;
            } finally {
                clearTimeout(sbt);
            }
        };

        /**
         * 범용 폴백 체인. 모든 호스트가 같은 프로바이더 사다리를 탄다.
         * Wikidocs(상시 CF 챌린지)는 실패가 확정된 static 단계를 건너뛰고 ScrapingBee(render/premium/KR)부터 시작한다.
         * 한 프로바이더 쿼터가 소진돼도 다음 프로바이더로 넘어가야 하므로 호스트별로 사다리를 잠그지 않는다 → DEV_260822
         *
         * 주의: 체인이 끝까지 돌면 최대 `10+15+40+30 = 95s` 인데 클라이언트 타임아웃은 65s 다
         * (`services/geminiService.ts`). 전체 deadline 설계는 별도 과제(TODO §5-d).
         */
        const renderFallback = async (): Promise<string | null> => {
            // CF 상시 챌린지 호스트(wikidocs)는 static 을 건너뛴다 — 항상 챌린지라 순수 낭비다.
            if (!useCloudflareUnblock) {
                const sbStatic = await scrapingBeeStaticFetch();
                if (sbStatic && isPdfText(sbStatic)) return PDF_DETECTED;
                if (sbStatic) { await setCached(cacheKey, sbStatic, 'scrapingbee-static'); return sbStatic; }
            }
            const sb = await scrapingBeeFetch();
            if (sb && isPdfText(sb)) return PDF_DETECTED;
            if (sb) { await setCached(cacheKey, sb, 'scrapingbee'); return sb; }
            const bl = await browserlessFetch();
            if (bl && isPdfText(bl)) return PDF_DETECTED;
            if (bl) { await setCached(cacheKey, bl, 'browserless'); return bl; }
            if (OPENAI_URL_FALLBACK_ENABLED && isOpenAIUrlFallbackHost(targetHostname)) {
                const openAIText = await openAIUrlFallback();
                if (openAIText) return openAIText;
            }
            console.error('[fetch-url] 🔴 폴백 전멸 — ScrapingBee·browserless 둘 다 실패했다:', { url: targetUrl });
            return null;
        };

        if (directFetchBlocked) {
            const text = await renderFallback();
            if (text === PDF_DETECTED) return NextResponse.json({ isPdf: true, content: '' });
            if (text) return NextResponse.json({ content: text });
            return NextResponse.json({ content: FETCH_FAILED_CONTENT }, { status: 502 });
        }

        const extracted = extractReadableContent(html);
        const bodyText = extracted.bodyText;

        if (bodyText.length < 300 || isBoilerplateOnly(bodyText)) {
            const text = await renderFallback();
            if (text === PDF_DETECTED) return NextResponse.json({ isPdf: true, content: '' });
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
