/**
 * OpenAI URL fallback 회귀 하니스 — 외부 네트워크/시크릿 없이 production 모듈을 직접 검증한다.
 */
import fs from 'node:fs';
import {
    fetchUrlContentWithOpenAI,
    isOpenAIUrlFallbackHost,
    normalizeOpenAIEvidenceUrl,
} from '../server/openai/url-fetch.js';
import {
    DEFAULT_OPENAI_URL_FETCH_MODEL,
    openAIModelCapabilities,
} from '../server/openai/models.js';

let pass = 0;
let fail = 0;

const check = (name: string, condition: boolean, detail = '') => {
    if (condition) {
        pass++;
        console.log(`✅ ${name}`);
    } else {
        fail++;
        console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`);
    }
};

const successText = '# 테스트 문서\n\n' + '실제 본문입니다. '.repeat(40);

const responseJson = (url: string, text = successText) => ({
    status: 'completed',
    output: [
        {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url, sources: [] },
        },
        {
            type: 'message',
            content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url }] }],
        },
    ],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
});

const mockFetch = (json: unknown, status = 200, capture?: (body: Record<string, unknown>) => void): typeof fetch =>
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (capture && typeof init?.body === 'string') capture(JSON.parse(init.body) as Record<string, unknown>);
        return new Response(JSON.stringify(json), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;

check('호스트  Wikidocs 허용', isOpenAIUrlFallbackHost('wikidocs.net'));
check('호스트  Brunch 허용', isOpenAIUrlFallbackHost('brunch.co.kr'));
check('호스트  arca.live 제외', !isOpenAIUrlFallbackHost('arca.live'));
check('URL 정규화  @와 %40 동일',
    normalizeOpenAIEvidenceUrl('https://brunch.co.kr/@writer/1') ===
    normalizeOpenAIEvidenceUrl('https://brunch.co.kr/%40writer/1/?utm_source=openai'));

check('모델  URL fetch 기본값은 gpt-5-mini', DEFAULT_OPENAI_URL_FETCH_MODEL === 'gpt-5-mini');
check('모델  gpt-5-mini web_search reasoning 최저값 low',
    openAIModelCapabilities('gpt-5-mini').reasoningEffort === 'low');
check('모델  미검증 모델은 web_search 자동 활성화 금지',
    openAIModelCapabilities('gpt-5.4-mini').webSearch === false);

let capturedBody: Record<string, unknown> = {};
const targetUrl = 'https://brunch.co.kr/@ghidesigner/532';
const ok = await fetchUrlContentWithOpenAI(targetUrl, {
    apiKey: 'test-key',
    fetchImpl: mockFetch(responseJson('https://brunch.co.kr/%40ghidesigner/532/?utm_source=openai'), 200, body => {
        capturedBody = body;
    }),
});
const reasoning = capturedBody.reasoning as Record<string, unknown> | undefined;
const tools = capturedBody.tools as Array<Record<string, unknown>> | undefined;
const filters = tools?.[0]?.filters as Record<string, unknown> | undefined;
check('성공  정확 URL 본문을 반환', ok.content === successText.trim(), `reason=${ok.reason}`);
check('요청  web_search 호환 reasoning low 명시', reasoning?.effort === 'low');
check('요청  응답 저장 비활성', capturedBody.store === false);
check('요청  웹 검색 강제', capturedBody.tool_choice === 'required');
check('요청  대상 도메인만 허용',
    Array.isArray(filters?.allowed_domains) && filters?.allowed_domains[0] === 'brunch.co.kr');

const mismatch = await fetchUrlContentWithOpenAI(targetUrl, {
    apiKey: 'test-key',
    fetchImpl: mockFetch(responseJson('https://brunch.co.kr/@other/999')),
});
check('방어  다른 URL 본문은 폐기', mismatch.content === null && mismatch.reason === 'url_mismatch');

const blocked = await fetchUrlContentWithOpenAI(targetUrl, {
    apiKey: 'test-key',
    fetchImpl: mockFetch(responseJson(targetUrl, `# Just a moment\n\n${'Cloudflare Ray ID '.repeat(30)}`)),
});
check('방어  보안 페이지는 폐기', blocked.content === null && blocked.reason === 'security_block');

const quota = await fetchUrlContentWithOpenAI(targetUrl, {
    apiKey: 'test-key',
    fetchImpl: mockFetch({
        error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'quota exceeded' },
    }, 429),
});
check('실패  quota를 사용자 본문으로 반환하지 않음', quota.content === null && quota.reason === 'quota');
check('실패  공급자 오류 메시지를 진단용으로 보존', quota.errorMessage === 'quota exceeded');

let missingKeyCalled = false;
const missingKey = await fetchUrlContentWithOpenAI(targetUrl, {
    apiKey: '',
    fetchImpl: (async () => {
        missingKeyCalled = true;
        return new Response();
    }) as typeof fetch,
});
check('실패  키가 없으면 API 호출 없이 종료', missingKey.reason === 'key_missing' && !missingKeyCalled);

const excluded = await fetchUrlContentWithOpenAI('https://arca.live/b/characterai/178349330', {
    apiKey: 'test-key',
    fetchImpl: mockFetch(responseJson('https://arca.live/b/characterai/178349330')),
});
check('실패  미허용 호스트는 OpenAI를 호출하지 않음', excluded.reason === 'host_not_allowed');

const routeSource = fs.readFileSync(new URL('../app/api/fetch-url/route.ts', import.meta.url), 'utf8');
check('배선  OpenAI URL 폴백은 기본 비활성 기능 플래그로 보류',
    routeSource.includes("process.env.OPENAI_URL_FALLBACK_ENABLED === 'true'") &&
    routeSource.includes('OPENAI_URL_FALLBACK_ENABLED && isOpenAIUrlFallbackHost(targetHostname)'));
check('배선  Wikidocs도 OpenAI 직행 없이 ScrapingBee 체인을 우선 사용',
    routeSource.includes('const text = await renderFallback();') &&
    routeSource.indexOf('const sb = await scrapingBeeFetch();') <
        routeSource.indexOf('OPENAI_URL_FALLBACK_ENABLED && isOpenAIUrlFallbackHost(targetHostname)'));

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
