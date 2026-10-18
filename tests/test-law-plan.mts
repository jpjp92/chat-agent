/**
 * 법령 조회 계획 — `npx tsx tests/test-law-plan.mts` (server/agent/law-tool.ts)
 * 2026-10-18 GPT 경로 law_qa 가 mode 를 비워 보내 list(법령 이름·시행일만)로 조회 → 조문 없는 일반론 해설(DEV_261018 §11).
 * law-tool 이 `server-only`(config) 를 끌어와 react-server 조건으로 자기 자신을 다시 띄운다. 네트워크 호출 없음.
 */
import { spawnSync } from 'node:child_process';

if (!process.env.__LAW_PLAN_CHILD) {
    const r = spawnSync('npx', ['tsx', '--conditions=react-server', new URL(import.meta.url).pathname], {
        stdio: 'inherit', env: { ...process.env, __LAW_PLAN_CHILD: '1' },
    });
    process.exit(r.status ?? 1);
}

const { buildFallbackLawPlan, tokenizeQuery } = await import('../server/agent/law-tool.js');

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`); };

const q = { query: '소음진동관리법 설명해줘', law_name: '소음진동관리법' };
check('해설(default_mode body): mode 가 비면 body', buildFallbackLawPlan({ ...q, default_mode: 'body' }).mode === 'body', buildFallbackLawPlan({ ...q, default_mode: 'body' }));
check('카드(기본): mode 가 비면 list', buildFallbackLawPlan(q).mode === 'list');
check('모델이 준 mode 는 그대로', buildFallbackLawPlan({ ...q, mode: 'list', default_mode: 'body' }).mode === 'list');
check('조문 번호가 있으면 article', buildFallbackLawPlan({ ...q, article_no: '제57조', default_mode: 'body' }).mode === 'article');
check('조사 뗀 토큰: 벌금은? → 벌금', tokenizeQuery('소음ㆍ진동관리법 벌금은?', '소음ㆍ진동관리법').includes('벌금'), tokenizeQuery('소음ㆍ진동관리법 벌금은?', '소음ㆍ진동관리법'));
check('원래 토큰도 유지', tokenizeQuery('벌금은?').includes('벌금은'));
check('조사 아닌 끝글자는 그대로(과태료)', tokenizeQuery('과태료').join() === '과태료', tokenizeQuery('과태료'));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
