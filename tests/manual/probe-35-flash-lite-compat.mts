/**
 * 2.5 Flash 종료 대비 — 3.5 Flash-Lite 호환성(T1)·무료 키 검색(T2). `npx tsx tests/manual/probe-35-flash-lite-compat.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §3·§7
 *
 * T1(유료 키): 지금 2.5 경로가 보내는 설정·입력을 3.5 Flash-Lite 에 그대로/정리해서 보낸다.
 * T2(무료 키): 게스트 검색 강등 후보 — 3.5 FL 검색이 429 인지, 2.5 Flash-Lite 무료 검색 grounding 이 되는지.
 * 합성 입력만. 출력은 상태·지연·길이·출처 수만(답 원문 없음). 호출 13회.
 */
import fs from 'node:fs';
const env: Record<string, string> = {};
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const PAID = env.API_KEY_TIER1;
const FREE = Object.keys(env).filter(k => /^API_KEY\d*$/.test(k)).map(k => env[k]).find(Boolean);
if (!PAID || !FREE) { console.error('키 없음'); process.exit(1); }
const FL35 = 'gemini-3.5-flash-lite', FL25 = 'gemini-2.5-flash-lite';
const IMG = fs.readFileSync('scripts/movie-spike-output/badge-dark.png').toString('base64');

async function call(label: string, key: string, model: string, body: any) {
    const t0 = Date.now();
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
        });
        const ms = Date.now() - t0; const j: any = await res.json().catch(() => null);
        if (!res.ok) { console.log(`✗ ${label.padEnd(44)} HTTP ${res.status} ${j?.error?.status ?? ''} ${ms}ms`); return; }
        const c = j?.candidates?.[0]; const parts = c?.content?.parts ?? [];
        const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
        const fc = parts.some((p: any) => p.functionCall);
        const src = c?.groundingMetadata?.groundingChunks?.length ?? 0;
        const think = j?.usageMetadata?.thoughtsTokenCount ?? 0;
        console.log(`✓ ${label.padEnd(44)} ${ms}ms · 글자 ${text.length} · 함수호출 ${fc ? 'O' : '-'} · 출처 ${src} · 생각토큰 ${think} · ${c?.finishReason}`);
    } catch (e: any) { console.log(`✗ ${label.padEnd(44)} ${e?.name} ${Date.now() - t0}ms`); }
}
const txt = (t: string) => [{ role: 'user', parts: [{ text: t }] }];
const MIN = { thinkingConfig: { thinkingLevel: 'MINIMAL' } };

console.log('■ T1 3.5 Flash-Lite · 유료 키');
await call('thinkingBudget 3000 (medical_qa 경로)', PAID, FL35, { contents: txt('두통이 잦을 때 생활 습관 팁 세 가지'), generationConfig: { thinkingConfig: { thinkingBudget: 3000 } } });
await call('minimal + googleSearch (유료 검색)', PAID, FL35, { contents: txt('오늘 원달러 환율 알려줘'), tools: [{ googleSearch: {} }], generationConfig: MIN });
await call('minimal + 함수 호출 (도구 경로)', PAID, FL35, {
    contents: txt('강남역 근처 약국 찾아줘'),
    tools: [{ functionDeclarations: [{ name: 'search_pharmacy', description: 'Find pharmacies near a place', parameters: { type: 'OBJECT', properties: { location: { type: 'STRING' } }, required: ['location'] } }] }],
    generationConfig: MIN,
});
await call('minimal + 인라인 이미지 (vision)', PAID, FL35, { contents: [{ role: 'user', parts: [{ text: '이 이미지에 보이는 글자를 한 줄로' }, { inlineData: { mimeType: 'image/png', data: IMG } }] }], generationConfig: MIN });
await call('minimal + YouTube fileData', PAID, FL35, { contents: [{ role: 'user', parts: [{ text: '이 영상을 한 문장으로 요약' }, { fileData: { fileUri: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', mimeType: 'video/mp4' } }] }], generationConfig: MIN });
await call('minimal + 임의 URL fileData (PDF)', PAID, FL35, { contents: [{ role: 'user', parts: [{ text: '이 문서를 한 문장으로' }, { fileData: { fileUri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', mimeType: 'application/pdf' } }] }], generationConfig: MIN });
await call('temperature 0 + JSON, thinking 없음 (법령)', PAID, FL35, { contents: txt('{"q":"근로기준법 연차"} 를 {"law":..,"article":..} JSON 으로'), generationConfig: { temperature: 0, responseMimeType: 'application/json' } });
await call('temperature 0.2·topP·topK + minimal', PAID, FL35, { contents: txt('김치찌개 레시피 짧게'), generationConfig: { temperature: 0.2, topP: 0.8, topK: 40, ...MIN } });
await call('thinkingBudget 0 (재확인)', PAID, FL35, { contents: txt('안녕'), generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });

console.log('\n■ T2 무료 키 검색');
await call('3.5 FL + googleSearch (무료 키)', FREE, FL35, { contents: txt('오늘 원달러 환율 알려줘'), tools: [{ googleSearch: {} }], generationConfig: MIN });
await call('3.5 FL 검색 없음 (무료 키 지연)', FREE, FL35, { contents: txt('김치찌개 레시피 짧게'), generationConfig: MIN });
await call('2.5 FL + googleSearch budget 0 (무료 키)', FREE, FL25, { contents: txt('오늘 원달러 환율 알려줘'), tools: [{ googleSearch: {} }], generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });
await call('2.5 FL + googleSearch 약 검색형 (무료 키)', FREE, FL25, { contents: txt('타이레놀 공식 성분명과 주요 효능, 허가 기준 안전성 정보'), tools: [{ googleSearch: {} }], generationConfig: { temperature: 0.1 } });
