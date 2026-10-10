/**
 * GPT(OpenAI Responses) 가 PDF 를 직접 받는가 — `input_file`
 *
 *   node --env-file=.env.local --import tsx tests/manual/probe-openai-pdf.mts [--dry]
 *
 * 지금은 GPT 선택 + PDF 면 Gemini 2.5 로 조용히 전환한다(generator.ts `pinOpenAIUnsupportedMedia`).
 * 앱이 PDF 를 보내는 두 모양을 그대로 잰다:
 *   · 1MB 이상 → Storage 공개 URL  → `input_file.file_url`
 *   · 1MB 미만 → base64 data URI   → `input_file.file_data`
 * 대조군: 같은 모델 텍스트 요청. 파일은 dev Storage 기존 객체(업로드 없음). 키는 출력하지 않는다.
 */
const DRY = process.argv.includes('--dry');
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const KEY = process.env.OPENAI_API_KEY_TIER1;
const MODELS = process.argv.includes('--large-only') ? ['gpt-6-luna', 'gpt-5.4-mini'] : ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.4-mini'];
const MB = 1024 * 1024;

const list = async () => {
    const res = await fetch(`${BASE}/storage/v1/object/list/chat-docs`, {
        method: 'POST', headers: { Authorization: `Bearer ${SR}`, apikey: SR, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    return (await res.json()).filter((o: any) => o.id && o.metadata?.mimetype === 'application/pdf');
};
const pdfs = await list();
const pick = (lo: number, hi: number) => pdfs.find((o: any) => o.metadata.size > lo && o.metadata.size < hi);
const pub = (o: any) => `${BASE}/storage/v1/object/public/chat-docs/${encodeURIComponent(o.name)}`;

const small = pick(100 * 1024, 1 * MB);
const mid = pick(1 * MB, 2 * MB);
const large = pick(2 * MB, 4 * MB);
const xl = pick(4 * MB, 8 * MB);
const xxl = pick(8 * MB, 16 * MB);
for (const [l, o] of [['inline <1MB', small], ['URL 1~2MB', mid], ['URL 2~4MB', large], ['URL 4~8MB', xl], ['URL 8~16MB', xxl]] as const) {
    console.log(`${l}: ${o ? `${(o.metadata.size / MB).toFixed(2)}MB` : '없음'}`);
}
if (DRY || !KEY) { if (!KEY) console.log('OPENAI_API_KEY_TIER1 없음'); process.exit(0); }

const smallB64 = small ? Buffer.from(await (await fetch(pub(small))).arrayBuffer()).toString('base64') : '';

const ask = async (model: string, content: any[]) => {
    const t0 = Date.now();
    try {
        const r = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, store: false, max_output_tokens: 1500, input: [{ role: 'user', content }] }),
            signal: AbortSignal.timeout(120_000),
        });
        const j: any = await r.json();
        const ms = ((Date.now() - t0) / 1000).toFixed(1);
        if (!r.ok) return `❌ ${r.status} ${j?.error?.code ?? ''} ${(j?.error?.message ?? '').slice(0, 60)} (${ms}s)`;
        const text = (j.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join(' ').replace(/\s+/g, ' ');
        return text ? `✅ ${ms}s · ${text.slice(0, 40)}` : `⚠️ 빈 응답 ${j.status} ${j.incomplete_details?.reason ?? ''} (${ms}s)`;
    } catch (e: any) {
        return `❌ ${e?.name === 'TimeoutError' ? 'timeout' : e?.message} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    }
};

const Q = { type: 'input_text', text: '이 PDF 의 제목과 핵심 내용을 한 문장으로 알려줘.' };
const rows: any[] = [];
for (const model of MODELS) {
    const row: any = { model, '대조(텍스트)': await ask(model, [{ type: 'input_text', text: '한 단어로: 하늘 색은?' }]) };
    const LO = process.argv.includes('--large-only');
    if (small && !LO) row['inline <1MB'] = await ask(model, [{ type: 'input_file', filename: 'doc.pdf', file_data: `data:application/pdf;base64,${smallB64}` }, Q]);
    if (mid && !LO) row['URL 1~2MB'] = await ask(model, [{ type: 'input_file', file_url: pub(mid) }, Q]);
    if (large && !LO) row['URL 2~4MB'] = await ask(model, [{ type: 'input_file', file_url: pub(large) }, Q]);
    if (xl) row['URL 4~8MB'] = await ask(model, [{ type: 'input_file', file_url: pub(xl) }, Q]);
    if (xxl) row['URL 8~16MB'] = await ask(model, [{ type: 'input_file', file_url: pub(xxl) }, Q]);
    rows.push(row);
    console.log(JSON.stringify(row));
}
console.table(rows);
