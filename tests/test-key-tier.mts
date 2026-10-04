/**
 * 회원 유료 키 우선 — PLAN_GEMINI_PAID_FIRST_261004 §2-1 · §4-3.
 *
 * 지키는 계약:
 *   1. 게스트(컨텍스트 없음 / free)는 유료 키를 **절대** 받지 않는다
 *   2. 스위치(GEMINI_PAID_FIRST) off = 현행 — 회원도 무료 로테이션만
 *   3. 회원(paid-first)은 유료 키를 먼저 받고, 유료 키가 쿨다운이면 무료로 내려간다
 *   4. 컨텍스트가 await 를 건너 이어진다 (ReadableStream start 안의 그래프 실행 흉내)
 *   5. 검색 강등은 키에 달렸다 — 유료 키 + 3.6 은 강등 안 함, 무료 키 + 3.6 은 2.5 로
 *
 * config.ts 는 `server-only` 라 react-server 조건으로 자기 자신을 다시 띄운다. 네트워크 호출 없음.
 */
import { spawnSync } from 'node:child_process';

if (!process.env.__KEY_TIER_CHILD) {
    const r = spawnSync('npx', ['tsx', '--conditions=react-server', new URL(import.meta.url).pathname], {
        stdio: 'inherit',
        env: {
            ...process.env, __KEY_TIER_CHILD: '1',
            API_KEY: 'free-a', API_KEY2: 'free-b', API_KEY_TIER1: 'paid-x', GEMINI_PAID_FIRST: 'true',
        },
    });
    process.exit(r.status ?? 1);
}

// .env 가 끼어들지 않게 키 env 는 부모가 고정했다 — config 는 import 시점에 API_KEY* 를 읽는다
for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k) && !['API_KEY2'].includes(k)) delete process.env[k];

const { getNextApiKey, markKeyRateLimited, isPaidKey } = await import('../server/config.js');
const { runWithKeyTier } = await import('../server/key-tier.js');
const { modelCaps } = await import('../server/models.js');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
    if (!ok) fail++;
};
const draw = (n: number) => Array.from({ length: n }, () => getNextApiKey());

// 1. 게스트
const guest = [...draw(6), ...runWithKeyTier('free', () => draw(6))];
check('게스트·컨텍스트 없음은 유료 키를 받지 않는다', !guest.includes('paid-x'), guest.join(','));

// 2. 스위치 off
process.env.GEMINI_PAID_FIRST = 'false';
const off = runWithKeyTier('paid-first', () => draw(4));
check('스위치 off 면 회원도 무료 로테이션만', !off.includes('paid-x'), off.join(','));
process.env.GEMINI_PAID_FIRST = 'true';

// 3. 회원 유료 우선 → 쿨다운 시 무료
const member = runWithKeyTier('paid-first', () => draw(3));
check('회원은 유료 키를 먼저 (매 호출 — router·generator 각각)', member.every(k => k === 'paid-x'), member.join(','));
markKeyRateLimited('paid-x');
const afterFail = runWithKeyTier('paid-first', () => draw(2));
check('유료 키 쿨다운이면 무료 로테이션으로', afterFail.every(k => k === 'free-a' || k === 'free-b'), afterFail.join(','));

// 4. await 를 건너 컨텍스트 유지 — 쿨다운 없는 새 키로
process.env.API_KEY_TIER1 = 'paid-y';
const viaStream = await runWithKeyTier('paid-first', () => new Promise<string | null>(resolve => {
    new ReadableStream({
        async start() {
            await new Promise(r => setTimeout(r, 5));
            await Promise.resolve();
            resolve(getNextApiKey());
        },
    });
}));
check('ReadableStream start 안 await 뒤에도 회원 등급 유지', viaStream === 'paid-y', String(viaStream));
const outside = getNextApiKey();
check('컨텍스트 밖으로 새지 않는다', outside !== 'paid-y', String(outside));

// 5. 검색 강등 판단 (generator.ts searchFallbackFor 와 같은 식)
const caps = modelCaps('gemini-3.6-flash');
const searchFallbackFor = (k: string) => (!caps.freeTierSearch && !isPaidKey(k)) || !caps.groundingReliable;
check('유료 키 + 3.6 검색은 강등하지 않는다', searchFallbackFor('paid-y') === false);
check('무료 키 + 3.6 검색은 2.5 로 강등', searchFallbackFor('free-a') === true);
check('2.5 는 키와 무관하게 강등 대상 아님', !(!modelCaps('gemini-2.5-flash').freeTierSearch || !modelCaps('gemini-2.5-flash').groundingReliable));

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ key-tier 계약 전부 통과');
process.exit(fail ? 1 : 0);
