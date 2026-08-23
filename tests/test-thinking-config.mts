/**
 * thinking 설정 하니스 — `npx tsx tests/test-thinking-config.mts`
 *
 * 프로덕션을 **임포트**한다(표 복사 금지).
 *
 * 🔴 왜 있는가:
 *   `resolveThinkingConfig` 는 계열 이분법이었다 — `is3xModel ? minimal : budget`.
 *   3.5·3.6 에서만 **우연히** 맞았다. **3.7 은 `minimal` 을 400 으로 거부**하므로
 *   3.7 을 계열에 넣는 순간 **전 호출 400**, 안 넣으면 2.5용 sampling 이 딸려온다.
 *   게다가 빈 응답 복구가 `'minimal'` 을 리터럴로 재시도해서, 3.7 에서는
 *   **복구 시도 자체가 에러**가 된다(복구 경로가 복구 불능).
 *
 *   이 하니스의 목적은 하나다: **3.7 경로에 `minimal` 이 새어 들어가면 즉시 빨간불.**
 *   3.7 은 아직 선택지가 아니지만(§5-2 미적용), 표에는 이미 있으므로 지금부터 감시된다.
 */

import { resolveThinkingConfig, thinkingRetryLevel } from '../server/agent/nodes/generation-config.js';
import { THINKING_MODE, lowestThinkingLevel, usesThinkingLevel, supportsThinkingLevel } from '../server/model-thinking.js';

let pass = 0, fail = 0;
const check = (group: string, name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${group}  ${name}`); }
    else { fail++; console.log(`❌ ${group}  ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const baseCtx = { isYoutubeRequest: false, hasVideoData: false, hasUrlContent: false, isMediaTurn: false, intent: 'general' };
const cfg = (model: string, over: Partial<typeof baseCtx> = {}) =>
    resolveThinkingConfig({ model, ...baseCtx, ...over }) as any;

// ── 1. 🔴 핵심 — 3.7 에 minimal 이 들어가면 안 된다 ────────────────────────────
const M37 = 'gemini-3.7-flash';
check('3.7 방어', 'minimal 을 지원 목록에 넣지 않는다',
    supportsThinkingLevel(M37, 'minimal') === false);
check('3.7 방어', '하한은 low 다',
    lowestThinkingLevel(M37) === 'low', `실제: ${lowestThinkingLevel(M37)}`);

// 프로덕션이 3.7 에 실제로 무엇을 넣는지 — **모든 경로**를 훑는다.
// (렌더러·YouTube·URL·미디어가 과거에 서로 다른 값을 쓰던 자리라 한 경로만 보면 놓친다)
const ALL_PATHS: Array<[string, Partial<typeof baseCtx>]> = [
    ['general',   {}],
    ['renderer',  { intent: 'astronomy' }],
    ['data_viz',  { intent: 'data_viz' }],
    ['medical_qa',{ intent: 'medical_qa' }],
    ['youtube',   { isYoutubeRequest: true, hasVideoData: true }],
    ['url',       { hasUrlContent: true }],
    ['media',     { isMediaTurn: true }],
];
for (const [label, over] of ALL_PATHS) {
    const c = cfg(M37, over);
    check('3.7 경로', `${label} → minimal 이 아니다`,
        c?.thinkingLevel !== 'minimal', `실제: ${JSON.stringify(c)}`);
    check('3.7 경로', `${label} → 지원하는 레벨만 쓴다`,
        !c?.thinkingLevel || supportsThinkingLevel(M37, c.thinkingLevel), `실제: ${JSON.stringify(c)}`);
}

// 복구 사다리도 400 을 내면 안 된다
check('3.7 복구', "medium 에서 재시도하면 low (minimal 아님)",
    thinkingRetryLevel(M37, 'medium') === 'low', `실제: ${thinkingRetryLevel(M37, 'medium')}`);
check('3.7 복구', '이미 하한이면 재시도하지 않는다',
    thinkingRetryLevel(M37, 'low') === undefined);

// ── 2. 회귀 가드 — 현행 모델의 동작이 하나도 바뀌지 않았다 ──────────────────
// 이 블록이 §5-1 의 "동작 변화 0" 주장을 검증한다.
for (const m of ['gemini-3.5-flash', 'gemini-3.6-flash']) {
    for (const [label, over] of ALL_PATHS) {
        check('3.x 회귀', `${m} ${label} → minimal 유지`,
            cfg(m, over)?.thinkingLevel === 'minimal', `실제: ${JSON.stringify(cfg(m, over))}`);
    }
}
const M25 = 'gemini-2.5-flash';
check('2.5 회귀', 'thinkingLevel 을 쓰지 않는다 (문서와 달리 400 거부)',
    usesThinkingLevel(M25) === false);
check('2.5 회귀', 'youtube → budget 0',   cfg(M25, { isYoutubeRequest: true }).thinkingBudget === 0);
check('2.5 회귀', 'url → budget 0',       cfg(M25, { hasUrlContent: true }).thinkingBudget === 0);
check('2.5 회귀', 'media → budget 0',     cfg(M25, { isMediaTurn: true }).thinkingBudget === 0);
check('2.5 회귀', 'medical_qa → budget 3000', cfg(M25, { intent: 'medical_qa' }).thinkingBudget === 3000);
check('2.5 회귀', 'general → undefined (모델 기본)', cfg(M25) === undefined);
check('2.5 복구', 'budget 경로는 내릴 칸이 없다', thinkingRetryLevel(M25, 'minimal') === undefined);

// ── 3. 표 자체의 무결성 ────────────────────────────────────────────────────
check('표', '미등록 모델은 budget 경로로 떨어진다(보수적)',
    usesThinkingLevel('gemini-9.9-flash') === false && lowestThinkingLevel('gemini-9.9-flash') === undefined);
for (const [model, spec] of Object.entries(THINKING_MODE)) {
    check('표', `${model} levels 는 낮은 것부터다`,
        spec.levels.length === 0 || spec.levels[0] === (['minimal', 'low', 'medium', 'high'] as const).find(l => spec.levels.includes(l)),
        `실제: ${JSON.stringify(spec.levels)}`);
}
check('표', 'budget 과 levels 를 둘 다 못 쓰는 모델은 없다',
    Object.values(THINKING_MODE).every(s => s.budget || s.levels.length > 0));

console.log(`\n통과 ${pass} · 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
