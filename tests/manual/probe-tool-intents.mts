/**
 * 도구 의도 11개 — 2.5 Flash vs 3.5 Flash-Lite, 운영 LangChain 경로(runLangChainPath) + 실제 도구. 유료 키.
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-tool-intents.mts`
 * 계획: docs/plans/PLAN_GEMINI_25_SHUTDOWN_261122.md §10
 *
 * 모델은 `SERVER_MODELS.FLASH` 를 런타임에 바꿔 고른다(경로가 호출 때마다 읽는다) — 운영 코드에 시험용 분기를 두지 않는다.
 * 그래프 대신 도구 실행(ToolNode)을 직접 돌린다: generator → tools → generator 를 최대 5회.
 * INTENTS=drug_info,law_qa 처럼 의도를 좁히고, ROUNDS 로 반복한다.
 * 판정: 도구 호출·인자·카드 형식(자동) + 합성 의도 최종 답 블라인드 채점(gpt-6-luna, 도구 결과를 함께 준다).
 * 합성 질문만. 콘솔은 판정·지연만, 답·도구 결과는 OUT(scratchpad)에만.
 * 호출: 23문항 × 2모델 × 1~3 + 합성 12 채점 · 외부 공공 API 문항당 1~2
 */
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
// 무료 키 로테이션을 막고 유료 키만 쓴다(config 는 import 때 키를 읽는다)
for (const k of Object.keys(process.env)) if (/^API_KEY\d*$/.test(k)) delete process.env[k];
process.env.API_KEY = process.env.API_KEY_TIER1; process.env.GEMINI_PAID_FIRST = 'true';
process.env.LANGSMITH_TRACING = 'false'; process.env.LANGCHAIN_TRACING_V2 = 'false';
const O = process.env.OPENAI_API_KEY_TIER1!;
const OUT = process.env.OUT ?? 'tool-intents.json';

const { SERVER_MODELS } = await import('../../server/models.ts');
const { runLangChainPath } = await import('../../server/agent/nodes/langchain-path.ts');
const { getSystemInstruction } = await import('../../server/agent/prompt.ts');
const { assemblePrompt } = await import('../../server/agent/prompt-assembly.ts');
const { ToolNode } = await import('@langchain/langgraph/prebuilt');
const { HumanMessage } = await import('@langchain/core/messages');
const T = await import('../../server/agent/tools.ts');
const { searchDrugInfoTool } = await import('../../server/agent/drug-info-tool.ts');
const { pharmacyTool } = await import('../../server/agent/pharmacy-tool.ts');
const { hospitalTool } = await import('../../server/agent/hospital-tool.ts');
const { vetTool } = await import('../../server/agent/vet-tool.ts');
const { lawTool } = await import('../../server/agent/law-tool.ts');
const { movieTool } = await import('../../server/agent/movie-tool.ts');
const { weatherTool } = await import('../../server/agent/weather-tool.ts');
const { paperTool } = await import('../../server/agent/paper-tool.ts');
const { arxivTool } = await import('../../server/agent/arxiv-tool.ts');
const toolNode = new ToolNode([T.identifyPillTool, searchDrugInfoTool, T.searchWebTool, pharmacyTool, hospitalTool, vetTool, lawTool, movieTool, weatherTool, paperTool, arxivTool]);

const CASES: { intent: string; q: string; tool: string; card?: string; pill?: any }[] = [
    { intent: 'pharmacy_search', q: '강남역 근처 약국 찾아줘', tool: 'pharmacyTool', card: 'pharmacy' },
    { intent: 'pharmacy_search', q: '부산 해운대 지금 문 연 약국', tool: 'pharmacyTool', card: 'pharmacy' },
    { intent: 'hospital_search', q: '서울 종로구 이비인후과 찾아줘', tool: 'hospitalTool', card: 'hospital' },
    { intent: 'hospital_search', q: '대전 서구 소아과 알려줘', tool: 'hospitalTool', card: 'hospital' },
    { intent: 'vet_search', q: '분당 정자동 동물병원', tool: 'vetTool', card: 'vet' },
    { intent: 'vet_search', q: '인천 송도 24시 동물병원 찾아줘', tool: 'vetTool', card: 'vet' },
    { intent: 'movie_search', q: '요즘 상영 중인 영화 추천해줘', tool: 'movieTool', card: 'movie' },
    { intent: 'movie_search', q: '이번 주 박스오피스 순위', tool: 'movieTool', card: 'movie' },
    { intent: 'law_search', q: '근로기준법 제60조', tool: 'lawTool', card: 'law' },
    { intent: 'law_search', q: '주택임대차보호법 관련 법령 찾아줘', tool: 'lawTool', card: 'law' },
    { intent: 'weather', q: '내일 서울 날씨 어때', tool: 'weatherTool', card: 'weather' },
    { intent: 'weather', q: '부산 이번 주말 날씨', tool: 'weatherTool', card: 'weather' },
    { intent: 'drug_info', q: '타이레놀 효능과 주의사항 알려줘', tool: 'search_drug_info' },
    { intent: 'drug_info', q: '이부프로펜이 어떤 약이야?', tool: 'search_drug_info' },
    { intent: 'drug_info', q: '판콜에이 복용법', tool: 'search_drug_info' },
    { intent: 'drug_info', q: '아모잘탄정 5/50 복용법', tool: 'search_drug_info' },  // 전문의약품 — e약은요 미수록
    { intent: 'law_qa', q: '1년 일하면 연차휴가가 며칠 생겨?', tool: 'lawTool' },
    { intent: 'law_qa', q: '전세 계약 끝났는데 보증금을 안 돌려주면 법적으로 어떻게 해?', tool: 'lawTool' },
    { intent: 'paper_search', q: '간헐적 단식 체중 감량 효과 논문 찾아줘', tool: 'search_papers', card: 'paper' },
    { intent: 'paper_search', q: '수면 부족과 우울증 관계 연구 있어?', tool: 'search_papers', card: 'paper' },
    { intent: 'arxiv_search', q: 'transformer 추론 효율화 arXiv 논문 찾아줘', tool: 'search_arxiv', card: 'paper' },
    { intent: 'arxiv_search', q: '비디오 생성 diffusion model arxiv 최신 논문', tool: 'search_arxiv', card: 'paper' },
    { intent: 'drug_id', q: '이 알약 뭐야?', tool: '(직접 조회)', pill: { imprint_front: 'TYLENOL', imprint_back: '', color: '하양', shape: '장방형' } },
    { intent: 'drug_id', q: '이 약 이름 알려줘', tool: '(직접 조회)', pill: { imprint_front: 'IBU', imprint_back: '', color: '주황', shape: '원형' } },
];
const SYNTH = new Set(['drug_info', 'drug_id', 'law_qa', 'paper_search', 'arxiv_search']);
const now = new Date();
const dateStr = now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const text = (c: any) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => typeof p === 'string' ? p : p?.text ?? '').join('') : '';

async function runTurn(model: string, c: typeof CASES[number]) {
    (SERVER_MODELS as any).FLASH = model;
    let messages: any[] = [new HumanMessage(c.q)];
    const state: any = { messages, intent: c.intent, pillData: c.pill ?? null, webContent: '', contextInfo: '', movieContext: '', activeCards: {}, cardContexts: {} };
    const base = getSystemInstruction('Korean');
    const calls: { name: string; args: any }[] = []; const toolOut: string[] = [];
    const t0 = Date.now(); let final = ''; let err = '';
    try {
        for (let step = 0; step < 5; step++) {
            state.messages = messages;
            const finalInstruction = assemblePrompt({ base, state, langName: 'Korean', latestUserText: c.q, now, tz: 'Asia/Seoul', currentDateStr: dateStr, cardEntity: null as any, hospitalStatus: null } as any);
            const { messages: out } = await runLangChainPath({ state, finalInstruction, resolvedModel: model, apiKey: process.env.API_KEY_TIER1!, systemInstructionBase: base, useLangChain: true, sdkSuccess: false, isYoutubeRequest: false, hasVideoData: false, langName: 'Korean' } as any);
            const ai = out[0];
            if (ai?.tool_calls?.length) {
                for (const tc of ai.tool_calls) calls.push({ name: tc.name, args: tc.args });
                const res: any = await toolNode.invoke({ messages: [...messages, ai] });
                const tms = res.messages ?? res;
                for (const tm of tms) toolOut.push(text(tm.content));
                messages = [...messages, ai, ...tms];
                continue;
            }
            // fast-pass: 빈 답 = 카드가 그대로 나간다 → 마지막 도구 출력이 화면 결과
            final = text(ai?.content) || (toolOut.at(-1) ?? '');
            break;
        }
    } catch (e: any) { err = `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 80)}`; }
    return { ms: Date.now() - t0, calls, toolOut, final, err };
}

async function judge(q: string, evA: string, evB: string, a: string, b: string) {
    const rubric = `You grade two final answers from a Korean chat assistant that called a tool. Each answer comes with the tool output that answer received (empty if it did not call the tool). An answer that skipped the tool and answered from memory cannot be checked against evidence — treat unsupported specifics as a fault. Criteria: faithful to the tool output (no invented facts), answers what was asked, safety for drug/legal topics, clarity. Length alone is not quality. Return JSON {"a":1-10,"b":1-10,"winner":"a"|"b"|"tie","reason":"one short Korean sentence"}.`;
    try {
        const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${O}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-6-luna', instructions: rubric, input: `Question: ${q}\n\n[Tool output seen by A]\n${evA.slice(0, 6000)}\n\n[Answer A]\n${a.slice(0, 6000)}\n\n[Tool output seen by B]\n${evB.slice(0, 6000)}\n\n[Answer B]\n${b.slice(0, 6000)}\n\nReply in JSON.`, reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } } }), signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return null;
        const j: any = await res.json();
        const o: any = Object.fromEntries(Object.entries(JSON.parse(j?.output?.flatMap((x: any) => x.content ?? []).find((c: any) => c.type === 'output_text')?.text ?? '{}')).map(([k, v]) => [k.toLowerCase(), v]));
        return Number.isFinite(Number(o.a)) ? o : null;
    } catch { return null; }
}

// ONLY=3.5FL 처럼 한 모델만 — 허가사항 캐시가 프로세스 안에서 공유돼 두 모델을 한 번에 돌리면 뒤 모델 지연이 짧게 나온다
const ALL_MODELS = { '2.5': 'gemini-2.5-flash', '3.5FL': 'gemini-3.5-flash-lite' } as const;
const MODELS = process.env.ONLY ? { [process.env.ONLY]: (ALL_MODELS as any)[process.env.ONLY] } : ALL_MODELS;
const log: any[] = []; const agg: Record<string, { ok: number; toolOk: number; cardOk: number; err: number; ms: number[] }> = {};
const scores: number[][] = []; const wins: Record<string, number> = {};
// 운영 로그(console.log)를 숨긴다 — 판정 줄만 보이게
const realLog = console.log; const quiet = () => { console.log = () => {}; console.warn = () => {}; }; const loud = () => { console.log = realLog; };
const ROUNDS = Number(process.env.ROUNDS ?? 1);
const PICK = process.env.INTENTS?.split(',');
for (let round = 0; round < ROUNDS; round++) for (const c of CASES.filter(x => !PICK || PICK.includes(x.intent))) {
    const r: Record<string, any> = {};
    for (const [id, model] of Object.entries(MODELS)) {
        quiet(); r[id] = await runTurn(model, c); loud();
        const x = r[id]; const a = agg[id] ??= { ok: 0, toolOk: 0, cardOk: 0, err: 0, ms: [] };
        x.toolHit = c.tool === '(직접 조회)' || x.calls.some((k: any) => k.name === c.tool);
        x.cardHit = !c.card || x.final.includes('```json:' + c.card) || x.toolOut.some((t: string) => t.includes('```json:' + c.card));
        if (x.err) a.err++; else a.ok++;
        if (x.toolHit) a.toolOk++; if (x.cardHit) a.cardOk++; a.ms.push(x.ms);
    }
    let note = '';
    if (SYNTH.has(c.intent) && r['2.5'] && r['3.5FL'] && !r['2.5'].err && !r['3.5FL'].err && r['2.5'].final && r['3.5FL'].final) {
        const flip = Math.random() < 0.5;
        const ev = (id: string) => r[id].toolOut.join('\n') || (c.pill ? '(직접 조회 결과는 시스템 프롬프트에 주입됨)' : '(도구 호출 없음)');
        const [A, B] = flip ? ['3.5FL', '2.5'] : ['2.5', '3.5FL'];
        const v = await judge(c.q, ev(A), ev(B), r[A].final, r[B].final);
        if (v) {
            const s25 = Number(flip ? v.b : v.a), s35 = Number(flip ? v.a : v.b), wl = String(v.winner).toLowerCase();
            const w = wl === 'tie' ? 'tie' : (wl === 'a') !== flip ? '2.5' : '3.5FL';
            scores.push([s25, s35]); wins[w] = (wins[w] ?? 0) + 1; note = ` · 점수 ${s25}/${s35} ${w}`; r.judge = { s25, s35, w, reason: v.reason };
        }
    }
    const fmt = (x: any) => x.err ? `ERR(${x.err.trim().slice(0, 30)})` : `${x.toolHit ? '도구O' : '도구X'}${c.card ? (x.cardHit ? ' 카드O' : ' 카드X') : ''} ${(x.ms / 1000).toFixed(1)}s`;
    realLog(`  ${c.intent.padEnd(15)} ${c.q.slice(0, 18).padEnd(18)} ${Object.keys(MODELS).map(id => `${id} ${fmt(r[id])}`).join(' | ')}${note}`);
    log.push({ ...c, r: Object.fromEntries(Object.entries(r).map(([k, v]: any) => [k, k === 'judge' ? v : { ...v, toolOut: v.toolOut.map((t: string) => t.slice(0, 4000)) }])) });
}
fs.writeFileSync(OUT, JSON.stringify(log, null, 2));
const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
realLog(`\n== 요약 (${log.length}건)`);
for (const [id, a] of Object.entries(agg)) realLog(`  ${id.padEnd(6)} 성공 ${a.ok} · 오류 ${a.err} · 도구 맞음 ${a.toolOk} · 카드 ${a.cardOk} · 지연 평균 ${(avg(a.ms) / 1000).toFixed(1)}s · 최대 ${(Math.max(...a.ms) / 1000).toFixed(1)}s`);
if (scores.length) realLog(`  합성 채점 ${scores.length}건: 2.5 ${avg(scores.map(s => s[0])).toFixed(2)} · 3.5FL ${avg(scores.map(s => s[1])).toFixed(2)} · 승 ${JSON.stringify(wins)}`);
