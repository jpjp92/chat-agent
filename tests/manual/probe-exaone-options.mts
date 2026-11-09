/**
 * K-EXAONE 요청 옵션 확인 — 추론 끄기·JSON 출력 강제가 되는지, 단건 지연은 얼마인지
 *
 *   npx tsx tests/manual/probe-exaone-options.mts          # 변형마다 1회(무료 API, 합성 질문만)
 *   npx tsx tests/manual/probe-exaone-options.mts --dry    # 호출 0회, 변형 목록만
 *
 * 호스팅 API(api.exaone.ai) 공식 문서에서 파라미터를 못 찾아 실제 응답으로 확인한다.
 * 출력은 상태·지연·토큰·finish_reason·JSON 파싱 여부·본문 앞부분만. 추론 원문은 길이만 센다. 키는 출력하지 않는다.
 */
import fs from 'node:fs';
for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}

const URL = 'https://api.exaone.ai/v1/chat/completions';
const MODEL = 'k-exaone_v2.5';
const DRY = process.argv.includes('--dry');
const KEY = process.env.EXAONE_API_KEY;
if (!DRY && !KEY) { console.error('EXAONE_API_KEY 없음'); process.exit(1); }

// 라우터와 같은 모양의 짧은 분류 지시(운영 프롬프트 아님 — 옵션 확인용)
const SYSTEM = `You are an intent router. Reply with ONLY a JSON object, no prose:
{"intent": one of ["weather","general","paper_search","drug_info"], "needs_search": boolean, "follow_up": boolean}`;
const USER = '오늘 서울 날씨 어때?';
const SCHEMA = {
    type: 'json_schema',
    json_schema: {
        name: 'route', strict: true,
        schema: {
            type: 'object', additionalProperties: false, required: ['intent', 'needs_search', 'follow_up'],
            properties: { intent: { type: 'string', enum: ['weather', 'general', 'paper_search', 'drug_info'] }, needs_search: { type: 'boolean' }, follow_up: { type: 'boolean' } },
        },
    },
};

type Variant = { name: string; extra: Record<string, unknown>; stream?: boolean };
const VARIANTS: Variant[] = [
    { name: 'low (기준)', extra: { reasoning_effort: 'low' } },
    { name: 'effort=none', extra: { reasoning_effort: 'none' } },
    { name: 'effort=minimal', extra: { reasoning_effort: 'minimal' } },
    { name: 'enable_thinking=false', extra: { chat_template_kwargs: { enable_thinking: false } } },
    { name: 'low + json_object', extra: { reasoning_effort: 'low', response_format: { type: 'json_object' } } },
    { name: 'low + json_schema', extra: { reasoning_effort: 'low', response_format: SCHEMA } },
    { name: 'think off + json_schema', extra: { chat_template_kwargs: { enable_thinking: false }, response_format: SCHEMA } },
    { name: 'think off + temp 0', extra: { chat_template_kwargs: { enable_thinking: false }, temperature: 0 } },
    { name: 'low stream', extra: { reasoning_effort: 'low' }, stream: true },
];

const short = (s: string, n = 160) => s.replace(/\s+/g, ' ').slice(0, n);
const parses = (s: string) => { try { JSON.parse(s.trim().replace(/^```(?:json)?|```$/g, '').trim()); return true; } catch { return false; } };

const run = async (v: Variant) => {
    const body = { model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: USER }], max_tokens: 1024, stream: !!v.stream, ...(v.stream ? { stream_options: { include_usage: true } } : {}), ...v.extra };
    const t0 = performance.now();
    let res: Response;
    try {
        res = await fetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch (e) {
        return { name: v.name, status: 'ERR', err: (e as Error).name, ms: Math.round(performance.now() - t0) };
    }
    const rate = ['x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'retry-after'].map(h => res.headers.get(h)).filter(Boolean).join('/');
    if (!res.ok) return { name: v.name, status: res.status, ms: Math.round(performance.now() - t0), err: short(await res.text(), 240), rate };
    let content = '', reasoningChars = 0, finish = '', usage: Record<string, unknown> | undefined, firstContentMs: number | undefined;
    if (v.stream) {
        const dec = new TextDecoder(); let buf = '';
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            buf += dec.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (data === '[DONE]') continue;
                const j = JSON.parse(data);
                if (j.usage) usage = j.usage;
                const ch = j.choices?.[0];
                if (ch?.delta?.content) { content += ch.delta.content; firstContentMs ??= Math.round(performance.now() - t0); }
                if (ch?.delta?.reasoning_content) reasoningChars += ch.delta.reasoning_content.length;
                if (ch?.finish_reason) finish = ch.finish_reason;
            }
        }
    } else {
        const j = await res.json();
        const m = j.choices?.[0]?.message ?? {};
        content = m.content ?? ''; reasoningChars = (m.reasoning_content ?? m.reasoning ?? '').length;
        finish = j.choices?.[0]?.finish_reason ?? ''; usage = j.usage;
    }
    const ms = Math.round(performance.now() - t0);
    const u = usage as { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
    return { name: v.name, status: res.status, ms, firstContentMs, finish, prompt: u?.prompt_tokens, completion: u?.completion_tokens,
        // 추론 토큰은 usage 최상위(reasoning_tokens)에 온다 — completion_tokens 에 포함(이중 합산 금지)
        reasoning: (usage as { reasoning_tokens?: number } | undefined)?.reasoning_tokens ?? u?.completion_tokens_details?.reasoning_tokens, reasoningChars, json: parses(content), content: short(content), rate };
};

if (DRY) { for (const v of VARIANTS) console.log(`${v.name.padEnd(24)} ${JSON.stringify(v.extra)}${v.stream ? ' stream' : ''}`); process.exit(0); }
console.log(`EXAONE ${MODEL} · 변형 ${VARIANTS.length}개 × 1회 · 질문 "${USER}"\n`);
// 무료 API 는 초당 1회(실측 429 "second limit(1)") — 간격을 둔다
for (const v of VARIANTS) { console.log(JSON.stringify(await run(v))); await new Promise(r => setTimeout(r, 1500)); }
