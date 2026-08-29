/**
 * 라이브 후속턴 확인 — `npx tsx tests/manual/live-citation-followup.mts [model]`
 *
 * 실제로 깨졌던 대화(세션 6bd6817b, 2026-08-24)를 히스토리로 재생해 **실제 그래프**를 돌리고,
 * 최종 본문에 grounding redirect URL 이 노출되는지 본다.
 * (라우트는 Supabase 인증을 요구하므로 route.ts 와 같은 initialState 로 그래프를 직접 호출한다)
 *
 * 마커 `](url)` 는 정상. 그 밖의 vertexaisearch 등장은 버그다.
 * 실키를 쓰는 수동 하니스라 `npm test` 에는 넣지 않는다.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { buildHistoryMessages, deriveLastTurnSearched } = await import('../../server/agent/history.js');

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data } = await db.from('chat_messages')
    .select('role,content,grounding_sources,created_at')
    .eq('session_id', '6bd6817b-a080-45e5-bcdb-4d857a14515b')
    .order('created_at', { ascending: true }).limit(2);

const history = (data ?? []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    content: m.content,
    groundingSources: (m as any).grounding_sources ?? undefined,
}));
const prevMarkers = (history.find(h => h.role === 'model')?.content.match(/\]\(https:\/\/vertexaisearch/g) || []).length;
const contents = buildHistoryMessages(history as any);
const sentToModel = String((contents[1] as any).content);
console.log('히스토리 원문 마커:', prevMarkers, '→ 모델에 전달된 마커:', (sentToModel.match(/vertexaisearch/g) || []).length);

// 이번 턴 사용자 발화 — route.ts 와 동일하게 마지막에 붙인다.
const { HumanMessage } = await import('@langchain/core/messages');
const followup = process.argv[3] || '거의 사이버전쟁이네. 최신 뉴스 검색해서 근거랑 같이 설명해줘';
contents.push(new HumanMessage({ content: [{ type: 'text', text: followup }] }));

const model = process.argv[2] || 'gemini-3.7-flash';
let streamed = '';
const graph = compileAgentGraph(getSystemInstruction('Korean'), false, (d: any) => { if (d.text) streamed += d.text; }, 'Korean');
const out: any = await graph.invoke({
    messages: contents, webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
    model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [],
    lastTurnSearched: deriveLastTurnSearched(history as any),
});

const text = (typeof out?.messages?.at(-1)?.content === 'string' ? out.messages.at(-1).content : '') || streamed;
const sources: any[] = out?.groundingSources ?? [];
const markers = (text.match(/\]\(https:\/\/vertexaisearch/g) || []).length;
const total = (text.match(/vertexaisearch/g) || []).length;

console.log('\n--- 본문 앞부분 ---\n' + text.slice(0, 400).replace(/\n/g, ' '));
console.log('\n모델:', model, '| 출처:', sources.length, '| 마커:', markers, '| 노출 URL:', total - markers);
console.log(total - markers === 0 ? '🟢 생 URL 노출 없음' : '🔴 생 URL 노출');
process.exit(total - markers === 0 ? 0 : 1);
