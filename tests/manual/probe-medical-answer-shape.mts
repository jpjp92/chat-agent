/**
 * medical_qa 답변 형식 — 건강 걱정이 없는 원리 설명에 증상·치료 제목이나 진료 권고가 붙는지 본다(10-23).
 * 라우터가 사람 몸 원리 질문을 medical_qa 로 보내는 성향이 강해(PLAN_DECISION_ROUTER §18), 답변 지침에서 두 유형을 나눴다.
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-medical-answer-shape.mts [회수=1]
 * 실제 그래프(라우터→검색→생성)를 돈다. 실키 수동 하니스 — npm test 제외.
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
const { HumanMessage } = await import('@langchain/core/messages');

const CASES = [
    { q: 'T세포랑 B세포 차이', kind: '원리' },
    { q: '장내 미생물은 무슨 역할 해?', kind: '원리' },
    { q: '적혈구는 몸 어디서 만들어져?', kind: '원리' },
    { q: '사람 눈은 색을 어떻게 구분해?', kind: '원리' },
    { q: '자고 일어나면 손가락이 뻣뻣함', kind: '걱정' },
    { q: '혈압이 갑자기 오르는 원인이 뭐야', kind: '걱정' },
];
const RUNS = Number(process.argv[2] ?? 1);
const MODEL = process.env.MODEL ?? 'gemini-3.6-flash';
const careHeading = (t: string) => /^#{1,4}\s*.*(증상|치료)/m.test(t);
const consult = (t: string) => /(의사|전문의|의료진|병원).{0,15}(상담|진료|방문|확인)/.test(t);
for (const c of CASES) {
    for (let r = 0; r < RUNS; r++) {
        let streamed = '';
        const graph = compileAgentGraph(getSystemInstruction('Korean'), false, (d: any) => { if (d.text) streamed += d.text; }, 'Korean');
        const t0 = Date.now();
        const out: any = await graph.invoke({
            messages: [new HumanMessage({ content: [{ type: 'text', text: c.q }] })], webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
            model: MODEL, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [], lastTurnSearched: false,
        });
        const text = (typeof out?.messages?.at(-1)?.content === 'string' ? out.messages.at(-1).content : '') || streamed;
        console.log(`[${c.kind}] ${c.q} → ${out?.intent} · 증상/치료 제목 ${careHeading(text) ? 'O' : '-'} · 진료 권고 ${consult(text) ? 'O' : '-'} · ${text.length}자 · ${Date.now() - t0}ms`);
    }
}
