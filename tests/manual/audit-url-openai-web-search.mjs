// Manual paid network probe; deliberately excluded from the automatic `npm test` chain.
import fs from 'node:fs';
import process from 'node:process';
import dotenv from 'dotenv';

for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}

const DEFAULT_URL = 'https://wikidocs.net/blog/@jaehong/8007/';
const FAILURE_TOKEN = 'OPENAI_WEB_FETCH_FAILED';
const SECURITY_PATTERNS = [
  'just a moment',
  'verifying you are not a bot',
  'performing security verification',
  'sorry, you have been blocked',
  'cloudflare ray id',
  'captcha',
];
const ALLOWED_HOSTS = new Set([
  'wikidocs.net',
  'brunch.co.kr',
  'arca.live',
  'news.hada.io',
  'zdnet.co.kr',
]);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'Usage: npm run audit:url-openai -- [options] [url]',
    '',
    'Asks the OpenAI Responses API web_search tool to retrieve one exact audit URL.',
    'This is a paid manual probe and uses OPENAI_API_KEY_TIER1 only.',
    '',
    'Env:',
    '  OPENAI_API_KEY_TIER1 required',
    '  OPENAI_URL_FETCH_TEST_MODEL optional. Default: gpt-5-mini',
    '',
    'Options:',
    '  --model NAME       Override the model',
    '  --timeout-ms N     Local HTTP timeout. Default: 90000',
    '  --max-output-tokens N  Output budget. Default: 3000',
    '  --reasoning-effort E   Override model-specific reasoning effort',
    '  --extract-content      Return cleaned page content instead of a summary',
    '  --sample-chars N   Printed answer sample length. Default: 1200',
    '',
    `Default URL: ${DEFAULT_URL}`,
  ].join('\n'));
  process.exit(0);
}

const optionValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
};

const numericOption = (name, fallback) => {
  const value = Number(optionValue(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const apiKey = process.env.OPENAI_API_KEY_TIER1;
if (!apiKey) {
  console.error('Missing OPENAI_API_KEY_TIER1 in .env.local/.env.');
  process.exit(1);
}

const positionalArgs = process.argv.slice(2).filter((arg, index, args) => {
  if (arg.startsWith('--')) return false;
  return index === 0 || !args[index - 1]?.startsWith('--');
});
const targetUrl = positionalArgs.find(arg => /^https?:\/\//i.test(arg)) || DEFAULT_URL;

let parsedTarget;
try {
  parsedTarget = new URL(targetUrl);
} catch {
  console.error(`Invalid URL: ${targetUrl}`);
  process.exit(1);
}

const hostname = parsedTarget.hostname.toLowerCase();
if (parsedTarget.protocol !== 'https:' || !ALLOWED_HOSTS.has(hostname)) {
  console.error(`Host is not in the URL audit allowlist: ${targetUrl}`);
  process.exit(1);
}

const model = optionValue('--model', process.env.OPENAI_URL_FETCH_TEST_MODEL || 'gpt-5-mini');
const timeoutMs = numericOption('--timeout-ms', 90000);
const maxOutputTokens = numericOption('--max-output-tokens', 3000);
const originalGpt5Model = /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/i.test(model);
const defaultReasoningEffort = originalGpt5Model ? 'minimal' : (/^gpt-5/i.test(model) ? 'none' : 'low');
const reasoningEffort = optionValue('--reasoning-effort', defaultReasoningEffort);
const sampleChars = numericOption('--sample-chars', 1200);
const extractContent = process.argv.includes('--extract-content');
const supportsReasoning = /^(gpt-5|o\d)/i.test(model);
const supportsDomainFilters = !/^gpt-4\.1/i.test(model);

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.pathname = decodeURIComponent(url.pathname);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return '';
  }
}

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text.trim();
  return (response.output ?? [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text ?? '')
    .join('\n')
    .trim();
}

function collectEvidence(response) {
  const webSearchCalls = (response.output ?? [])
    .filter(item => item.type === 'web_search_call')
    .map(item => ({
      status: item.status,
      actionType: item.action?.type,
      url: item.action?.url,
      sources: item.action?.sources ?? [],
    }));
  const annotations = (response.output ?? [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .flatMap(part => part.annotations ?? []);
  const sourceUrls = [
    ...webSearchCalls.map(call => call.url),
    ...webSearchCalls.flatMap(call => call.sources.map(source => source.url)),
    ...annotations.map(annotation => annotation.url),
  ].filter(Boolean);
  return { webSearchCalls, sourceUrls: [...new Set(sourceUrls)] };
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
const started = Date.now();

try {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      tools: [{
        type: 'web_search',
        ...(supportsDomainFilters ? { filters: { allowed_domains: [hostname] } } : {}),
      }],
      tool_choice: 'required',
      max_tool_calls: 1,
      max_output_tokens: maxOutputTokens,
      ...(supportsReasoning ? { reasoning: { effort: reasoningEffort } } : {}),
      include: ['web_search_call.action.sources'],
      input: extractContent ? [
        `Retrieve this exact URL: ${targetUrl}`,
        'Do not substitute a similarly titled page, search result, or another URL.',
        `If the exact URL cannot be retrieved, answer exactly: ${FAILURE_TOKEN}`,
        'Return only the page title and its substantive content as clean Markdown.',
        'Preserve headings, paragraphs, lists, tables, links, and code when present.',
        'Exclude navigation, advertisements, cookie notices, and your own commentary. Do not summarize.',
      ].join('\n') : [
        `Retrieve this exact URL and summarize only its page: ${targetUrl}`,
        'Do not substitute a similarly titled page, search result, or another URL.',
        `If the exact URL cannot be retrieved, answer exactly: ${FAILURE_TOKEN}`,
        'Return the page title and five concise key points.',
      ].join('\n'),
    }),
  });
  const json = await response.json();
  const text = outputText(json);
  const evidence = collectEvidence(json);
  const requestedNormalized = normalizedUrl(targetUrl);
  const exactUrlEvidence = evidence.sourceUrls.some(url => normalizedUrl(url) === requestedNormalized);
  const webSearchCompleted = evidence.webSearchCalls.some(call => call.status === 'completed');
  const securityBlock = SECURITY_PATTERNS.some(pattern => text.toLowerCase().includes(pattern));
  const contentReturned = text.length > 0 && !text.includes(FAILURE_TOKEN) && !securityBlock;
  const success = response.ok && webSearchCompleted && contentReturned && exactUrlEvidence;

  console.log(JSON.stringify({
    success,
    status: response.status,
    responseStatus: json.status,
    incompleteDetails: json.incomplete_details,
    elapsedMs: Date.now() - started,
    model,
    mode: extractContent ? 'extract-content' : 'summary',
    targetUrl,
    exactUrlEvidence,
    webSearchCompleted,
    securityBlock,
    contentReturned,
    textChars: text.length,
    textSample: text.slice(0, sampleChars),
    sourceUrls: evidence.sourceUrls,
    webSearchCalls: evidence.webSearchCalls,
    usage: json.usage,
    error: json.error,
  }, null, 2));
  if (!success) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    elapsedMs: Date.now() - started,
    model,
    targetUrl,
    error: error?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : (error?.message ?? String(error)),
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
