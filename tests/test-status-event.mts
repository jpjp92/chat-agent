/**
 * 서버 진행 상태 이벤트 하니스 — `npx tsx tests/test-status-event.mts`
 *
 * 원칙: 기본은 Orb 만. 서버만 아는 두 가지만 알린다 — lookup(외부 조회 의도 확정) · searching(실제 웹 검색 시작).
 * 실제 LangGraph `streamEvents` → `createStreamDispatch` → SSE 까지 지나서 판정한다(DEV_261010 §2-12).
 */
import fs from 'node:fs';
import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { statusForRouter, emitStatus } from '../server/agent/status-event.js';
import { createStreamDispatch } from '../server/agent/stream-dispatch.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got=${got} want=${want}`);

console.log('── ① 라우터 → lookup ──');
for (const intent of ['pharmacy_search', 'hospital_search', 'vet_search', 'law_search', 'law_qa', 'movie_search', 'weather', 'paper_search', 'arxiv_search', 'drug_info']) {
    eq(`조회 의도  ${intent}`, statusForRouter({ intent }), 'lookup');
}
for (const intent of ['general', 'medical_qa', 'biology', 'data_viz', 'drug_id']) {
    eq(`조회 아님  ${intent} (Orb 만)`, statusForRouter({ intent }), null);
}
eq('날씨 카드 후속은 조회 아님', statusForRouter({ intent: 'weather', weatherFollowup: true }), null);
eq('논문 카드 후속은 조회 아님', statusForRouter({ intent: 'paper_search', paperFollowup: true }), null);
eq('위치 카드 후속은 조회 아님', statusForRouter({ intent: 'pharmacy_search', cardFollowup: 'pharmacy' }), null);
eq('영화 후속(재검색 아님)은 조회 아님', statusForRouter({ intent: 'movie_search', movieFollowup: true }), null);
eq('영화 후속 + 재검색 턴은 조회', statusForRouter({ intent: 'movie_search', movieFollowup: true, movieSearchTurn: true }), 'lookup');
eq('출력 없음', statusForRouter(undefined), null);

console.log('\n── ② 디스패처 — 실제 그래프 이벤트로 ──');
/** 라우터 → generator 그래프. generator 는 검색을 켜면 emitStatus, 그 뒤 본문을 낸다. */
const runGraph = async (routerOut: any, opts: { search?: boolean; searchTwice?: boolean; statusAfterText?: boolean } = {}) => {
    const S = Annotation.Root({ intent: Annotation<string>(), x: Annotation<number>() });
    const g = new StateGraph(S)
        .addNode('router', async () => routerOut)
        .addNode('generator', async () => {
            if (opts.search) await emitStatus('searching');
            if (opts.searchTwice) await emitStatus('searching');   // 재시도 루프가 다시 켜는 경우
            return { x: 1 };
        })
        .addEdge(START, 'router').addEdge('router', 'generator').addEdge('generator', END).compile();
    const sent: any[] = [];
    const d = createStreamDispatch(e => sent.push(e));
    if (opts.statusAfterText) d.state.fullAiResponse = '이미 본문';
    for await (const e of await g.streamEvents({ intent: '', x: 0 }, { version: 'v2' })) d.handle(e);
    return sent.filter(e => 'status' in e).map(e => e.status).join(',');
};
eq('일반 질문 → 상태 없음(Orb 만)', await runGraph({ intent: 'general' }), '');
eq('일반 + 실제 검색 → searching', await runGraph({ intent: 'general', needsSearch: true }, { search: true }), 'searching');
eq('🔴 라우터 needsSearch 만으론 안 보낸다(이미지·URL 턴은 검색이 꺼짐)', await runGraph({ intent: 'general', needsSearch: true }), '');
eq('약국 조회 → lookup', await runGraph({ intent: 'pharmacy_search' }), 'lookup');
eq('약품 정보 + 검색 → lookup 다음 searching', await runGraph({ intent: 'drug_info' }, { search: true }), 'lookup,searching');
eq('재시도로 검색이 두 번 켜져도 한 번만', await runGraph({ intent: 'general' }, { search: true, searchTwice: true }), 'searching');
eq('본문이 이미 나갔으면 보내지 않는다', await runGraph({ intent: 'general' }, { search: true, statusAfterText: true }), '');

console.log('\n── ③ 배선 ──');
const gen = fs.readFileSync('server/agent/nodes/generator.ts', 'utf8');
check('Gemini 경로: 실제 검색 결정 직후 searching', /if \(useGoogleSearch\) await emitStatus\('searching'\)/.test(gen));
check('OpenAI 경로: 실제 검색 결정 직후 searching', /if \(useWebSearch\) await emitStatus\('searching'\)/.test(gen));
const svc = fs.readFileSync('services/geminiService.ts', 'utf8');
check('클라이언트 SSE 파서가 status 를 넘긴다', svc.includes('if (data.status && onStatus) onStatus(data.status);'));
const hook = fs.readFileSync('src/hooks/useChatStream.ts', 'utf8');
check('본문이 시작됐으면 상태 문구를 띄우지 않는다', /if \(modelResponse\) return;\s*\n\s*if \(serverStatus === 'searching'\)/.test(hook));
for (const lang of ['ko', 'en', 'es', 'fr']) {
    const sec = hook.slice(hook.indexOf(`  ${lang}: {`)).split('\n  },')[0];
    check(`${lang} searchingWeb·lookingUp 문구`, /searchingWeb: '/.test(sec) && /lookingUp: '/.test(sec));
}
const ko = hook.slice(hook.indexOf('  ko: {'), hook.indexOf('  en: {'));
check('ko 문구도 "중입니다"', /searchingWeb: '[^']*중입니다'/.test(ko) && /lookingUp: '[^']*중입니다'/.test(ko));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
