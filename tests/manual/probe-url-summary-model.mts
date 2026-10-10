/**
 * URL 요약(긴 입력) — 3.7 의 2.5 핀(`fastLongInput:false`)을 유료 키에서 풀 수 있나
 *
 *   node --env-file=.env.local --import tsx tests/manual/probe-url-summary-model.mts [--rounds=2]
 *
 * 입력: dev `url_cache` 의 실제 본문(앱이 받은 그대로, ~15k자) 3건 + URL 요약 3단 템플릿.
 * 측정: 첫 토큰(TTFB)·전체 시간·실패. 모델 3 × 키 2 × URL 3 × 라운드. 키 값은 출력하지 않는다.
 * 판정(사전 등록): 유료 3.7 이 2.5 대비 전체 p90 이 같거나 빠르고 실패 0 → 회원 핀 해제.
 */
import { GoogleGenAI } from '@google/genai';

const ROUNDS = Number(process.argv.find(a => a.startsWith('--rounds='))?.split('=')[1] ?? 2);
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const KEYS: [string, string | undefined][] = [['유료', process.env.API_KEY_TIER1], ['무료', process.env.API_KEY]];

const res = await fetch(`${BASE}/rest/v1/url_cache?select=url_key,content&limit=60`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
const docs = (await res.json()).sort((a: any, b: any) => b.content.length - a.content.length).slice(0, 3);
console.log(docs.map((d: any) => `${d.content.length}자 ${d.url_key.slice(0, 60)}`).join('\n'));

const TEMPLATE = `아래 [URL_CONTENT] 를 요약하라. 형식:\n**한 줄 요약**\n> (1문장)\n\n**주요 내용**\n(2~4개 헤딩, 불릿)\n\n**핵심 포인트**\n- (3~5개)`;

const run = async (key: string, model: string, doc: any) => {
    const ai = new GoogleGenAI({ apiKey: key });
    const t0 = Date.now(); let ttfb = 0; let chars = 0;
    try {
        const stream = await ai.models.generateContentStream({
            model,
            contents: [{ role: 'user', parts: [{ text: `${TEMPLATE}\n\n[URL_CONTENT: ${doc.url_key}]\n${doc.content}` }] }],
            config: { abortSignal: AbortSignal.timeout(90_000) },
        });
        for await (const c of stream) { if (!ttfb && c.text) ttfb = Date.now() - t0; chars += c.text?.length ?? 0; }
        return { ok: chars > 0, ttfb, total: Date.now() - t0, err: '' };
    } catch (e: any) {
        return { ok: false, ttfb, total: Date.now() - t0, err: String(e?.status ?? e?.name ?? '?') };
    }
};

const results: Record<string, { ttfb: number[]; total: number[]; fail: string[] }> = {};
for (let r = 1; r <= ROUNDS; r++) {
    for (const doc of docs) for (const model of MODELS) for (const [kl, key] of KEYS) {
        if (!key) continue;
        const id = `${model} · ${kl}`;
        const x = await run(key, model, doc);
        results[id] ??= { ttfb: [], total: [], fail: [] };
        if (x.ok) { results[id].ttfb.push(x.ttfb); results[id].total.push(x.total); } else results[id].fail.push(x.err);
        console.log(`r${r} ${id} ${x.ok ? `ttfb ${(x.ttfb / 1000).toFixed(1)}s total ${(x.total / 1000).toFixed(1)}s` : `❌ ${x.err} ${(x.total / 1000).toFixed(1)}s`}`);
    }
}
const pct = (a: number[], p: number) => a.length ? (a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * p) - 1)] / 1000).toFixed(1) : '-';
console.table(Object.entries(results).map(([id, v]) => ({
    id, n: v.total.length + v.fail.length, 'TTFB 중앙': pct(v.ttfb, 0.5), '전체 중앙': pct(v.total, 0.5), '전체 p90': pct(v.total, 0.9), '실패': v.fail.join(',') || 0,
})));
