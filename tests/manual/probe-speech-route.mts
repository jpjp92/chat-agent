/**
 * `/api/speech` 라우트 핸들러 실호출 — 공급자별(TTS_PROVIDER) 스트리밍 응답 확인.
 *
 * dev 서버 없이 `POST` 를 직접 부른다. 응답 스트림을 읽으며 첫 바이트·전체 시간·오디오 길이를 잰다.
 * 클라이언트 재생과 같은 규칙으로 **스트리밍 재생을 흉내내** 끊김(재생 시계가 도착보다 앞선 횟수)을 센다.
 * 🔴 라우트가 회원 토큰을 요구한다(2026-10-03) — 회원 access token 을 TTS_PROBE_BEARER 로 넘긴다
 *    (브라우저 devtools: Supabase 세션의 access_token). 회원 일일 한도도 함께 소비된다.
 * 유료 호출. 실행:
 *   TTS_PROVIDER=openai npx tsx --conditions=react-server tests/manual/probe-speech-route.mts [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

for (const file of ['.env.local', '.env']) {
    if (fs.existsSync(file)) dotenv.config({ path: file, override: false, quiet: true });
}
const { NextRequest } = await import('next/server');
const { POST } = await import('../../app/api/speech/route.js');

const OUT = process.argv[2] ?? 'tts-route-out';
fs.mkdirSync(OUT, { recursive: true });
const BYTES_PER_SEC = 48000;

const S = [
    '오늘 서울은 아침부터 맑은 하늘이 이어지고 있습니다.', '낮 최고 기온은 이십삼 도까지 오를 것으로 예상됩니다.',
    '바람이 약하게 불어 야외 활동을 하기에 좋은 날씨입니다.', '다만 일교차가 크니 얇은 겉옷을 챙기시는 것이 좋겠습니다.',
    '미세먼지 농도는 전 권역에서 보통 수준을 보이겠습니다.', '오후에는 남부 지방을 중심으로 구름이 조금 많아지겠습니다.',
    '주말에는 전국에 비 소식이 있어 우산을 준비하시기 바랍니다.', '강수량은 지역에 따라 다르지만 대체로 많지 않을 전망입니다.',
    '비가 그친 뒤에는 기온이 다소 내려가 쌀쌀해지겠습니다.', '건강 관리에 유의하시고 따뜻한 차 한 잔으로 하루를 시작해 보세요.',
    '도서관에서는 이번 달 새로 들어온 책 목록을 공개했습니다.', '특히 과학 분야 신간이 많아 학생들의 관심이 높습니다.',
    '지하철 이호선은 선로 점검으로 일부 구간에서 서행합니다.', '출근길에는 평소보다 십 분 정도 여유를 두고 나서시길 권합니다.',
    '시장에서는 제철을 맞은 사과와 배의 가격이 내려가고 있습니다.', '전문가들은 당분간 이런 흐름이 이어질 것이라고 내다봤습니다.',
];
let long = '';
for (let i = 0; long.length + S[i % S.length].length < 1960; i++) long += S[i % S.length] + ' ';
long += '마지막 확인 단어는 바나나입니다.';

const ALL_CASES = { short: '안녕하세요. 무엇을 도와드릴까요?', medium: S.slice(0, 6).join(' '), long };
const ONLY = process.env.CASES?.split(',');
const CASES = Object.fromEntries(Object.entries(ALL_CASES).filter(([k]) => !ONLY || ONLY.includes(k)));

/**
 * 문장 누락 판정 — 🔴 오디오 길이(초/100자)로는 **한 문장 누락을 못 잡는다**: 2000자에서 한 문장은 ~1.5%,
 * 측정 잡음(±3%) 안이다. Gemini 가 medium 의 마지막 문장을 빠뜨린 것을 전사로 처음 확인했다(2026-10-03).
 * 각 원문 문장의 앞 6글자(공백 제외)가 전사에 있는지 본다. 숫자 읽기("이십삼"→"23")를 피해 앞부분만 쓴다.
 * 긴 오디오는 STT 가 끝까지 적지 못하므로(§4-2c, 72%) medium 이하에서만 판정한다.
 */
async function missingSentences(text: string, pcm: Buffer): Promise<string[]> {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
    h.writeUInt32LE(BYTES_PER_SEC, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    const form = new FormData();
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('language', 'ko');
    form.append('file', new Blob([Buffer.concat([h, pcm])], { type: 'audio/wav' }), 'a.wav');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY_TIER1}` }, body: form,
    });
    const norm = (x: string) => x.replace(/[\s.?!,]/g, '');
    const transcript = norm(((await r.json()) as { text: string }).text);
    return (text.match(/[^.?!]+[.?!]/g) ?? []).map(x => x.trim()).filter(x => !transcript.includes(norm(x).slice(0, 6)));
}

for (const [name, text] of Object.entries(CASES)) {
    const t0 = performance.now();
    const req = new NextRequest('http://localhost/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.TTS_PROBE_BEARER ? { Authorization: `Bearer ${process.env.TTS_PROBE_BEARER}` } : {}) },
        body: JSON.stringify({ text }),
    });
    const res = await POST(req);
    const provider = res.headers.get('X-TTS-Provider');
    const chunks = res.headers.get('X-TTS-Chunks');
    if (!res.ok || !res.body) {
        console.log(`${name.padEnd(6)} HTTP ${res.status} ${await res.text()}`);
        continue;
    }
    const reader = res.body.getReader();
    const parts: Buffer[] = [];
    let ttfb = -1;
    let playheadEnd = 0; // ms, 재생 시계
    let stalls = 0;
    let carry = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = performance.now() - t0;
        if (ttfb < 0) { ttfb = now; playheadEnd = now + (provider === 'openai' ? 300 : 50); } // 클라이언트 TTS_START_LEAD_SEC 와 같게
        else if (now > playheadEnd + 1) stalls++;
        const bytes = value.length + carry;
        carry = bytes % 2;
        playheadEnd = Math.max(playheadEnd, now) + ((bytes - carry) / BYTES_PER_SEC) * 1000;
        parts.push(Buffer.from(value));
    }
    const pcm = Buffer.concat(parts);
    const audio = pcm.length / BYTES_PER_SEC;
    fs.writeFileSync(path.join(OUT, `${provider}-${name}.pcm`), pcm);
    const missing = name === 'long' ? null : await missingSentences(text, pcm);
    console.log(`${name.padEnd(6)} provider=${provider} 조각=${chunks} 첫소리=${(ttfb / 1000).toFixed(2)}s 전체=${((performance.now() - t0) / 1000).toFixed(2)}s 오디오=${audio.toFixed(1)}s 초/100자=${(audio / text.length * 100).toFixed(1)} 끊김=${stalls} 홀수=${pcm.length % 2} 누락=${missing === null ? '-' : missing.length ? missing.map(m => m.slice(0, 12)).join('|') : 0}`);
}
