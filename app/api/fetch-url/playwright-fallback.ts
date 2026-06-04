import chromiumBinary from '@sparticuz/chromium';
import { chromium, type Page } from 'playwright-core';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

chromiumBinary.setGraphicsMode = false;

const TARGET_SELECTORS = [
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

const SECURITY_PATTERNS = [
    'just a moment',
    'performing security verification',
    'security service to protect',
    'warning: target url returned error 403',
    'warning: this page maybe requiring captcha',
    'verifying you are not a bot',
    'please enable cookies',
];

let activeBrowserJobs = 0;
const pendingBrowserJobs: Array<() => void> = [];
const MAX_BROWSER_JOBS = 1;

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

const isSecurityBlock = (text: string) => {
    const lower = text.toLowerCase();
    return SECURITY_PATTERNS.some(pattern => lower.includes(pattern));
};

const acquireBrowserSlot = async (timeoutMs = 10000) => {
    if (activeBrowserJobs < MAX_BROWSER_JOBS) {
        activeBrowserJobs += 1;
        return;
    }

    await new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout>;
        const resolveSlot = () => {
            clearTimeout(timeout);
            resolve();
        };
        timeout = setTimeout(() => {
            const index = pendingBrowserJobs.indexOf(resolveSlot);
            if (index >= 0) pendingBrowserJobs.splice(index, 1);
            reject(new Error('Playwright fallback queue timeout'));
        }, timeoutMs);
        pendingBrowserJobs.push(resolveSlot);
    });
};

const releaseBrowserSlot = () => {
    const next = pendingBrowserJobs.shift();
    if (next) {
        next();
        return;
    }
    activeBrowserJobs = Math.max(0, activeBrowserJobs - 1);
};

const waitForContentSelector = async (page: Page, timeoutMs = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const found = await page.evaluate(selectors => {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (!element) continue;
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length >= 300) return selector;
            }
            return null;
        }, TARGET_SELECTORS).catch(() => null);

        if (found) return found;
        await page.waitForTimeout(150);
    }

    return null;
};

const extractBestText = async (page: Page) => {
    for (const selector of TARGET_SELECTORS) {
        const count = await page.locator(selector).count().catch(() => 0);
        if (count === 0) continue;

        const text = await page.locator(selector).first().innerText({ timeout: 3000 }).catch(() => '');
        const normalized = normalizeText(text);
        if (normalized.length >= 300) return { selector, text: normalized };
    }

    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    return { selector: 'body', text: normalizeText(bodyText) };
};

export const fetchRenderedUrlContent = async (url: string) => {
    let browser;
    let slotAcquired = false;
    try {
        await acquireBrowserSlot();
        slotAcquired = true;

        browser = await chromium.launch({
            args: chromiumBinary.args,
            executablePath: await chromiumBinary.executablePath(),
            timeout: 10000,
        });

        const context = await browser.newContext({
            locale: 'ko-KR',
            userAgent: USER_AGENT,
            viewport: { width: 1365, height: 900 },
        });

        await context.route('**/*', route => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font'].includes(type)) return route.abort();
            return route.continue();
        });

        try {
            const page = await context.newPage();
            const response = await page.goto(url, { waitUntil: 'commit', timeout: 15000 });
            await waitForContentSelector(page);

            const title = normalizeText(await page.title().catch(() => ''));
            const extracted = await extractBestText(page);

            if (!response?.ok() || extracted.text.length < 300 || isSecurityBlock(`${title}\n${extracted.text}`)) {
                console.warn('[fetch-url] Playwright fallback failed', {
                    url,
                    status: response?.status(),
                    selector: extracted.selector,
                    textChars: extracted.text.length,
                });
                return null;
            }

            const content = title ? `제목: ${title}\n\n${extracted.text}` : extracted.text;
            console.info('[fetch-url] Playwright fallback succeeded', {
                url,
                status: response.status(),
                selector: extracted.selector,
                textChars: extracted.text.length,
            });
            return content.slice(0, 17000);
        } finally {
            await context.close().catch(() => {});
        }
    } catch (error: any) {
        console.warn('[fetch-url] Playwright fallback error', {
            url,
            error: error?.message ?? String(error),
        });
        return null;
    } finally {
        await browser?.close().catch(() => {});
        if (slotAcquired) releaseBrowserSlot();
    }
};
