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


// 약 카드 URL 이 모델 손에서 깨지는지 — 10-24 GPT 응답의 connectdi_url 에 히브리어가 끼었다(DEV_261024 §7).
//   TIER1=1 [MODEL=…] npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-drug-card-urls.mts [회수=2]
const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { HumanMessage } = await import('@langchain/core/messages');

const DRUGS = process.env.ONE ? ['게보린정 알려줘'] : ['타이레놀정500밀리그람 알려줘', '펠루비서방정 알려줘', '마그네스정 알려줘', '게보린정 알려줘', '판콜에이내복액 알려줘'];
const RUNS = Number(process.argv[2] ?? 2);
const MODEL = process.env.MODEL ?? 'gemini-3.6-flash';
const FIELDS = ['image_url', 'mfds_url', 'connectdi_url'] as const;
const urlProblem = (u: unknown): string | null => {
    if (u == null) return null;
    if (typeof u !== 'string') return '문자열 아님';
    if (/[^\x21-\x7e]/.test(u)) return `ASCII 밖 문자: ${JSON.stringify(u.match(/[^\x21-\x7e]+/g))}`;
    try { decodeURIComponent(u); } catch { return '퍼센트 인코딩 깨짐'; }
    try { new URL(u); } catch { return 'URL 아님'; }
    return null;
};
let bad = 0, total = 0;
for (const q of DRUGS) {
    for (let r = 0; r < RUNS; r++) {
        let streamed = '';
        const graph = compileAgentGraph(getSystemInstruction('Korean'), false, (d: any) => { if (process.env.DUMP) console.log('CB', Object.keys(d)); if (typeof d.text === 'string') streamed += d.text; if (typeof d.content === 'string') streamed += d.content; }, 'Korean');
        const t0 = Date.now();
        const out: any = await graph.invoke({
            messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })], webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
            model: MODEL, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [], lastTurnSearched: false,
        });
        const last = out?.messages?.at(-1)?.content;
        if (process.env.DUMP) console.log('LAST', typeof last, Array.isArray(last) ? JSON.stringify(last).slice(0, 300) : String(last).slice(0, 200), 'OUTKEYS', Object.keys(out ?? {}));
        const text = typeof last === 'string' ? last : Array.isArray(last) ? last.map((p: any) => p?.text ?? '').join('') : '';
        const all = `${streamed}\n${text}`;
        if (process.env.DUMP) console.log(JSON.stringify(all.slice(0, 300)));
        const m = all.match(/```json:drug\s*([\s\S]*?)```/);
        total++;
        if (!m) { console.log(`${q} #${r + 1} → 카드 없음 (${out?.intent}) ${Date.now() - t0}ms`); continue; }
        let card: any;
        try { card = JSON.parse(m[1]); } catch { bad++; console.log(`${q} #${r + 1} → 카드 JSON 깨짐`); continue; }
        const probs = FIELDS.map(f => [f, urlProblem(card[f])] as const).filter(([, p]) => p);
        if (probs.length) bad++;
        const kw = (() => { try { return new URL(card.connectdi_url).searchParams.get('search_keyword'); } catch { return null; } })();
        console.log(`${q} #${r + 1} → ${probs.length ? '✗ ' + probs.map(([f, p]) => `${f}: ${p}`).join(' · ') : '✓'} · connectdi 검색어 "${kw}" · ${Date.now() - t0}ms`);
    }
}
console.log(`\n${MODEL} 카드 URL 문제 ${bad}/${total}`);
