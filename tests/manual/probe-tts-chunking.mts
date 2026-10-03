/**
 * OpenAI TTS 긴 텍스트 잘림 측정 — PLAN_TTS_STREAMING_261002 §4-1 ③ 후속.
 *
 * 단계
 *   A. 길이 스윕   : 300~2000자 단일 요청. 끝 문장의 표지어("바나나")가 전사에 나오는지로
 *                    잘림을 판정한다(오디오 길이 비율은 보조 지표).
 *   B. 분할 vs 단일: 2000자를 문장 경계로 나눠 순차·선행 요청 → 이어 붙인 결과와 단일 요청 비교.
 *                    첫 소리·전체 시간·표지어 유무. WAV 를 저장해 억양은 귀로 비교한다.
 *
 * 전사는 gpt-4o-mini-transcribe. 유료 호출이므로 `npm test` 에 넣지 않는다.
 * 실행: [TTS_PROVIDER=gemini] npx tsx tests/manual/probe-tts-chunking.mts [A|B|all] [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}
const KEY = process.env.OPENAI_API_KEY_TIER1;
if (!KEY) { console.error('OPENAI_API_KEY_TIER1 이 없습니다(전사에도 쓴다).'); process.exit(1); }
// TTS_PROVIDER=gemini 면 합성만 Gemini(TTS_MODEL, 기본 3.1 flash tts), 전사는 그대로 OpenAI
const PROVIDER = process.env.TTS_PROVIDER ?? 'openai';
const GEMINI_MODEL = process.env.TTS_MODEL ?? 'gemini-3.1-flash-tts-preview';
const GEMINI_KEY = process.env.API_KEY_TIER1 ?? Object.entries(process.env).find(([k, v]) => /^API_KEY\d*$/.test(k) && v)?.[1]; // 유료 키 우선

const STAGE = (process.argv[2] ?? 'all').toUpperCase();
const OUT = process.argv[3] ?? 'tts-probe-out';
fs.mkdirSync(OUT, { recursive: true });

const BYTES_PER_SEC = 24000 * 2; // pcm: 24kHz · 16bit · mono
const MARKER = '바나나';
const END_SENTENCE = `마지막 확인 단어는 ${MARKER}입니다.`;

// 반복 문장은 모델이 건너뛸 수 있어 서로 다른 문장으로 구성한다
const SENTENCES = [
    '오늘 서울은 아침부터 맑은 하늘이 이어지고 있습니다.',
    '낮 최고 기온은 이십삼 도까지 오를 것으로 예상됩니다.',
    '바람이 약하게 불어 야외 활동을 하기에 좋은 날씨입니다.',
    '다만 일교차가 크니 얇은 겉옷을 챙기시는 것이 좋겠습니다.',
    '미세먼지 농도는 전 권역에서 보통 수준을 보이겠습니다.',
    '오후에는 남부 지방을 중심으로 구름이 조금 많아지겠습니다.',
    '주말에는 전국에 비 소식이 있어 우산을 준비하시기 바랍니다.',
    '강수량은 지역에 따라 다르지만 대체로 많지 않을 전망입니다.',
    '비가 그친 뒤에는 기온이 다소 내려가 쌀쌀해지겠습니다.',
    '건강 관리에 유의하시고 따뜻한 차 한 잔으로 하루를 시작해 보세요.',
    '도서관에서는 이번 달 새로 들어온 책 목록을 공개했습니다.',
    '특히 과학 분야 신간이 많아 학생들의 관심이 높습니다.',
    '지하철 이호선은 선로 점검으로 일부 구간에서 서행합니다.',
    '출근길에는 평소보다 십 분 정도 여유를 두고 나서시길 권합니다.',
    '시장에서는 제철을 맞은 사과와 배의 가격이 내려가고 있습니다.',
    '전문가들은 당분간 이런 흐름이 이어질 것이라고 내다봤습니다.',
];

function buildText(target: number): string {
    let out = '';
    for (let i = 0; out.length + END_SENTENCE.length < target; i++) {
        const s = SENTENCES[i % SENTENCES.length];
        if (out.length + s.length + 1 + END_SENTENCE.length > target) break;
        out += s + ' ';
    }
    return out + END_SENTENCE;
}

/** 문장 경계 분할. 첫 조각은 짧게(첫 소리를 당기기 위해), 이후는 maxChars 까지 채운다. */
function splitText(text: string, maxChars: number, firstMax: number): string[] {
    const sentences = text.match(/[^.?!。]+[.?!。]+\s*/g) ?? [text];
    const chunks: string[] = [];
    let cur = '';
    for (const s of sentences) {
        const limit = chunks.length === 0 ? firstMax : maxChars;
        if (cur && cur.length + s.length > limit) { chunks.push(cur.trim()); cur = ''; }
        cur += s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
}

async function tts(input: string): Promise<{ pcm: Buffer; ttfb: number; total: number }> {
    return PROVIDER === 'gemini' ? ttsGemini(input) : ttsOpenAI(input);
}

async function ttsGemini(input: string): Promise<{ pcm: Buffer; ttfb: number; total: number }> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY! });
    const t0 = performance.now();
    const stream = await ai.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: [{ parts: [{ text: input }] }],
        config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            abortSignal: AbortSignal.timeout(180_000),
        } as any,
    });
    const parts: Buffer[] = [];
    let ttfb = -1;
    for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (!part.inlineData?.data) continue;
            if (ttfb < 0) ttfb = performance.now() - t0;
            parts.push(Buffer.from(part.inlineData.data, 'base64'));
        }
    }
    if (!parts.length) throw new Error('gemini: no audio');
    return { pcm: Buffer.concat(parts), ttfb, total: performance.now() - t0 };
}

async function ttsOpenAI(input: string): Promise<{ pcm: Buffer; ttfb: number; total: number }> {
    const t0 = performance.now();
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input, response_format: 'pcm' }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) throw new Error(`TTS HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const parts: Buffer[] = [];
    let ttfb = -1;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length && ttfb < 0) ttfb = performance.now() - t0;
        parts.push(Buffer.from(value));
    }
    return { pcm: Buffer.concat(parts), ttfb, total: performance.now() - t0 };
}

function wav(pcm: Buffer): Buffer {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(24000, 24); h.writeUInt32LE(BYTES_PER_SEC, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]);
}

async function transcribe(pcm: Buffer): Promise<string> {
    const form = new FormData();
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('language', 'ko');
    form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'a.wav');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form,
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`STT HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { text: string }).text;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const audioSec = (pcm: Buffer) => pcm.length / BYTES_PER_SEC;
const hangul = (s: string) => (s.match(/[가-힣]/g) ?? []).length;

// ── A. 길이 스윕 ─────────────────────────────────────────────
async function stageA() {
    console.log('\n## A. 길이 스윕 (단일 요청)');
    console.log('| 목표 | 실제자 | 오디오 | 초/100자 | 전사/입력 한글 | 표지어 | 전체 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const target of [300, 500, 800, 1200, 1600, 2000]) {
        const text = buildText(target);
        try {
            const r = await tts(text);
            const tr = await transcribe(r.pcm);
            fs.writeFileSync(path.join(OUT, `A_${target}.wav`), wav(r.pcm));
            fs.writeFileSync(path.join(OUT, `A_${target}.txt`), tr);
            const ratio = (hangul(tr) / hangul(text) * 100).toFixed(0);
            console.log(`| ${target} | ${text.length} | ${audioSec(r.pcm).toFixed(1)}s | ${(audioSec(r.pcm) / text.length * 100).toFixed(1)} | ${ratio}% | ${tr.includes(MARKER) ? '✅' : '❌'} | ${sec(r.total)} |`);
        } catch (e: any) {
            console.log(`| ${target} | ${text.length} | ERROR ${String(e?.message ?? e).slice(0, 120)} |`);
        }
    }
}

// ── B. 분할 vs 단일 ──────────────────────────────────────────
/** 순차 재생을 흉내낸다: 조각 i 를 요청하면서 i+1..i+prefetch 를 미리 띄운다. 첫 소리 = 첫 조각 TTFB. */
async function chunked(text: string, maxChars: number, firstMax: number, prefetch: number) {
    const chunks = splitText(text, maxChars, firstMax);
    const t0 = performance.now();
    const pending: Promise<Awaited<ReturnType<typeof tts>>>[] = [];
    const launch = (i: number) => { if (i < chunks.length && !pending[i]) pending[i] = tts(chunks[i]); };
    for (let i = 0; i <= prefetch; i++) launch(i);
    const pcms: Buffer[] = [];
    let firstSound = -1;
    let stalls = 0;
    // 재생 시계: 조각 i 가 도착했을 때 앞 조각 재생이 이미 끝났다면 끊김(stall)
    let playheadEnd = 0;
    for (let i = 0; i < chunks.length; i++) {
        const r = await pending[i];
        const now = performance.now() - t0;
        if (i === 0) { firstSound = now - (r.total - r.ttfb); playheadEnd = now; }
        if (i > 0 && now > playheadEnd) stalls++;
        playheadEnd = Math.max(playheadEnd, now) + audioSec(r.pcm) * 1000;
        pcms.push(r.pcm);
        for (let j = 1; j <= prefetch; j++) launch(i + j);
    }
    return { chunks, pcm: Buffer.concat(pcms), firstSound, total: performance.now() - t0, stalls };
}

async function stageB() {
    console.log('\n## B. 2000자 — 단일 vs 분할');
    const text = buildText(2000);
    const ONLY = process.env.CONFIGS?.split(',');
    const all = [
        { name: 'single', run: async () => { const r = await tts(text); return { chunks: [text], pcm: r.pcm, firstSound: r.ttfb, total: r.total, stalls: 0 }; } },
        { name: 'split-300-p1', run: () => chunked(text, 300, 80, 1) },
        { name: 'split-500-p1', run: () => chunked(text, 500, 80, 1) },
        { name: 'split-500-p2', run: () => chunked(text, 500, 80, 2) },
        { name: 'split-700-p1', run: () => chunked(text, 700, 80, 1) },
        { name: 'split-700-p2', run: () => chunked(text, 700, 80, 2) },
    ];
    const configs = ONLY ? all.filter(c => ONLY.includes(c.name)) : all;
    console.log('| 구성 | 조각 | 첫 소리 | 전체 | 오디오 | 끊김 | 전사/입력 한글 | 표지어 |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const c of configs) {
        try {
            const r = await c.run();
            const tr = await transcribe(r.pcm);
            fs.writeFileSync(path.join(OUT, `B_${c.name}.wav`), wav(r.pcm));
            fs.writeFileSync(path.join(OUT, `B_${c.name}.txt`), tr);
            const ratio = (hangul(tr) / hangul(text) * 100).toFixed(0);
            console.log(`| ${c.name} | ${r.chunks.length} | ${sec(r.firstSound)} | ${sec(r.total)} | ${audioSec(r.pcm).toFixed(1)}s | ${r.stalls} | ${ratio}% | ${tr.includes(MARKER) ? '✅' : '❌'} |`);
        } catch (e: any) {
            console.log(`| ${c.name} | ERROR ${String(e?.message ?? e).slice(0, 120)} |`);
        }
    }
}

if (STAGE === 'A' || STAGE === 'ALL') await stageA();
if (STAGE === 'B' || STAGE === 'ALL') await stageB();
console.log(`\nWAV/전사 저장: ${OUT}`);
