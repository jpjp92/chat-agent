/**
 * 최신 라인업 질문 — 모델별 세대 선택 · `[RECENCY]` 규칙 팔 비교(독립 프로브, 합성 질문, 유료 키 TIER1)
 *   `ARM=base|rule MODELS=gemini-3.8-flash,gemini-3.6-flash RUNS=5 npx tsx tests/manual/probe-lineup-models.mts`
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2 (E1)
 * 운영 프롬프트 없이 날짜 한 줄 + 질문 + Google 검색만 — 모델·규칙 자체의 효과를 본다(운영 경로는 E3).
 * 답 원문은 저장·출력하지 않는다 — 세대 번호와 검색어만.
 * 호출: 모델 수 × RUNS (Gemini 4 는 1회 55~110s)
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { RECENCY_RULE, DATE_LINE } from './recency-rule-text.mts';
import { lowestThinkingLevel } from '../../server/model-thinking.ts';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });

const MODELS = (process.env.MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash,gemini-4-neon,gemini-4-hydrogen').split(',');
const RUNS = Number(process.env.RUNS ?? 3);
const Q = '아이폰·갤럭시·픽셀 최신 모델 배터리 용량 비교 차트 그려줘';
const BASE = DATE_LINE;
const RULE = RECENCY_RULE;
const ARM = process.env.ARM ?? 'base';
// THINK=lowest → 운영과 같은 최저 생각 수준(resolveThinkingConfig). 미지정이면 모델 기본값.
const THINK = process.env.THINK;
// SYS=prod → 운영 시스템 프롬프트 전체(시각 블록 + base + 검색 턴 블록). 규칙은 검색 턴 블록에 이미 들어 있다.
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { withSearchProviderInstruction } = await import('../../server/agent/search-provider.ts');
const PROD = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 22일 일요일]\n\n` + withSearchProviderInstruction(getSystemInstruction('Korean'), 'google');
// VARIANT(SYS=prod 일 때): top = 규칙을 시각 블록 바로 뒤로 · turn = 끝에 "이번 턴은 최신 질문" 직접 지시
const TIME = `[CURRENT_SYSTEM_TIME (Timezone: Asia/Seoul): 2026년 11월 22일 일요일]\n\n`;
const TURN_DIRECTIVE = `\n\n[THIS TURN — LATEST PRODUCTS] The user is asking for the latest/current products. Before anything else, search the current lineup with this year (${'2026'}) and no remembered version numbers; build the answer only from models that search confirms, and state the as-of date.`;
const VARIANT = process.env.VARIANT;
const PROD_TOP = TIME + RECENCY_RULE.trim() + '\n\n' + withSearchProviderInstruction(getSystemInstruction('Korean'), 'google');
const SYS = process.env.SYS === 'prod'
    ? (VARIANT === 'top' ? PROD_TOP : VARIANT === 'turn' ? PROD + TURN_DIRECTIVE : PROD)
    : ARM === 'rule' ? BASE + RULE : BASE;

const gens = (t: string) => {
    const pick = (re: RegExp) => [...new Set([...t.matchAll(re)].map(m => m[1]))].sort((a, b) => +a - +b).join('/') || '-';
    return {
        iphone: pick(/(?:아이폰|iPhone)\s*(\d{2})/gi),
        galaxy: pick(/(?:갤럭시\s*|Galaxy\s*)?S(\d{2})(?![\d])/g),
        pixel: pick(/(?:픽셀|Pixel)\s*(\d{1,2})(?![\d])/gi),
    };
};

for (const model of MODELS) for (let r = 0; r < RUNS; r++) {
    const t0 = Date.now();
    try {
        const res: any = await ai.models.generateContent({
            model, contents: VARIANT === 'user' ? `${Q}\n\n(기준: 2026년 11월 현재 판매 중인 최신 라인업)` : Q,
            config: { systemInstruction: SYS, tools: [{ googleSearch: {} }], ...(THINK === 'lowest' && VARIANT !== 'think' ? { thinkingConfig: { thinkingLevel: lowestThinkingLevel(model) } } : {}) },
        });
        const text: string = res.text ?? '';
        const gm = res.candidates?.[0]?.groundingMetadata;
        const g = gens(text);
        const u = res.usageMetadata ?? {};
        console.log(`[${process.env.SYS === 'prod' ? `prod${VARIANT ? `+${VARIANT}` : ''}` : ARM}${THINK ? `/${THINK}` : ''}] ${model.padEnd(18)} #${r} 아이폰 ${g.iphone.padEnd(6)} 갤럭시 S${g.galaxy.padEnd(6)} 픽셀 ${g.pixel.padEnd(6)} | 출처 ${gm?.groundingChunks?.length ?? 0} | 검색어 ${JSON.stringify(gm?.webSearchQueries ?? [])} | ${((Date.now() - t0) / 1000).toFixed(1)}s tok ${u.promptTokenCount ?? '?'}/${u.candidatesTokenCount ?? '?'}`);
    } catch (e: any) {
        console.log(`[${ARM}] ${model.padEnd(18)} #${r} 오류 ${e?.status ?? e?.code ?? e?.name}`);
    }
}
