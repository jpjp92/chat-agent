/**
 * 같은 질문을 모델별로 여러 번 — 실제 그래프(라우터→검색→생성)로 돌려 사실 값이 흔들리는지 본다.
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-answer-consistency.mts [회수=5]
 * 계기(10-19): "변호사 시험 언제야?" 에 GPT-5.6 이 원서접수일을 실행마다 다르게 답했다(10/5~9, 10/12~16).
 * 정답은 법무부 공고 원문 "2026. 10. 7.(수) 09:00 ∼ 10. 13.(화) 18:00". 실키 수동 하니스 — npm test 제외.
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

const Q = '변호사 시험 언제야?';
const RUNS = Number(process.argv[2] ?? 5);
const MODELS = (process.env.MODELS ?? 'gemini-3.6-flash,gemini-3.8-flash,gpt-5.6-luna,gpt-6-luna').split(',');
// 원서접수 시작·끝 날짜(10월 N일)를 뽑는다. 접수 언급이 없으면 '-'.
const applyRange = (t: string) => {
    const seg = t.match(/(원서\s*접수|접수)[^\n]{0,80}/)?.[0] ?? '';
    const days = [...seg.matchAll(/10\s*(?:월|\.)\s*(\d{1,2})\s*일?/g)].map(m => Number(m[1]));
    if (!seg) return '-';
    return days.length >= 2 ? `10/${days[0]}~10/${days[1]}` : days.length === 1 ? `10/${days[0]}~?` : '(날짜 없음)';
};
const examRange = (t: string) => { const m = t.match(/1\s*월\s*(\d{1,2})\s*일[^\n]{0,30}?(\d{1,2})\s*일/); return m ? `1/${m[1]}~1/${m[2]}` : '-'; };

const summary: Record<string, string[]> = {};
for (const model of MODELS) {
    for (let r = 0; r < RUNS; r++) {
        let streamed = '';
        const graph = compileAgentGraph(getSystemInstruction('Korean'), false, (d: any) => { if (d.text) streamed += d.text; }, 'Korean');
        const t0 = Date.now();
        try {
            const out: any = await graph.invoke({
                messages: [new HumanMessage({ content: [{ type: 'text', text: Q }] })], webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
                model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [], lastTurnSearched: false,
            });
            const text = (typeof out?.messages?.at(-1)?.content === 'string' ? out.messages.at(-1).content : '') || streamed;
            const src: any[] = out?.groundingSources ?? [];
            const apply = applyRange(text);
            (summary[model] ??= []).push(apply);
            const hosts = [...new Set(src.map(s => { try { return /vertexaisearch/.test(s.uri) ? s.title : new URL(s.uri).hostname; } catch { return '?'; } }))];
            console.log(`${model.padEnd(17)} r${r + 1} ${out?.intent ?? '?'} · 시험 ${examRange(text)} · 접수 ${apply.padEnd(12)} · 출처 ${src.length} [${hosts.join(', ')}] · ${Date.now() - t0}ms`);
        } catch (e: any) {
            (summary[model] ??= []).push('ERR');
            console.log(`${model} r${r + 1} ERR ${e?.message?.slice(0, 80)}`);
        }
    }
}
console.log('\n── 원서접수(정답 10/7~10/13) ──');
for (const [m, xs] of Object.entries(summary)) console.log(`${m.padEnd(17)} 정답 ${xs.filter(x => x === '10/7~10/13').length}/${xs.length} · ${xs.join(' | ')}`);
