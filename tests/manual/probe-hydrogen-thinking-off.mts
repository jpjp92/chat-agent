/**
 * Gemini 4 Hydrogen — thinking 을 끄거나 줄이는 설정 찾기 — `npx tsx tests/manual/probe-hydrogen-thinking-off.mts [diag]`
 * 계획: docs/plans/PLAN_GEMINI_4_HYDROGEN_261113.md §7
 *
 * 유료 호출(변형 수 × 질문 2, `diag` 는 4회). 합성 질문만. 문서에는 끄는 옵션이 없다 — 문서 밖 조합이 실제로 먹는지 본다.
 * `diag`: 지시문으로 thinking 을 막았을 때 답이 비는 턴의 종료 사유(finishReason)·토큰 내역을 찍는다.
 */
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_0-9]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });
const M = 'gemini-4-hydrogen';

const QS = [
    '한 문장으로 자기소개해줘.',
    '민수는 지호보다 키가 크다. 서연은 민수보다 작지만 지호보다는 크다. 키가 큰 순서대로 이름만 말해줘.',
];
const NO_THINK = '생각 과정 없이 곧바로 답한다. 내부 추론을 하지 말고 답만 쓴다.';

if (process.argv[2] === 'diag') {
    const LOGIC = '민수는 지호보다 키가 크다. 서연은 민수보다 작지만 지호보다는 크다. 세 사람을 키가 큰 순서대로 말해줘. 이유도 한 문장으로.';
    const JUG = '3리터 물통과 5리터 물통만으로 정확히 4리터를 만드는 방법을 단계별로 알려줘.';
    const sys = `한국어로 간결하고 정확하게 답한다. ${NO_THINK}`;
    const cases: { label: string; q: string; config: Record<string, unknown> }[] = [
        { label: 'logic · A/B 와 같은 설정', q: LOGIC, config: { systemInstruction: sys, temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } } },
        { label: 'logic · 출력 상한 없음', q: LOGIC, config: { systemInstruction: sys, temperature: 0, thinkingConfig: { thinkingLevel: 'low' } } },
        { label: 'jug   · A/B 와 같은 설정', q: JUG, config: { systemInstruction: sys, temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } } },
        { label: 'jug   · 출력 상한 없음', q: JUG, config: { systemInstruction: sys, temperature: 0, thinkingConfig: { thinkingLevel: 'low' } } },
    ];
    for (const c of cases) {
        const t0 = Date.now();
        try {
            const r = await ai.models.generateContent({ model: M, contents: c.q, config: c.config as any });
            const u = r.usageMetadata;
            console.log(`${c.label.padEnd(26)} finish=${r.candidates?.[0]?.finishReason} think=${u?.thoughtsTokenCount ?? 0} out=${u?.candidatesTokenCount ?? 0} total=${u?.totalTokenCount ?? 0} in=${u?.promptTokenCount ?? 0} textLen=${(r.text ?? '').length} ${Date.now() - t0}ms`);
        } catch (e: any) { console.log(`${c.label.padEnd(26)} ❌ ${e?.status ?? ''} ${String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 120)}`); }
    }
    process.exit(0);
}

const VARIANTS: { label: string; config: Record<string, unknown> }[] = [
    { label: 'low(기준)', config: { thinkingConfig: { thinkingLevel: 'low' } } },
    { label: 'low + budget 0', config: { thinkingConfig: { thinkingLevel: 'low', thinkingBudget: 0 } } },
    { label: "level 'none'", config: { thinkingConfig: { thinkingLevel: 'none' } } },
    { label: "level 'off'", config: { thinkingConfig: { thinkingLevel: 'off' } } },
    { label: 'low + includeThoughts false', config: { thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } } },
    { label: 'low + 지시문(생각 금지)', config: { thinkingConfig: { thinkingLevel: 'low' }, systemInstruction: NO_THINK } },
    { label: 'budget 0 + 지시문', config: { thinkingConfig: { thinkingBudget: 0 }, systemInstruction: NO_THINK } },
    { label: 'low + temperature 0', config: { thinkingConfig: { thinkingLevel: 'low' }, temperature: 0 } },
];

for (const v of VARIANTS) {
    const cells: string[] = [];
    for (const q of QS) {
        const t0 = Date.now();
        try {
            const r = await ai.models.generateContent({ model: M, contents: q, config: v.config as any });
            cells.push(`think=${String(r.usageMetadata?.thoughtsTokenCount ?? 0).padStart(4)} out=${String(r.usageMetadata?.candidatesTokenCount ?? 0).padStart(3)} ${String(Date.now() - t0).padStart(5)}ms`);
        } catch (e: any) {
            cells.push(`❌ ${e?.status ?? ''} ${String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 90)}`);
        }
    }
    console.log(`${v.label.padEnd(28)} | ${cells.join(' | ')}`);
}
