/**
 * 최신성 V5 — 라인업 사전 조회 실험. `RUNS=3 MODELS=gemini-3.8-flash,gemini-3.6-flash npx tsx tests/manual/probe-recency-presearch.mts`
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2 (V5)
 *
 * 팔 v3: 운영 프롬프트 전체 + 사용자 메시지 기준 연·월 힌트(운영 현행).
 * 팔 v5: v3 + 본 생성 전에 짧은 검색 호출(PRE_MODEL)로 "현재 출시·판매 중인 최신 모델명"을 확인해 사용자 메시지에 근거로 넣는다.
 * 둘 다 운영과 같은 최저 생각 수준. 정답표는 측정일(2026-11-22) 공식 페이지 — 기억으로 채점하지 않는다.
 * 답 원문은 저장·출력하지 않는다 — 세대 번호·사전 조회 결과 한 줄·지연만. 합성 질문, 유료 키(TIER1).
 * 호출: 질문 3 × 모델 수 × RUNS × (v3 1 + v5 2)
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { lowestThinkingLevel } from '../../server/model-thinking.ts';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const { buildRecencyHint } = await import('../../server/agent/recency-hint.ts');

const MODELS = (process.env.MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash').split(',');
const RUNS = Number(process.env.RUNS ?? 3);
const PRE_MODEL = process.env.PRE_MODEL ?? 'gemini-3.6-flash';
const NOW = new Date('2026-11-22T03:00:00Z');
const HINT = buildRecencyHint(NOW, 'Asia/Seoul', 'Korean');
const PROD = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 22일 일요일]\n\n` + withSearchProviderInstruction(getSystemInstruction('Korean'), 'google');

type Check = { label: string; re: RegExp; current: number };
const pick = (t: string, re: RegExp) => [...new Set([...t.matchAll(re)].map(m => Number(m[1])))].sort((a, b) => a - b);
const CASES: { id: string; q: string; checks: Check[] }[] = [
    { id: 'battery', q: '아이폰·갤럭시·픽셀 최신 모델 배터리 용량 비교 차트 그려줘', checks: [
        { label: '아이폰Pro', re: /(?:아이폰|iPhone)\s*(\d{2})\s*(?:프로|Pro)/gi, current: 18 },
        { label: '갤럭시S', re: /(?:갤럭시\s*|Galaxy\s*)S(\d{2})(?!\d)/gi, current: 26 },
    ] },
    { id: 'macbook', q: '최신 맥북 프로 칩 성능 비교해줘', checks: [{ label: '칩', re: /\bM(\d{1,2})\b/g, current: 6 }] },
    { id: 'fold', q: '갤럭시 Z 폴드 최신 모델 가격 알려줘', checks: [{ label: '폴드', re: /(?:폴드|Fold)\s*(\d{1,2})/gi, current: 8 }] },
];
const PIXEL = /(?:픽셀|Pixel)\s*(\d{1,2})(?!\d)/gi;

// 사전 조회 — 모델명만. 수치·설명은 본 생성이 찾는다.
const PRE_PROMPT = (q: string) => `오늘은 2026년 11월 22일이다. 아래 질문이 묻는 제품군마다, 오늘 기준 **이미 출시되어 판매 중인 최신 세대**의 모델명을 공식 제조사 페이지 기준으로 검색해 확인하라. 기억 속 버전 번호를 믿지 말고, 검색어에 기억 속 번호를 넣지 말고 연도를 넣어라. 출력은 한 줄: "제품군: 모델명, 모델명; 제품군: …" — 설명·수치·출처 문장 없이.\n\n질문: ${q}`;

const gen = async (model: string, contents: string, system: string | undefined, thinking: boolean) => {
    const t0 = Date.now();
    const res: any = await ai.models.generateContent({
        model, contents,
        config: { ...(system ? { systemInstruction: system } : {}), tools: [{ googleSearch: {} }], ...(thinking ? { thinkingConfig: { thinkingLevel: lowestThinkingLevel(model) } } : {}) },
    });
    return { text: (res.text ?? '') as string, sec: (Date.now() - t0) / 1000 };
};

const tally: Record<string, { ok: number; n: number }> = {};
for (const c of CASES) {
    console.log(`\n■ ${c.id} — ${c.q}`);
    for (const model of MODELS) for (let r = 0; r < RUNS; r++) for (const arm of ['v3', 'v5'] as const) {
        try {
            let pre = '', preSec = 0;
            if (arm === 'v5') {
                const p = await gen(PRE_MODEL, PRE_PROMPT(c.q), undefined, true);
                pre = p.text.trim().replace(/\s+/g, ' ').slice(0, 300); preSec = p.sec;
            }
            const user = arm === 'v5'
                ? `${c.q}\n\n${HINT}\n(검색으로 확인된 현행 라인업: ${pre})`
                : `${c.q}\n\n${HINT}`;
            const m = await gen(model, user, PROD, true);
            const cells = c.checks.map(ch => {
                const g = pick(m.text, ch.re); const ok = g.includes(ch.current);
                const k = `${arm}|${ch.label}`; tally[k] = { ok: (tally[k]?.ok ?? 0) + (ok ? 1 : 0), n: (tally[k]?.n ?? 0) + 1 };
                return `${ch.label} ${g.join('/') || '-'}${ok ? ' ✅' : ' ❌'}`;
            });
            if (c.id === 'battery') cells.push(`픽셀 ${pick(m.text, PIXEL).join('/') || '-'}`);
            console.log(`  ${arm} ${model.padEnd(17)} #${r} ${cells.join(' · ')} | ${arm === 'v5' ? `사전 ${preSec.toFixed(1)}s + ` : ''}본 ${m.sec.toFixed(1)}s`);
            if (arm === 'v5') console.log(`      사전 조회: ${pre}`);
        } catch (e: any) {
            console.log(`  ${arm} ${model} #${r} 오류 ${e?.status ?? e?.code ?? e?.name}`);
        }
    }
}
console.log('\n== 항목별 정답');
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(14)} ${v.ok}/${v.n}`);
