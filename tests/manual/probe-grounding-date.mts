/**
 * §5-a 근본 원인 확인 — **그라운딩이 자기 날짜를 주입하는가?**
 *
 * §10-13 측정에서 실패가 전부 `오늘을 9/28 로 틀리게 단정` 이었다. 9/28 은 **진짜 오늘**이고,
 * 프로세스 시계로 주입한 "주장된 오늘" 은 9/29 다. 즉 모델이 **우리 값이 아니라 다른 날짜**를 쓴다.
 * 프로세스 시계를 옮겨도 Google 검색 도구 쪽 날짜는 안 바뀌므로, 그라운딩이 자체 날짜를
 * 물고 들어온다는 가설이 선다(DEV_260928 §7 은 이 가설을 기각했다고 적었다 — 재확인한다).
 *
 * 판별: **같은 질문**을 검색 ON/OFF 로 나눠 던진다.
 *   - 검색 OFF 에서 9/29(주입값) 라고 하면 → 프롬프트는 잘 먹고 있다
 *   - 검색 ON 에서만 9/28(실제) 로 바뀌면 → **그라운딩이 날짜를 덮는다**(프롬프트 문구로는 못 고친다)
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
}

const RealDate = Date;
const kst = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const realToday = kst(new RealDate());
const tomorrow = new RealDate(new RealDate().getTime() + 86400000);
const claimed = kst(tomorrow);
// 내일 00:20 KST 로 옮긴다
const target = new RealDate(`${claimed}T00:20:00+09:00`);
const offset = target.getTime() - RealDate.now();
class Shifted extends RealDate {
    constructor(...a: any[]) { super(...(a.length ? a : [RealDate.now() + offset]) as []); }
    static now() { return RealDate.now() + offset; }
}
(globalThis as any).Date = Shifted;

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { HumanMessage } = await import('@langchain/core/messages');

const ask = async (q: string, needsSearch: boolean) => {
    const graph = compileAgentGraph(getSystemInstruction('Korean'), false, () => {}, 'Korean', {});
    let out = '', src = 0;
    const ev = await graph.streamEvents({
        messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })],
        webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
        model: 'gemini-2.5-flash', timeZone: 'Asia/Seoul', nextNode: 'generator', movieContext: '',
        activeCards: [], cardContexts: [], lastTurnSearched: false, intent: 'general', needsSearch,
    } as any, { version: 'v2' });
    for await (const e of ev as any) {
        if (e.event === 'on_chat_model_stream' && e.metadata?.langgraph_node === 'generator') {
            const t = e.data?.chunk?.content; if (typeof t === 'string') out += t;
        } else if (e.event === 'on_chain_end' && e.name === 'generator') {
            if (Array.isArray(e.data?.output?.groundingSources)) src = e.data.output.groundingSources.length;
            const m = e.data?.output?.messages?.[0]?.content;
            if (!out && typeof m === 'string') out = m;
        }
    }
    return { out, src };
};

const [cm, cd] = claimed.split('-').slice(1).map(Number);
const [rm, rd] = realToday.split('-').slice(1).map(Number);
const saysDate = (t: string, m: number, d: number) =>
    new RegExp(`${m}\\s*월\\s*${d}\\s*일|${m}\\s*/\\s*${d}(?!\\d)|-0?${m}-0?${d}`).test(t);

console.log(`진짜 오늘 ${realToday} · 주입한 "오늘" ${claimed} 00:20 KST\n`);
console.log('검색  n  src  주장된오늘(9/%d)  실제오늘(9/%d)  판정'.replace('%d', String(cd)).replace('%d', String(rd)));
console.log('─'.repeat(70));
for (const needsSearch of [false, true]) {
    for (let i = 1; i <= 3; i++) {
        const q = needsSearch
            // 🔴 검색을 **실제로** 붙여야 조건이 성립한다. 첫 시도는 순수 날짜 질문이라
            //    needsSearch=true 여도 src=0 이었다 — ON 팔이 사실상 OFF 였다.
            ? '오늘 나온 AI 뉴스를 검색해서 알려줘. 맨 앞에 오늘 날짜부터 적어줘.'
            : '오늘 날짜가 며칠이야? 날짜만 알려줘.';
        const { out, src } = await ask(q, needsSearch);
        const c = saysDate(out, cm, cd), r = saysDate(out, rm, rd);
        const verdict = c && !r ? '✅ 주입값 사용' : r && !c ? '🔴 실제 날짜 사용' : c && r ? '⚠️ 둘 다 언급' : '· 날짜 없음';
        console.log(`${needsSearch ? 'ON ' : 'OFF'}  ${i}  ${String(src).padStart(2)}   ${c ? '✅' : '·'}              ${r ? '🔴' : '·'}             ${verdict}   ${out.replace(/\n/g, ' ').slice(0, 60)}`);
    }
}
