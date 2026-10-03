/**
 * TTS 첫 음성 지연(TTFB) 측정 — PLAN_TTS_STREAMING_261002 §4 0단계.
 *
 * 세 팔을 같은 한국어 문장 세트로 교대 배치해 잰다.
 *   gemini-batch  : 2026-10-02 이전 `/api/speech` 경로 (generateContent, 전체 수신 후 재생)
 *   gemini-stream : generateContentStream — 첫 오디오 청크 시점
 *   openai-stream : gpt-4o-mini-tts, response_format=pcm — 첫 바이트 시점
 *
 * 유료 호출이 있으므로 `npm test` 에 넣지 않는다. 키 값은 출력하지 않는다.
 * 실행: npx tsx --conditions=react-server tests/manual/probe-tts-latency.mts [rounds=2]  (server-only 우회)
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}

const { API_KEYS, getNextApiKey } = await import('../../server/config.js');
const { SERVER_MODELS } = await import('../../server/models.js');

const OPENAI_KEY = process.env.OPENAI_API_KEY_TIER1;
if (API_KEYS.length === 0 || !OPENAI_KEY) {
    console.error('Gemini 키 또는 OPENAI_API_KEY_TIER1 이 없습니다.');
    process.exit(1);
}

const ROUNDS = Number(process.argv[2] ?? 2);
// 24kHz · 16bit · mono — 두 공급자 공통
const BYTES_PER_SEC = 24000 * 2;

const base = '오늘은 서울의 날씨가 맑고 기온은 섭씨 이십삼 도 정도로 산책하기 좋은 날입니다. ';
const TEXTS = {
    short: '안녕하세요. 무엇을 도와드릴까요?',
    medium: base.repeat(4),
    long: base.repeat(40).slice(0, 2000), // route 의 2000자 절단과 같은 상한
} as const;

const GEMINI_CONFIG = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
} as any;

type Result = { ttfb: number; total: number; audioSec: number };

async function geminiBatch(text: string): Promise<Result> {
    const ai = new GoogleGenAI({ apiKey: getNextApiKey()! });
    const t0 = performance.now();
    const res = await ai.models.generateContent({
        model: process.env.TTS_MODEL ?? SERVER_MODELS.TTS,
        contents: [{ parts: [{ text }] }],
        config: GEMINI_CONFIG,
    });
    const total = performance.now() - t0;
    const b64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('no audio');
    // 비스트리밍은 전부 받아야 재생이 시작되므로 TTFB = total
    return { ttfb: total, total, audioSec: Buffer.from(b64, 'base64').length / BYTES_PER_SEC };
}

async function geminiStream(text: string): Promise<Result> {
    const ai = new GoogleGenAI({ apiKey: getNextApiKey()! });
    const t0 = performance.now();
    const stream = await ai.models.generateContentStream({
        model: process.env.TTS_MODEL ?? SERVER_MODELS.TTS,
        contents: [{ parts: [{ text }] }],
        config: GEMINI_CONFIG,
    });
    let ttfb = -1;
    let bytes = 0;
    for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            const b64 = part.inlineData?.data;
            if (!b64) continue;
            if (ttfb < 0) ttfb = performance.now() - t0;
            bytes += Buffer.from(b64, 'base64').length;
        }
    }
    if (bytes === 0) throw new Error('no audio');
    return { ttfb, total: performance.now() - t0, audioSec: bytes / BYTES_PER_SEC };
}

async function openaiStream(text: string): Promise<Result> {
    const t0 = performance.now();
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    let ttfb = -1;
    let bytes = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length && ttfb < 0) ttfb = performance.now() - t0;
        bytes += value.length;
    }
    return { ttfb, total: performance.now() - t0, audioSec: bytes / BYTES_PER_SEC };
}

const ARMS = { 'gemini-batch': geminiBatch, 'gemini-stream': geminiStream, 'openai-stream': openaiStream };
const rows: { round: number; text: string; arm: string; r?: Result; err?: string }[] = [];

for (let round = 1; round <= ROUNDS; round++) {
    // 교대 배치: 라운드마다 팔 순서를 회전해 시간대 드리프트가 한 팔에 몰리지 않게 한다
    const names = Object.keys(ARMS);
    const order = names.slice(round % names.length).concat(names.slice(0, round % names.length));
    for (const [label, text] of Object.entries(TEXTS)) {
        for (const arm of order) {
            try {
                const r = await ARMS[arm as keyof typeof ARMS](text);
                rows.push({ round, text: label, arm, r });
                console.log(`r${round} ${label.padEnd(6)} ${arm.padEnd(13)} ttfb=${(r.ttfb / 1000).toFixed(2)}s total=${(r.total / 1000).toFixed(2)}s audio=${r.audioSec.toFixed(1)}s`);
            } catch (e: any) {
                rows.push({ round, text: label, arm, err: String(e?.message ?? e).slice(0, 160) });
                console.log(`r${round} ${label.padEnd(6)} ${arm.padEnd(13)} ERROR ${String(e?.message ?? e).slice(0, 160)}`);
            }
        }
    }
}

console.log('\n## 중앙값 (성공 건만)');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log('| 텍스트 | 팔 | n | TTFB | 전체 | 오류 |');
console.log('|---|---|---|---|---|---|');
for (const text of Object.keys(TEXTS)) {
    for (const arm of Object.keys(ARMS)) {
        const sel = rows.filter(x => x.text === text && x.arm === arm);
        const ok = sel.filter(x => x.r).map(x => x.r!);
        const f = (v: number) => `${(v / 1000).toFixed(2)}s`;
        console.log(`| ${text} | ${arm} | ${ok.length} | ${ok.length ? f(median(ok.map(r => r.ttfb))) : '-'} | ${ok.length ? f(median(ok.map(r => r.total))) : '-'} | ${sel.length - ok.length} |`);
    }
}
