/**
 * YouTube 경로 진단 — route.ts 와 동일한 initialState 로 그래프를 직접 호출한다.
 * `npx tsx --env-file=.env.local --tsconfig tests/tsconfig.probe.json tests/manual/probe-youtube.mts [videoUrl] [model]`
 */
import fs from 'node:fs';

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
const { HumanMessage } = await import('@langchain/core/messages');

const videoUrl = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const model = process.argv[3] || 'gemini-3.7-flash';
const prompt = `${videoUrl} 이 영상 요약해줘`;

const t0 = Date.now();
const graph = compileAgentGraph(getSystemInstruction('Korean'), true, () => {}, 'Korean');
const out: any = await graph.invoke({
    // 🔴 route.ts:106 과 동일하게 fileData 파트를 넣어야 **실제 영상 분석 경로**를 탄다.
    //    빼면 그냥 검색 grounding 으로 답해 버려서(내용은 그럴듯하다) 진단이 안 된다.
    messages: [new HumanMessage({
        content: [
            { type: 'text', text: prompt },
            { fileData: { fileUri: videoUrl, mimeType: 'video/mp4' } },
        ],
    })],
    webContent: `URL: ${videoUrl}\n`,
    attachments: [], contextInfo: '', pillData: null, sessionId: '',
    model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '', activeCards: [], cardContexts: [],
    lastTurnSearched: undefined,
});
const text = typeof out?.messages?.at(-1)?.content === 'string' ? out.messages.at(-1).content : '';
console.log(`\n=== ${model} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(text.slice(0, 500));
