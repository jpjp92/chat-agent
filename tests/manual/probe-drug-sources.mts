/**
 * 약 답의 출처 칩 — 식약처 상세 페이지가 붙는지 본다(DEV_261025). 라우트와 같은 createStreamDispatch 를 태운다.
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-drug-sources.mts [결과.json]
 * 실키 수동 하니스 — npm test 제외.
 */
import fs from 'node:fs';
for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
if (process.env.TIER1 !== '1' || !process.env.API_KEY_TIER1) { console.error('TIER1=1 과 API_KEY_TIER1 이 필요하다(무료 키 소진 방지)'); process.exit(1); }
for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
process.env.API_KEY = process.env.API_KEY_TIER1;

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { createStreamDispatch } = await import('../../server/agent/stream-dispatch.js');
const { drugCardSources } = await import('../../server/agent/drug-card-urls.js');
const { HumanMessage } = await import('@langchain/core/messages');

const DRUGS = ['타이레놀정500밀리그람 알려줘', '마그네스정 알려줘', '게보린정 알려줘', '판콜에이내복액 알려줘'];
const MODELS = (process.env.MODELS ?? 'gpt-5.6-luna,gemini-3.6-flash').split(',');
const rows: any[] = [];
for (const model of MODELS) {
    for (const q of DRUGS) {
        const d = createStreamDispatch(() => {}, { timeZone: 'Asia/Seoul', lang: 'ko' });
        const graph = compileAgentGraph(getSystemInstruction('Korean'), false, d.trackingEvent, 'Korean');
        const t0 = Date.now();
        let error: string | null = null;
        try {
            const events = await graph.streamEvents({
                messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })], webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
                model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [], lastTurnSearched: false,
            }, { version: 'v2' });
            for await (const ev of events) d.handle(ev);
        } catch (e: any) { error = String(e?.message ?? e).slice(0, 120); }
        const added = new Set(drugCardSources(d.state.fullAiResponse).map(s => s.uri));
        const card = d.state.fullAiResponse.match(/```json:drug\s*\n([\s\S]*?)\n```/);
        let cardName: string | null = null;
        try { cardName = card ? JSON.parse(card[1]).name ?? null : null; } catch { /* 깨진 카드 */ }
        const row = {
            model, q, ms: Date.now() - t0, error, card: !!card, cardName,
            sources: d.state.allSources.map((s: any) => ({ title: s.title, uri: s.uri, added: added.has(s.uri) })),
        };
        rows.push(row);
        console.log(`${model} | ${q} | 카드 ${row.card ? '있음' : '없음'} | 출처 ${row.sources.length}(식약처 추가 ${added.size}) | ${row.ms}ms${error ? ' | ERR ' + error : ''}`);
    }
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
