// Manual network probe; deliberately excluded from the automatic `npm test` chain.
import fs from 'node:fs';
import process from 'node:process';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}

const DEFAULT_URL = 'https://wikidocs.net/blog/@jaehong/8007/';
const SELECTORS = [
  '.page-content',
  'article',
  'main',
  '#book_content',
  '#content',
  '#contents',
  '.book-content',
  '.wiki-content',
  '.post-content',
  '.entry-content',
  '.content',
  'body',
];
const REMOVE_SELECTORS = 'script, style, nav, header, footer, aside, iframe, noscript, figure, form';
const SECURITY_PATTERNS = [
  'just a moment',
  'performing security verification',
  'security service to protect',
  'warning: target url returned error 403',
  'warning: this page maybe requiring captcha',
  'verifying you are not a bot',
  'please enable cookies',
  'attention required! | cloudflare',
  'sorry, you have been blocked',
  'cloudflare ray id',
  '보안 확인 수행 중',
  '악의적인 봇',
  '잠시만 기다리십시오',
];
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'Usage: npm run audit:wikidocs-puppeteer -- [options] [url...]',
    '',
    'Fetches each Wikidocs URL once with Puppeteer in Browserless /function, then compares:',
    '  1) Puppeteer DOM extraction inside the remote browser',
    '  2) Cheerio extraction from the exact same returned HTML snapshot',
    '',
    'Env:',
    '  BROWSERLESS_KEY or BROWSERLESS_TOKEN',
    '  BROWSERLESS_REST_URL optional. Default: https://production-sfo.browserless.io',
    '',
    'Options:',
    '  --residential       Add proxy=residential to the Browserless call',
    '  --timeout-ms N      Local HTTP timeout. Default: 60000',
    '  --goto-timeout-ms N page.goto timeout inside Browserless. Default: 30000',
    '  --wait-timeout-ms N Wait for a >=300-char content selector. Default: 10000',
    '  --sample-chars N    Printed text sample length. Default: 500',
    '',
    `Default URL: ${DEFAULT_URL}`,
  ].join('\n'));
  process.exit(0);
}

const token = process.env.BROWSERLESS_KEY || process.env.BROWSERLESS_TOKEN;
if (!token) {
  console.error('Missing BROWSERLESS_KEY or BROWSERLESS_TOKEN in .env.local/.env.');
  process.exit(1);
}

const optionValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const urls = process.argv.slice(2).filter(arg => /^https?:\/\//i.test(arg));
if (urls.length === 0) urls.push(DEFAULT_URL);

for (const value of urls) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`Invalid URL: ${value}`);
    process.exit(1);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || (hostname !== 'wikidocs.net' && !hostname.endsWith('.wikidocs.net'))) {
    console.error(`Only https://wikidocs.net URLs are allowed: ${value}`);
    process.exit(1);
  }
}

const baseUrl = (process.env.BROWSERLESS_REST_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, '');
const timeoutMs = optionValue('--timeout-ms', 60000);
const gotoTimeoutMs = optionValue('--goto-timeout-ms', 30000);
const waitTimeoutMs = optionValue('--wait-timeout-ms', 10000);
const sampleChars = optionValue('--sample-chars', 500);

const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function isSecurityBlock(value) {
  const text = normalizeText(value).toLowerCase();
  return SECURITY_PATTERNS.some(pattern => text.includes(pattern));
}

function isResolvedUrlAllowed(requestedUrl, resolvedUrl) {
  try {
    const requested = new URL(requestedUrl);
    const resolved = new URL(resolvedUrl);
    const requestedHost = requested.hostname.toLowerCase();
    const resolvedHost = resolved.hostname.toLowerCase();
    const sameWikidocsHost = requestedHost === resolvedHost ||
      (requestedHost.endsWith('.wikidocs.net') && resolvedHost.endsWith('.wikidocs.net'));
    const fellBackToHome = requested.pathname !== '/' && resolved.pathname === '/';
    return resolved.protocol === 'https:' && sameWikidocsHost && !fellBackToHome;
  } catch {
    return false;
  }
}

function extractWithCheerio(html) {
  const $ = cheerio.load(String(html ?? ''));
  $(REMOVE_SELECTORS).remove();

  const candidates = [];
  for (const selector of SELECTORS) {
    $(selector).each((_, element) => {
      const text = normalizeText($(element).text());
      if (text) candidates.push({ selector, text });
    });
  }
  candidates.sort((a, b) => b.text.length - a.text.length);

  return {
    selector: candidates[0]?.selector || 'none',
    text: candidates[0]?.text || '',
    title: normalizeText($('meta[property="og:title"]').attr('content') || $('title').first().text()),
  };
}

function browserlessEndpoint() {
  const params = new URLSearchParams({ token });
  if (process.argv.includes('--residential')) params.set('proxy', 'residential');
  return `${baseUrl}/function?${params.toString()}`;
}

const browserCode = `
export default async function ({ page, context }) {
  const selectors = context.selectors;
  const removeSelectors = context.removeSelectors;
  await page.setUserAgent(context.userAgent);
  await page.setExtraHTTPHeaders({
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const type = request.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') request.abort();
    else request.continue();
  });

  let navigationStatus = 0;
  let navigationError = '';
  try {
    const response = await page.goto(context.url, {
      waitUntil: 'domcontentloaded',
      timeout: context.gotoTimeoutMs,
    });
    navigationStatus = response ? response.status() : 0;
  } catch (error) {
    navigationError = error && error.message ? error.message : String(error);
  }

  let waitError = '';
  try {
    await page.waitForFunction(
      selectors => selectors.some(selector =>
        Array.from(document.querySelectorAll(selector)).some(element =>
          (element.textContent || '').replace(/\\s+/g, ' ').trim().length >= 300
        )
      ),
      { timeout: context.waitTimeoutMs },
      selectors,
    );
  } catch (error) {
    waitError = error && error.message ? error.message : String(error);
  }

  const extracted = await page.evaluate(({ selectors, removeSelectors }) => {
    const candidates = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll(removeSelectors).forEach(child => child.remove());
        const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text) candidates.push({ selector, text });
      }
    }
    candidates.sort((a, b) => b.text.length - a.text.length);
    return {
      selector: candidates[0] ? candidates[0].selector : 'none',
      text: candidates[0] ? candidates[0].text : '',
      title: (document.querySelector('meta[property="og:title"]')?.content || document.title || '').trim(),
      finalUrl: location.href,
    };
  }, { selectors, removeSelectors });

  return {
    data: {
      ...extracted,
      html: await page.content(),
      navigationStatus,
      navigationError,
      waitError,
    },
    type: 'application/json',
  };
}`;

async function fetchSnapshot(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(browserlessEndpoint(), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: browserCode,
        context: {
          url: targetUrl,
          selectors: SELECTORS,
          removeSelectors: REMOVE_SELECTORS,
          userAgent: USER_AGENT,
          gotoTimeoutMs,
          waitTimeoutMs,
        },
      }),
    });
    const raw = await response.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Browserless returned non-JSON (${response.status}): ${normalizeText(raw).slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`Browserless HTTP ${response.status}: ${normalizeText(raw).slice(0, 500)}`);
    }
    return { data: json.data || json, elapsedMs: Date.now() - started, providerStatus: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function resultRow(mode, targetUrl, snapshot, extracted) {
  const securityBlock = isSecurityBlock(`${extracted.title}\n${extracted.text}`);
  const resolvedUrlAllowed = isResolvedUrlAllowed(targetUrl, snapshot.finalUrl);
  const targetStatusOk = snapshot.navigationStatus >= 200 && snapshot.navigationStatus < 400;
  return {
    mode,
    ok: targetStatusOk && resolvedUrlAllowed && extracted.text.length >= 300 && !securityBlock,
    targetStatus: snapshot.navigationStatus,
    resolvedUrlAllowed,
    selector: extracted.selector,
    chars: extracted.text.length,
    securityBlock,
    title: extracted.title,
  };
}

async function main() {
  let failed = false;

  for (const targetUrl of urls) {
    console.log(`\nURL: ${targetUrl}`);
    try {
      const { data: snapshot, elapsedMs, providerStatus } = await fetchSnapshot(targetUrl);
      const puppeteer = {
        selector: snapshot.selector || 'none',
        text: normalizeText(snapshot.text),
        title: normalizeText(snapshot.title),
      };
      const cheerioResult = extractWithCheerio(snapshot.html);
      const rows = [
        resultRow('puppeteer-dom', targetUrl, snapshot, puppeteer),
        resultRow('puppeteer+cheerio', targetUrl, snapshot, cheerioResult),
      ];

      console.table(rows);
      console.log(JSON.stringify({
        providerStatus,
        elapsedMs,
        requestedUrl: targetUrl,
        finalUrl: snapshot.finalUrl,
        navigationStatus: snapshot.navigationStatus,
        navigationError: snapshot.navigationError || null,
        waitError: snapshot.waitError || null,
        htmlChars: String(snapshot.html ?? '').length,
        sameNormalizedText: puppeteer.text === cheerioResult.text,
        residential: process.argv.includes('--residential'),
      }, null, 2));
      console.log('puppeteer sample:', puppeteer.text.slice(0, sampleChars));
      console.log('cheerio sample:  ', cheerioResult.text.slice(0, sampleChars));

      if (!rows.some(row => row.ok)) failed = true;
    } catch (error) {
      failed = true;
      console.error(JSON.stringify({
        ok: false,
        url: targetUrl,
        error: error?.message ?? String(error),
        residential: process.argv.includes('--residential'),
      }, null, 2));
    }
  }

  if (failed) process.exitCode = 1;
}

main();
