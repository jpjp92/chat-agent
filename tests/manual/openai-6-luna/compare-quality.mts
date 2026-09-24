/**
 * gpt-6-luna vs gpt-5.6-luna — **정답률** 비교 프로브.
 *
 * 앞선 두 프로브는 *계약*을 봤다(연결·capability, 도구 11종). 계약이 같다고 답이 같지는 않다.
 * 여기서 재는 건 **같은 질문에 같은 프롬프트로 물었을 때 맞히는가** 다.
 *
 * 🔴 픽스처와 채점기는 `gemini-3-8/tc-intents.mts` 를 **그대로 import** 한다.
 *    복사하면 한쪽을 고친 뒤 다른 쪽이 조용히 어긋나고, 그러면 두 측정이 **비교 불가**가 된다
 *    (3.6·3.7·3.8 수치와 나란히 놓으려면 자가 같아야 한다).
 *    그 채점기의 설계 두 가지가 여기서도 그대로 중요하다:
 *      · 산문과 렌더러 블록을 **따로** 센다 — 차트 안의 숫자는 "모델이 답했다"가 아니다
 *      · 프롬프트가 이미 예시로 보여주는 분자·별자리는 픽스처에서 **배제**했다 — 베껴 쓰기가 정답이 되면 안 된다
 *
 * 조건을 고정한다(프롬프트 = 프로덕션 조립, 도구·검색 없음, reasoning = capability 값).
 * **모델 외의 변수를 같이 움직이면 무엇이 원인인지 말할 수 없다.**
 *
 * ⚠️ 이 시험은 **천장에 부딪힐 수 있다.** 같은 14문항으로 3.6·3.7·3.8 을 쟀을 때 252회가
 *    전부 통과해 변별이 0이었다(DEV_260922). 전부 만점이면 "두 모델이 같다"가 아니라
 *    **"이 문항으로는 못 가린다"** 로 읽어야 한다. 그때 다음 수는 문항 난이도 상향이다.
 *
 * 실행: npx tsx --tsconfig tests/tsconfig.probe.json --env-file=.env.local \
 *         tests/manual/openai-6-luna/compare-quality.mts [라운드수=2]
 * (OPENAI_API_KEY_TIER1 필요 · 실제 비용 · 기본 14×2×2=56회 · `npm test` 제외)
 */
import fs from 'node:fs';
import { HumanMessage } from '@langchain/core/messages';
import { generateOpenAIChat } from '../../../server/openai/chat.js';
import { getSystemInstruction, getRendererSections, getIntentPolicy } from '../../../server/agent/prompt.js';
import { openAIModelCapabilities } from '../../../server/openai/models.js';
import { tcs, score } from '../gemini-3-8/tc-intents.mjs';

if (!process.env.OPENAI_API_KEY_TIER1) {
    console.error('OPENAI_API_KEY_TIER1 이 필요합니다 (--env-file=.env.local).');
    process.exit(1);
}

const MODELS = ['gpt-5.6-luna', 'gpt-6-luna'] as const;
const ROUNDS = Number(process.argv[2] ?? 2);
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4096;

/** 단일 `$` 누출 — 3.8 측정에서 **유일한 변별 축**이었다(3.6 만 4/84). 이진 정답률 밖의 결함이라
 *  합격·불합격으로 세지 않고 **지표로만** 남긴다. 앱은 `singleDollarTextMath:false` 라 화면에 생글자로 나온다. */
const SINGLE_DOLLAR = /(?<!\$)\$(?!\$)[^$\n]{1,80}\$(?!\$)/g;

const cases = tcs.map(tc => ({
    tc,
    // 프로덕션과 같은 조립 — base + 의도별 렌더러 스펙 + 의도 정책.
    instructions: [getSystemInstruction('Korean'), getRendererSections(tc.intent, 'Korean'),
        getIntentPolicy(tc.intent)].filter(Boolean).join('\n\n'),
}));

const maxCalls = cases.length * MODELS.length * ROUNDS;
if (maxCalls > 200) { console.error(`호출 ${maxCalls}회는 너무 많다 — 라운드를 줄여라.`); process.exit(1); }

type Row = {
    round: number; model: string; case: string; intent: string;
    pass: boolean; checks: Record<string, boolean>; failed: string[];
    singleDollar: number; chars: number; ms: number; error?: string;
    /** 🔴 실패한 응답의 본문. 없으면 진단하려고 **다시 호출해야 한다** — 초판이 그랬다.
     *  실패는 재현되지 않는 경우가 많아서(둘 다 1/28 이 재실행에서 8/8 통과였다)
     *  그 순간의 글을 남기지 않으면 그 실패는 영원히 못 본다. 통과는 저장하지 않는다(용량). */
    text?: string;
};
const rows: Row[] = [];

console.log(JSON.stringify({ models: MODELS, rounds: ROUNDS, cases: cases.length, maxCalls,
    reasoning: Object.fromEntries(MODELS.map(m => [m, openAIModelCapabilities(m).chatReasoningEffort])) }));

for (let round = 0; round < ROUNDS; round++) {
    for (const [i, c] of cases.entries()) {
        // 어느 모델이 먼저 도는지 돌린다 — 공급자 쪽 웜업·드리프트가 한쪽만 돕지 않게.
        const shift = (round + i) % MODELS.length;
        for (const model of [...MODELS.slice(shift), ...MODELS.slice(0, shift)]) {
            const startedAt = Date.now();
            try {
                const r = await generateOpenAIChat({
                    model, instructions: c.instructions,
                    messages: [new HumanMessage(c.tc.q)],
                    useWebSearch: false, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS,
                });
                const checks = score(c.tc, r.text);
                const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
                rows.push({
                    round, model, case: c.tc.id, intent: c.tc.intent,
                    pass: failed.length === 0, checks, failed,
                    singleDollar: (r.text.match(SINGLE_DOLLAR) ?? []).length,
                    chars: r.text.length, ms: Date.now() - startedAt,
                    ...(failed.length ? { text: r.text.slice(0, 4000) } : {}),
                });
            } catch (error: any) {
                rows.push({
                    round, model, case: c.tc.id, intent: c.tc.intent, pass: false, checks: {},
                    failed: ['ERROR'], singleDollar: 0, chars: 0, ms: Date.now() - startedAt,
                    error: `${error?.status ?? ''} ${error?.code ?? ''} ${error?.message ?? error}`.trim(),
                });
            }
            const last = rows[rows.length - 1];
            console.log(`  r${round} ${model.padEnd(13)} ${c.tc.id.padEnd(26)} ${last.pass ? 'PASS' : 'FAIL'} (${last.ms}ms)` +
                (last.pass ? '' : `  ${last.error ?? last.failed.join(',')}`));
        }
    }
}

const of = (m: string) => rows.filter(r => r.model === m);
const rate = (rs: Row[]) => rs.length ? rs.filter(r => r.pass).length / rs.length : 0;
const median = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;

console.log('\n── 의도별 정답률 ──');
const intents = [...new Set(cases.map(c => c.tc.intent))].sort();
for (const intent of intents) {
    const cells = MODELS.map(m => of(m).filter(r => r.intent === intent));
    const rs = cells.map(rate);
    console.log(`${rs[0] === rs[1] ? '  ' : '❗'} ${intent.padEnd(12)} ` +
        MODELS.map((m, i) => `${m}=${(rs[i] * 100).toFixed(0)}% (${cells[i].filter(r => r.pass).length}/${cells[i].length})`).join('  '));
}

console.log('\n── 총계 ──');
for (const m of MODELS) {
    const rs = of(m);
    console.log(`  ${m.padEnd(13)} 정답률 ${(rate(rs) * 100).toFixed(1)}% (${rs.filter(r => r.pass).length}/${rs.length})` +
        `  지연 중앙값 ${median(rs.map(r => r.ms))}ms  단일$ ${rs.reduce((a, r) => a + r.singleDollar, 0)}건/${rs.filter(r => r.singleDollar > 0).length}개응답` +
        `  오류 ${rs.filter(r => r.error).length}`);
}

const failuresByCase = (m: string) => of(m).filter(r => !r.pass)
    .map(r => `${r.case}:${r.error ? 'ERROR' : r.failed.join('+')}`);
for (const m of MODELS) {
    const f = failuresByCase(m);
    if (f.length) console.log(`  ${m} 실패 상세: ${[...new Set(f)].join(' · ')}`);
}

const out = `/tmp/openai-luna-quality-${Date.now()}.json`;
fs.writeFileSync(out, JSON.stringify({ models: MODELS, rounds: ROUNDS, rows, finishedAt: new Date().toISOString() }, null, 2));
console.log(`\n리포트 ${out}`);

const rates = MODELS.map(m => rate(of(m)));
if (rates.every(r => r === 1)) {
    console.log('\n⚠️  전부 만점 — **천장이다.** "두 모델이 같다"가 아니라 "이 문항으로는 못 가린다" 로 읽어라.');
    console.log('    다음 수는 문항 난이도 상향이고, 그 전까지 이 결과로 모델을 고르면 안 된다.');
} else {
    console.log(`\n정답률 차이 ${Math.abs(rates[0] - rates[1]) * 100 > 0 ? (Math.abs(rates[0] - rates[1]) * 100).toFixed(1) + '%p' : '없음'}` +
        ' — 라운드가 적으면 우연이다. 차이가 보이면 라운드를 늘려 재현부터 확인하라.');
}
