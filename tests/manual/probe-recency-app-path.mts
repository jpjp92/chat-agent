/**
 * 최신성 규칙 — **앱 경로** 실측(E3). `TIER1=1 npx tsx tests/manual/probe-recency-app-path.mts [runs=2]`
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2·W3
 *
 * route.ts 와 같은 그래프(라우터 → 검색 게이트 → 생성기)로 돌려, 운영 시스템 프롬프트 + 검색 턴 블록
 * (`[ACTIVE_WEB_SEARCH]` 의 최신성 규칙) 안에서 현행 세대를 고르는지 본다.
 * 정답표는 측정일 공식 페이지로 확정한 값만 쓴다(기억으로 채점하지 않는다 — 11-22 M6 오판).
 * 출력은 세대 판정·출처 수·모델·지연만. 답 원문은 저장·출력하지 않는다. 합성 질문.
 * 호출: 질문 4 × 모델 수 × runs — 턴마다 라우터 1 + 생성 1~2 (유료 키)
 */
import { existsSync, readFileSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
if (process.env.TIER1 === '1') {
    const t = process.env.API_KEY_TIER1;
    if (!t) { console.error('API_KEY_TIER1 없음'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = t;
} else { console.log('⚠️ TIER1=1 없이 돈다 — 무료 키는 검색 턴이 강등돼 앱(회원)과 다르다'); }

const RUNS = Number(process.argv[2] || 2);
const MODELS = (process.env.MODELS ?? 'gemini-3.8-flash,gemini-3.6-flash').split(',');

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { createStreamDispatch } = await import('../../server/agent/stream-dispatch.js');
const { HumanMessage } = await import('@langchain/core/messages');

// 정답표 — 2026-11-22 공식 페이지(apple.com/iphone · apple.com/macbook-pro · samsung.com/us/smartphones).
// 픽셀은 구글 스토어를 읽지 못해 채점하지 않는다(세대만 기록).
type Check = { label: string; re: RegExp; current: number; stale: number[] };
const pick = (text: string, re: RegExp) => [...new Set([...text.matchAll(re)].map(m => Number(m[1])))].sort((a, b) => a - b);
const CASES: { id: string; q: string; checks: Check[]; control?: true }[] = [
    {
        id: 'battery', q: '아이폰·갤럭시·픽셀 최신 모델 배터리 용량 비교 차트 그려줘', checks: [
            { label: '아이폰', re: /(?:아이폰|iPhone)\s*(\d{2})\s*(?:프로|Pro)/gi, current: 18, stale: [15, 16, 17] },
            { label: '갤럭시 S', re: /(?:갤럭시\s*|Galaxy\s*)S(\d{2})(?!\d)/gi, current: 26, stale: [23, 24, 25] },
        ],
    },
    { id: 'macbook', q: '최신 맥북 프로 칩 성능 비교해줘', checks: [{ label: '칩', re: /\bM(\d{1,2})\b/g, current: 6, stale: [3, 4] }] },
    { id: 'fold', q: '갤럭시 Z 폴드 최신 모델 가격 알려줘', checks: [{ label: '폴드', re: /(?:폴드|Fold)\s*(\d{1,2})/gi, current: 8, stale: [5, 6, 7] }] },
    { id: 'old', q: '아이폰 13 배터리 용량 알려줘', control: true, checks: [{ label: '아이폰', re: /(?:아이폰|iPhone)\s*(\d{2})/gi, current: 13, stale: [] }] },
];
const PIXEL = /(?:픽셀|Pixel)\s*(\d{1,2})(?!\d)/gi;
const ASOF = /(20\d{2})\s*년\s*\d{1,2}\s*월|기준|as of/i;

let turns = 0, pass = 0, staleOnly = 0;
for (const c of CASES) {
    console.log(`\n■ ${c.id}${c.control ? ' (대조: 옛 모델 지정)' : ''} — ${c.q}`);
    for (const model of MODELS) for (let r = 1; r <= RUNS; r++) {
        const t0 = Date.now();
        const dispatch = createStreamDispatch(() => {}, { timeZone: 'Asia/Seoul', lang: 'ko' });
        const st = dispatch.state;
        try {
            const graph = compileAgentGraph(getSystemInstruction('Korean'), false, dispatch.trackingEvent, 'Korean');
            const ev = await graph.streamEvents({
                messages: [new HumanMessage({ content: [{ type: 'text', text: c.q }] })],
                webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
                model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
                activeCards: [], cardContexts: [], lastTurnSearched: false, lastTurnSourceLabels: [],
            } as any, { version: 'v2' });
            for await (const e of ev as any) dispatch.handle(e);
        } catch (e: any) { console.log(`  ${model} #${r} 오류 ${String(e?.status ?? e?.code ?? e?.name ?? 'ERR')}`); continue; }
        turns++;
        const text: string = st.fullAiResponse;
        const cells: string[] = [];
        let ok = true, onlyStale = false;
        for (const ch of c.checks) {
            const gens = pick(text, ch.re);
            const hasCurrent = gens.includes(ch.current);
            const stale = gens.length > 0 && gens.every(g => ch.stale.includes(g));
            if (!hasCurrent) ok = false;
            if (stale) onlyStale = true;
            cells.push(`${ch.label} ${gens.join('/') || '-'}${hasCurrent ? ' ✅' : stale ? ' ❌낡음' : ' ?'}`);
        }
        if (!c.control) {
            cells.push(`픽셀 ${pick(text, PIXEL).join('/') || '-'}`);
            cells.push(ASOF.test(text) ? '기준시점 ✅' : '기준시점 -');
        }
        if (ok) pass++;
        if (onlyStale) staleOnly++;
        const usedModel = st.turn.model ?? '?';
        console.log(`  ${model.padEnd(17)} #${r} ${cells.join(' · ')} | 검색 ${st.turn.search ? 'on' : 'off'} · 출처 ${st.allSources.length} · 실제 ${usedModel}${usedModel !== model ? ' ⚠️' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
}
console.log(`\n== 턴 ${turns} · 정답 세대 포함 ${pass} · 낡은 세대만 ${staleOnly}`);
