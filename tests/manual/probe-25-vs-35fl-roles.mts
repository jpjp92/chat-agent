/**
 * 2.5 Flash(현행 설정) vs 3.5 Flash-Lite(`minimal`) — 2.5 가 맡던 역할별 비교. `npx tsx tests/manual/probe-25-vs-35fl-roles.mts [반복=3]`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §8 · 유료 키(TIER1)만 · 합성 입력 · 출력은 성공 수·지연·길이·출처 수만.
 * 호출: 역할 8 × 모델 2 × 반복
 */
import fs from 'node:fs';
const env: Record<string, string> = {};
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const KEY = env.API_KEY_TIER1; if (!KEY) { console.error('유료 키 없음'); process.exit(1); }
const N = Number(process.argv[2] ?? 3);
const IMG = fs.readFileSync('scripts/movie-spike-output/badge-dark.png').toString('base64');
const txt = (t: string) => [{ role: 'user', parts: [{ text: t }] }];
const S = { temperature: 0.2, topP: 0.8, topK: 40 };
const MIN = { thinkingConfig: { thinkingLevel: 'MINIMAL' } };

// 역할: [이름, 입력, 2.5 현행 설정, 3.5 FL 설정]
const ROLES: [string, any, any, any][] = [
    ['일반 생성', { contents: txt('김치찌개 레시피 5단계로') }, { generationConfig: S }, { generationConfig: MIN }],
    ['의학(budget 3000 ↔ minimal)', { contents: txt('편두통이 잦을 때 병원 가야 하는 신호') }, { generationConfig: { ...S, thinkingConfig: { thinkingBudget: 3000 } } }, { generationConfig: MIN }],
    ['검색 grounding', { contents: txt('오늘 원달러 환율'), tools: [{ googleSearch: {} }] }, { generationConfig: { ...S, thinkingConfig: { thinkingBudget: 0 } } }, { generationConfig: MIN }],
    ['함수 호출(도구 경로)', { contents: txt('강남역 근처 약국 찾아줘'), tools: [{ functionDeclarations: [{ name: 'search_pharmacy', description: 'Find pharmacies near a place', parameters: { type: 'OBJECT', properties: { location: { type: 'STRING' } }, required: ['location'] } }] }] }, { generationConfig: { ...S, thinkingConfig: { thinkingBudget: 0 } } }, { generationConfig: MIN }],
    ['이미지 판독(vision)', { contents: [{ role: 'user', parts: [{ text: '이미지에 보이는 글자만 한 줄로' }, { inlineData: { mimeType: 'image/png', data: IMG } }] }] }, { generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }, { generationConfig: MIN }],
    ['YouTube fileData', { contents: [{ role: 'user', parts: [{ text: '영상 내용을 세 문장으로' }, { fileData: { fileUri: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', mimeType: 'video/mp4' } }] }] }, { generationConfig: { ...S, thinkingConfig: { thinkingBudget: 0 } } }, { generationConfig: MIN }],
    ['URL fileData(PDF)', { contents: [{ role: 'user', parts: [{ text: '문서 요약 한 문장' }, { fileData: { fileUri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', mimeType: 'application/pdf' } }] }] }, { generationConfig: { ...S, thinkingConfig: { thinkingBudget: 0 } } }, { generationConfig: MIN }],
    ['JSON(법령 해석)', { contents: txt('{"q":"근로기준법 연차 조항"} 을 {"law":"","article":""} JSON 으로') }, { generationConfig: { temperature: 0, responseMimeType: 'application/json' } }, { generationConfig: { responseMimeType: 'application/json', ...MIN } }],
];

async function once(model: string, body: any) {
    const t0 = Date.now();
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
        const j: any = await res.json().catch(() => null); const ms = Date.now() - t0;
        if (!res.ok) return { ok: false, ms, code: res.status };
        const c = j?.candidates?.[0]; const parts = c?.content?.parts ?? [];
        const len = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('').length;
        const fc = parts.some((p: any) => p.functionCall);
        return { ok: len > 0 || fc, ms, len, src: c?.groundingMetadata?.groundingChunks?.length ?? 0, out: j?.usageMetadata?.candidatesTokenCount ?? 0, think: j?.usageMetadata?.thoughtsTokenCount ?? 0 };
    } catch (e: any) { return { ok: false, ms: Date.now() - t0, code: e?.name }; }
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
for (const [name, input, c25, c35] of ROLES) {
    for (const [label, model, cfg] of [['2.5 Flash', 'gemini-2.5-flash', c25], ['3.5 FL', 'gemini-3.5-flash-lite', c35]] as const) {
        const rs = []; for (let i = 0; i < N; i++) rs.push(await once(model, { ...input, ...cfg }));
        const ok = rs.filter(r => r.ok); const codes = rs.filter(r => !r.ok).map(r => r.code);
        console.log(`${name.padEnd(26)} ${label.padEnd(9)} 성공 ${ok.length}/${N} · 지연 중앙 ${med(ok.map(r => r.ms))}ms · 길이 ${med(ok.map(r => r.len ?? 0))} · 출처 ${med(ok.map(r => r.src ?? 0))} · 생각 ${med(ok.map(r => r.think ?? 0))}${codes.length ? ` · 실패 ${codes.join(',')}` : ''}`);
    }
}
