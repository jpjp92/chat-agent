/**
 * 업로드 첨부(Storage 공개 URL → fileData) 를 3.x 가 받는가 — 재측정 (DEV_260808 §1 의 후속)
 *
 *   node --env-file=.env.local --import tsx tests/manual/probe-url-filedata.mts [--dry]
 *
 * 08-08: 3.6 은 업로드 영상·PDF(URL) 에 429 — 무료·유료 키 모두. "쿼터가 아니라 능력" 으로 결론,
 *        `urlFileData:false` 로 2.5 핀(generator.ts `pinUrlFileData`).
 * 10-10: 유료 키가 Tier 2 로 올랐고 3.7 이 생겼다 → 같은 행렬을 다시 잰다.
 *
 * 🔴 대조군 필수: 같은 키·모델로 **텍스트 요청이 성공**해야 그 칸의 429 를 "능력"으로 읽는다(08-08 교훈).
 * 파일은 dev Storage 에 **이미 있는 객체**만 쓴다(업로드 없음). 키 값은 출력하지 않는다.
 */
import { GoogleGenAI } from '@google/genai';

const DRY = process.argv.includes('--dry');
const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]; // 예: --only=PDF 4~8MB,PDF 8~16MB
const KEYS: [string, string | undefined][] = [['유료', process.env.API_KEY_TIER1], ['무료', process.env.API_KEY]];
const TIMEOUT_MS = 90_000;

/** 버킷에서 조건에 맞는 첫 객체의 공개 URL */
const findObject = async (bucket: string, pred: (o: any) => boolean) => {
    const res = await fetch(`${BASE}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SR}`, apikey: SR, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
    });
    const o = (await res.json()).find((x: any) => x.id && pred(x));
    if (!o) return null;
    return { url: `${BASE}/storage/v1/object/public/${bucket}/${encodeURIComponent(o.name)}`, size: o.metadata.size, mime: o.metadata.mimetype };
};

const MB = 1024 * 1024;
const files = [
    { label: '업로드 영상', f: await findObject('chat-videos', o => o.metadata?.mimetype === 'video/mp4') },
    { label: 'PDF 1~2MB', f: await findObject('chat-docs', o => o.metadata?.mimetype === 'application/pdf' && o.metadata.size > 1 * MB && o.metadata.size < 2 * MB) },
    { label: 'PDF 2~4MB', f: await findObject('chat-docs', o => o.metadata?.mimetype === 'application/pdf' && o.metadata.size > 2 * MB && o.metadata.size < 4 * MB) },
    { label: 'PDF 4~8MB', f: await findObject('chat-docs', o => o.metadata?.mimetype === 'application/pdf' && o.metadata.size > 4 * MB && o.metadata.size < 8 * MB) },
    { label: 'PDF 8~16MB', f: await findObject('chat-docs', o => o.metadata?.mimetype === 'application/pdf' && o.metadata.size > 8 * MB && o.metadata.size < 16 * MB) },
    { label: 'XLSX(참고)', f: await findObject('chat-docs', o => /spreadsheetml/.test(o.metadata?.mimetype ?? '')) },
];
for (const { label, f } of files) console.log(`${label}: ${f ? `${(f.size / MB).toFixed(1)}MB ${f.mime}` : '없음'}`);
if (DRY) process.exit(0);

type Cell = { ok: boolean; ms: number; note: string };
const call = async (apiKey: string, model: string, parts: any[]): Promise<Cell> => {
    const ai = new GoogleGenAI({ apiKey });
    const t0 = Date.now();
    try {
        const r = await ai.models.generateContent({
            model, contents: [{ role: 'user', parts }],
            config: { abortSignal: AbortSignal.timeout(TIMEOUT_MS), maxOutputTokens: 200 },
        });
        return { ok: !!r.text, ms: Date.now() - t0, note: (r.text ?? '').replace(/\s+/g, ' ').slice(0, 30) };
    } catch (e: any) {
        const code = e?.status ?? e?.code ?? (e?.name === 'TimeoutError' ? 'timeout' : '?');
        return { ok: false, ms: Date.now() - t0, note: `${code} ${String(e?.message ?? '').match(/RESOURCE_EXHAUSTED|INVALID_ARGUMENT|Unsupported|not supported|mime/i)?.[0] ?? ''}`.trim() };
    }
};

const rows: any[] = [];
for (const model of MODELS) {
    for (const [keyLabel, key] of KEYS) {
        if (!key) { console.log(`${keyLabel} 키 없음 — 건너뜀`); continue; }
        const control = await call(key, model, [{ text: '한 단어로 답해: 하늘 색은?' }]);
        const row: any = { model, key: keyLabel, '대조(텍스트)': control.ok ? `✅ ${(control.ms / 1000).toFixed(1)}s` : `❌ ${control.note}` };
        for (const { label, f } of files) {
            if (ONLY && !ONLY.split(',').includes(label)) continue;
            if (!f) { row[label] = '-'; continue; }
            const c = await call(key, model, [
                { fileData: { fileUri: f.url, mimeType: f.mime } },
                { text: '이 파일 내용을 한 문장으로 요약해줘.' },
            ]);
            row[label] = c.ok ? `✅ ${(c.ms / 1000).toFixed(1)}s` : `❌ ${c.note} (${(c.ms / 1000).toFixed(1)}s)`;
        }
        rows.push(row);
        console.log(JSON.stringify(row));
    }
}
console.table(rows);
