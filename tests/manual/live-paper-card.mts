/**
 * 논문 카드 end-to-end 라이브 확인 — `npx tsx tests/manual/live-paper-card.mts [model] [질의]`
 *
 * 라우터와 도구는 각각 따로 확인했지만, **모델이 실제로 카드를 뱉는지**는 그래프를 돌려야 안다.
 * 여기서 지키려는 건 하나다: 모델이 도구가 준 식별자를 **고쳐 쓰지 않는가**.
 * PMID·DOI 가 한 글자만 틀려도 사용자는 엉뚱한 논문으로 간다.
 *
 * (라우트는 Supabase 인증을 요구하므로 route.ts 와 같은 initialState 로 그래프를 직접 호출한다)
 * 실키를 쓰는 수동 하니스라 `npm test` 에는 넣지 않는다.
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

/**
 * 🔴 `TIER1=1` 이면 유료 키 하나만 쓴다 — 라우팅 하니스에만 있던 장치를 여기에도 붙였다.
 *
 * 이게 없어서 오진했다. 무료 키 12개가 일일 쿼터(RPD)로 죽으면 라우터 LLM 이 429 로 폴백하고,
 * 폴백엔 `paper_source` 가 없어 비의생명 논문 질의가 `general` 로 강등된다. 코드는 멀쩡한데
 * 라우팅 회귀처럼 보인다. `API_KEY_TIER1` 은 `/^API_KEY\d*$/` 에 안 걸려 기본 풀에서
 * 빠져 있으므로 여기서 주입한다. config.ts 가 import 시점에 env 를 읽으므로 **동적 import 앞**이어야 한다.
 */
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
    console.log('[프로브] TIER1 유료 키 단독 사용 — 429 폴백으로 인한 오진을 피한다');
}

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { paperTool } = await import('../../server/agent/paper-tool.js');
const { pendingCardBlocks, dropMarkersOutsideRange, PINNED_CARD_INTENT_SET } = await import('../../server/agent/card-tool-output.js');
const { arxivTool } = await import('../../server/agent/arxiv-tool.js');
const { HumanMessage } = await import('@langchain/core/messages');

const model = process.argv[2] || 'gemini-3.7-flash';
const question = process.argv[3] || '프로바이오틱스가 감기 예방에 효과 있는지 논문 찾아줘';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

console.log(`\n모델 ${model} · 질의 "${question}"`);

/**
 * 🔴 **route.ts 가 사용자에게 실제로 보내는 것**을 재현한다. 최종 메시지를 읽으면 안 된다.
 *
 * 예전엔 `out.messages.at(-1).content || streamed` 로 판정했는데, 그건 "카드가 만들어졌는가"만
 * 보고 **"사용자에게 도달하는가"는 안 봤다.** 그래서 Gemini 경로에서 카드가 통째로 버려지는
 * 버그를 3/3 통과로 넘겼다 — route.ts 가 산문을 스트리밍으로 먼저 받으면 최종 메시지를
 * 버렸기 때문이다(DEV_260830 §6.6). 여기서는 route.ts 와 같은 이벤트 소비 순서를 그대로 쓴다.
 */
/**
 * 🔴 **라우터가 LLM 으로 판정했는지 규칙 폴백으로 떨어졌는지 기록한다.**
 *
 * 이걸 안 보다가 오진했다: `트랜스포머 어텐션 최적화 논문 찾아줘` 가 3회 연속 `general` 로
 * 가길래 라우팅 회귀로 판단했는데, 유료 키 단독(TIER1=1)으로는 12/12 정상이었다.
 * 실제 원인은 **무료 키 일일 쿼터(RPD) 소진** → 라우터 LLM 429 → 규칙 폴백 → 그 폴백엔
 * `paper_source` 가 없어 비의생명 가드가 `general` 로 강등한 것이다. 로컬 개발 환경의
 * 키 상태였지 코드 결함이 아니었다. 하니스가 말해주지 않으면 매번 같은 오진을 한다.
 */
// 🔴 log 만 감싸면 놓친다 — 폴백은 console.warn, 쿼터 소진은 console.error 로 나간다(실측).
const routerLogs: string[] = [];
const real = { log: console.log, warn: console.warn, error: console.error };
for (const k of ['log', 'warn', 'error'] as const) {
    console[k] = (...a: any[]) => { routerLogs.push(a.join(' ')); real[k](...a); };
}

let delivered = '';
/**
 * route.ts 는 논문 턴 스트림에 **카드 범위 밖 마커 제거**를 건다(지난 턴 번호가 넘어오는 걸
 * 막는다). 재현하지 않으면 하니스는 사용자가 보지 않는 글을 검사하게 된다 — route.ts 와
 * **같은 함수**를 쓴다. 복제하면 규칙이 갈라져도 하니스는 계속 초록이다.
 */
let paperCount = 0;
const graph = compileAgentGraph(getSystemInstruction('Korean'), false, () => {}, 'Korean');
let out: any = {};
let detectedIntent = '';

const events = await graph.streamEvents({
    messages: [new HumanMessage({ content: [{ type: 'text', text: question }] })],
    webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
    model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
    activeCards: [], cardContexts: [], lastTurnSearched: false,
} as any, { version: 'v2' });

for await (const ev of events as any) {
    const node = ev.metadata?.langgraph_node;
    if (ev.event === 'on_chain_end' && ev.name === 'router') {
        const ri = ev.data?.output?.intent;
        if (typeof ri === 'string') detectedIntent = ri;
    } else if (ev.event === 'on_tool_end') {
        // 본문 스트림보다 먼저 오는 이벤트다(실측 #19 vs #24) — 여기서 건수를 잡는다.
        const out = String(ev.data?.output?.content ?? ev.data?.output ?? '');
        const b = out.match(/```json:paper\s*\n([\s\S]*?)\n```/);
        if (b) { try { const ps = JSON.parse(b[1])?.papers; if (Array.isArray(ps)) paperCount = ps.length; } catch { /* 무시 */ } }
    } else if (ev.event === 'on_chat_model_stream' && node === 'generator') {
        const t = ev.data?.chunk?.content;
        if (typeof t === 'string' && t) {
            delivered += PINNED_CARD_INTENT_SET.has(detectedIntent) ? dropMarkersOutsideRange(t, paperCount) : t;
        }
    } else if (ev.event === 'on_chain_end' && ev.name === 'generator') {
        const msgText = typeof ev.data?.output?.messages?.[0]?.content === 'string'
            ? ev.data.output.messages[0].content : '';
        // route.ts:252 와 같은 두 갈래
        if (msgText && !delivered) delivered = msgText;
        else {
            // route.ts 와 **같은 함수**를 쓴다 — 복제하면 이 회귀를 다시 놓친다.
            const missing = pendingCardBlocks(msgText, delivered, detectedIntent);
            if (missing.length) delivered += '\n\n' + missing.join('\n\n') + '\n';
        }
    } else if (ev.event === 'on_chain_end' && ev.name === 'LangGraph') {
        out = ev.data?.output ?? {};
    }
}
out.intent = detectedIntent || out.intent;

const text: string = delivered;

console.log(`\n의도: ${out?.intent ?? '(없음)'}`);
// 의도는 두 갈래다 — 질의 주제에 따라 라우터가 DB 를 고른다(paper_source).
const isArxiv = out?.intent === 'arxiv_search';
for (const k of ['log', 'warn', 'error'] as const) console[k] = real[k];
const routerFellBack = routerLogs.some(l => l.includes('Semantic Router LLM failed'));
const quotaDead = routerLogs.some(l => l.includes('daily quota exhausted'));
check('논문 의도로 라우팅됐다', out?.intent === 'paper_search' || isArxiv, String(out?.intent));
const downgraded = routerLogs.find(l => l.includes('Paper intent downgrade'));
if (downgraded) console.log(`  ⚠️  ${downgraded.replace('[LangGraph] ', '')}`);
if (routerFellBack) {
    console.log(`  ⚠️  라우터 LLM 이 죽어 규칙 폴백으로 판정했다${quotaDead ? ' (무료 키 일일 쿼터 소진)' : ''}.`);
    console.log('     규칙 폴백엔 paper_source 가 없어 비의생명 주제가 general 로 강등된다 —');
    console.log('     이 상태의 라우팅 결과는 코드 판정 근거로 쓰면 안 된다. TIER1=1 로 다시 돌려라.');
}

const block = text.match(/```json\s*:\s*paper\s*\n([\s\S]*?)\n```/);
check('본문에 json:paper 블록이 있다', !!block);
if (!block) {
    const fences = (text.match(/```/g) || []).length;
    console.log(`\n[진단] 본문 ${text.length}자 · \`\`\` 개수 ${fences} · 'json:paper' 등장 ${text.includes('json:paper')}`);
    console.log('--- 본문 꼬리 400자 ---\n' + text.slice(-400));
    process.exit(1);
}

// 카드 앞에 산문이 있어야 한다 — 카드만 던지면 근거의 해석이 빠진다
const prose = text.slice(0, block.index ?? 0).trim();
check('카드 앞에 산문 답변이 있다', prose.length > 40, `${prose.length}자`);

let card: any;
try { card = JSON.parse(block[1]); } catch (e) { check('카드 JSON 파싱', false, String(e)); process.exit(1); }
check('카드 JSON 파싱', true, `논문 ${card.papers?.length ?? 0}건`);

/**
 * 🔴 0건은 **실패가 아니라 다른 계약**이다. 없는 병명(`zzzqqq 병`)을 물었을 때 모델은
 * "알려진 질병명이 아닙니다" 한 문단으로 옳게 답했는데, 하니스가 3문단·인용 번호를 요구해
 * 멀쩡한 답을 3건 실패로 잡았다. 검사가 틀린 것이지 답이 틀린 게 아니다.
 * 여기서 지킬 것은 정반대다 — **없는 근거를 지어내지 않았는가**.
 */
const empty = !Array.isArray(card.papers) || card.papers.length === 0;
if (empty) {
    console.log('\n0건 경로 — 3문단·인용 계약은 적용하지 않는다');
    console.log('--- 산문 ---\n' + prose.slice(0, 300).replace(/\n+/g, ' '));
    check('0건이면 인용 번호를 쓰지 않는다',
        (prose.match(/\[\d+\]/g) ?? []).length === 0, `${(prose.match(/\[\d+\]/g) ?? []).length}개`);
    /**
     * 🔴 조회 실패와 0건은 사용자에게 정반대 뜻이다 — 앞은 다시 시도하면 되고,
     * 뒤는 근거가 없다는 판단이다. 장애를 "논문이 없습니다" 로 답하면 거짓 결론이 된다.
     */
    if (card.error) {
        console.log(`  ·  도구가 실패를 실어 보냄: ${String(card.error).slice(0, 60)}`);
        check('장애를 조회 실패로 말한다',
            /연결할 수 없|조회(에)? 실패|응답을 받지|다시 시도|unavailable|could not (be )?reach|try again/i.test(prose));
        check('장애를 "논문이 없다" 로 바꿔 말하지 않는다',
            !/논문이 없|연구가 없|근거가 없|효과가 없|no (such )?(studies|papers|research) (exist|were found)/i.test(prose));
        check('내부 에러 원문을 산문에 노출하지 않는다',
            !prose.includes(String(card.error).slice(0, 20)), String(card.error).slice(0, 30));
    } else {
        check('논문을 찾지 못했다고 말한다',
            /못했|없습니다|없는|찾지|not found|no (matching|studies|papers)/i.test(prose));
    }
    check('분리 칸도 비어 있다',
        !(card.retracted?.length) && !(card.noAbstract?.length),
        `retracted=${card.retracted?.length ?? 0} noAbstract=${card.noAbstract?.length ?? 0}`);
    check('PMID 를 지어내지 않았다', !/\b\d{7,8}\b/.test(prose), prose.match(/\b\d{7,8}\b/)?.[0] ?? '');
    console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
    process.exit(failures === 0 ? 0 : 1);
}

// ── 여기부터는 근거가 실제로 있는 경우의 계약 ──

// 산문의 인용 번호는 카드의 논문 순번을 가리킨다. Gemini 경로가 이걸 가짜 인용으로 보고
// 통째로 지우던 회귀가 있었다(route.ts stripFabricated) — 산문과 카드를 잇는 유일한 끈이다.
const markers = (prose.match(/\[\d+\]/g) ?? []).length;
check('산문에 인용 번호가 남아 있다', markers > 0, `${markers}개`);

// 산문이 한 덩어리면 읽히지 않는다 — INTENT_FOCUS_HINTS 가 요구하는 3문단(빈 줄 2개) 검사.
// 빈 줄이 문단 구분이다: 홑개행은 ReactMarkdown 이 문단으로 끊지 않아 화면에선 여전히 한 덩어리다.
const paragraphs = prose.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
check('산문이 문단으로 끊겨 있다', paragraphs.length >= 3, `${paragraphs.length}문단`);
if (paragraphs.length < 3) console.log('--- 산문 원문 ---\n' + JSON.stringify(prose));
// 첫 문단은 결론 한 문장이어야 한다 — 여기서 멈춰도 답이 되게
check('첫 문단이 결론 한 문장이다', paragraphs.length > 0 && paragraphs[0].length <= 200,
    `${paragraphs[0]?.length ?? 0}자`);

console.log('\n--- 산문 앞부분 ---\n' + prose.slice(0, 260).replace(/\n+/g, ' '));

// ── 인용 번호가 **카드 순번**을 가리키는가 ──
//
// 🔴 실측된 결함. 어떤 모델은 마커를 **자기가 언급한 순서**로 다시 매긴다 — 4번 논문을
// 먼저 쓰면 [1], 다음 5번에 [2]. 문장 내용은 정확해서 개수만 세는 검사는 통과하지만,
// 카드에서 1번을 열어보는 사용자는 전혀 다른 연구를 만난다. 사실 오류가 아니라 **귀속 오류**다.
//
// 판정을 "n번 논문이 이 문장을 뒷받침하는가" 로 물으면 안 된다 — 한 문장이 두 논문을 묶어
// 인용하면(`[3][4]`) 절반만 맞아도 no 가 나오고(오탐), 그걸 느슨하게 풀면 비타민C 종설을
// 프로바이오틱스 메타분석 자리에 넣어도 yes 가 된다(미탐). 실측으로 둘 다 겪었다.
// 그래서 **변별 질문**으로 바꿨다: 논문 목록 전체를 주고 "이 문장은 몇 번을 말하는가" 를
// 물어, 모델이 쓴 번호가 그 답에 들어있는지 본다. 번호 다시 매기기는 이 형태에서만 드러난다.
{
    const catalog = card.papers.map((p: any, i: number) =>
        `${i + 1}. ${p.title}${p.summary ? `\n   ${p.summary.slice(0, 220)}` : ''}`).join('\n');

    // 문장 단위로 묶는다 — 한 문장이 여러 논문을 인용하는 게 정상이다.
    // 🔴 `(?<=다\.)` 로는 못 끊는다 — 마커가 마침표 **앞**에 붙는다("...내렸습니다 [4]. 어린이를...").
    //   그러면 뒷문장의 번호가 앞문장에 딸려 들어가 멀쩡한 답도 어긋남으로 잡힌다(실측).
    const sentences = prose.split(/(?<=[.!?])\s+|\n+/).map(t => t.trim()).filter(Boolean);
    const withMarkers = sentences
        .map(t => ({ t, ns: [...new Set([...t.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)]
            .flatMap(m => m[1].split(/\s*,\s*/).map(Number)))] }))
        .filter(x => x.ns.length);

    const allCited = [...new Set(withMarkers.flatMap(x => x.ns))];
    const overRange = allCited.filter(n => n < 1 || n > card.papers.length);
    check('인용 번호가 논문 개수 안에 있다', overRange.length === 0,
        overRange.length ? `범위 밖 ${overRange.join(',')} (논문 ${card.papers.length}건)`
                         : `${allCited.length}개 참조 / 논문 ${card.papers.length}건`);

    const wrong: string[] = [];
    if (!overRange.length && withMarkers.length) {
        const { GoogleGenAI } = await import('@google/genai');
        const { getNextApiKey } = await import('../../server/config.js');
        const { ROUTER_MODEL } = await import('../../server/models.js');
        for (const { t, ns } of withMarkers) {
            // 무료 키는 flash-lite 일일 20건이라 한 키로는 금방 마른다 — 429 면 다음 키로 돈다.
            let r: any = null;
            for (let attempt = 0; attempt < 12 && !r; attempt++) {
              try {
                r = await new GoogleGenAI({ apiKey: getNextApiKey() }).models.generateContent({
                model: ROUTER_MODEL,
                contents: [{ role: 'user', parts: [{ text:
`Below is a numbered list of papers, then one sentence from a Korean answer that summarises some of them.

PAPERS
${catalog}

SENTENCE
${t.replace(/\[[\d,\s]+\]/g, '')}

Which papers does this sentence describe? A sentence may describe more than one. Judge by what the sentence actually claims — a claim about a meta-analysis points to the meta-analysis, a claim about children points to the study in children. If the sentence is a generic caveat that fits no particular paper, answer with an empty list.

Output ONLY {"papers": [n, ...]}.` }] }],
                config: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
                });
              // 429(키 소진)뿐 아니라 503(모델 과부하)도 재시도한다 — 실제로 503 에 하니스가 죽었다
              } catch (e: any) { if (e?.status !== 429 && e?.status !== 503) throw e; }
            }
            if (!r) { console.log('  ?  판정기 전 키 429 — 이 문장은 건너뜀'); continue; }
            // 판정기가 `{"papers": [2, ]}` 같은 깨진 JSON 을 뱉는 일이 있다 — 하니스를 죽이지 않는다
            let judged: number[] = [];
            try { judged = JSON.parse((r.text ?? '{}').replace(/,\s*([\]}])/g, '$1'))?.papers ?? []; }
            catch { console.log(`  ?  판정기 응답이 JSON 이 아님 — 건너뜀: ${String(r.text).slice(0, 60)}`); continue; }
            if (!judged.length) continue;   // 판정 불가 — 실패로 세지 않는다
            const miss = ns.filter(n => !judged.includes(n));
            if (miss.length) wrong.push(
                `[${miss.join('][')}] 로 썼지만 이 문장은 ${judged.map(n => `${n}번`).join('·')} 논문이다 ← "${t.slice(0, 50)}"`);
        }
    }
    check('인용 번호가 카드 순번과 맞는다', wrong.length === 0,
        wrong.length ? `어긋난 귀속 ${wrong.length}건` : `${withMarkers.length}개 문장 대조`);
    for (const w of wrong) console.log(`     ⤷ ${w}`);
}

// ── 핵심: 도구 원본과 대조해 식별자가 변조되지 않았는지 본다 ──
const tool = isArxiv ? arxivTool : paperTool;
const rawTool = String(await tool.invoke({ query: card.query, limit: card.papers.length }));
const truth = JSON.parse(rawTool.match(/```json:paper\n([\s\S]*)\n```/)![1]);
/** PubMed 는 pmid, arXiv 는 arxivId 로 식별한다 — 대조 키만 다르고 계약은 같다. */
const idOf = (p: any) => p.pmid ?? p.arxivId;
const byId = new Map<string, any>(truth.papers.map((p: any) => [idOf(p), p]));

check('카드가 출처를 밝힌다', card.source === (isArxiv ? 'arxiv' : 'pubmed') || (!isArxiv && !card.source),
    String(card.source));

console.log('\n--- 논문별 대조 ---');
let idBad = 0, evBad = 0, summaryTranslated = 0, compared = 0;
for (const p of card.papers ?? []) {
    const t = byId.get(idOf(p));
    const tag = [
        isArxiv ? (p.published ? '게재됨' : '프리프린트') : (p.evidence ?? '미분류'),
        p.retracted ? '🔴철회' : '',   // 여기 뜨면 도구 분리가 샜다는 뜻이다
        isArxiv ? '' : (p.summaryKind ?? '초록없음'),
    ].filter(Boolean).join(' · ');
    if (!t) {
        // 관련도 정렬이 흔들려 목록이 다를 수 있다 — PMID 자체가 존재하는지만 표시한다
        console.log(`  ?  ${idOf(p)} [${tag}] — 이번 재조회 목록에 없음(정렬 변동)`);
        continue;
    }
    const idOk = p.doi === t.doi && p.url === t.url && p.title === t.title;
    // arXiv 는 근거 등급이 없다 — 대신 심사 여부(published)를 모델이 뒤집지 않았는지 본다.
    const evOk = isArxiv ? (p.published ?? false) === t.published : (p.evidence ?? null) === (t.evidence ?? null);
    compared++;
    if (!idOk) idBad++;
    if (!evOk) evBad++;
    // 카드는 도구 출력로 고정되므로 summary 도 도구 원문과 같아야 한다(모델이 손대면 안 된다)
    if (p.summary === t.summary) summaryTranslated++;
    console.log(`  ${idOk && evOk ? '✅' : '🔴'} ${idOf(p)} [${tag}]${idOk ? '' : ' 식별자 변조!'}${evOk ? '' : ' 등급/심사여부 변조!'}`);
}

// ── 철회 논문 ── 등급 배지가 신뢰 신호로 읽히는 자리에서 가장 나쁜 실패다.
// 🔴 프롬프트로 "인용하지 말라" 고만 했을 때 라이브 3회 중 2회가 그대로 근거로 인용했다
//   (철회된 메타분석 40323973 을 "한 메타분석에 따르면 ... [1]" 로). 그래서 도구가 배열에서
//   빼낸다 — 마커 [n] 은 papers 순번이라 빼면 **모델이 번호로 가리킬 방법이 없다**.
if (!isArxiv) {
    const excluded = card.retracted ?? [];
    check('카드에 retracted 칸이 있다 (없으면 렌더러가 제외 칸을 못 그린다)',
        Array.isArray(card.retracted), JSON.stringify(card.retracted)?.slice(0, 40));
    check('번호 매기는 목록에 철회 논문이 없다',
        (card.papers ?? []).every((p: any) => !p.retracted),
        `${(card.papers ?? []).filter((p: any) => p.retracted).length}건 섞임`);
    check('카드에 summaryKind 필드가 실려 있다',
        (card.papers ?? []).every((p: any) => 'summaryKind' in p));
    if (excluded.length) {
        console.log(`  ·  철회 제외 ${excluded.length}건: ${excluded.map((p: any) => p.pmid).join(', ')}`);
        // 번호로는 못 가리키지만 PMID 를 산문에 적어 인용하는 우회로는 남아 있다
        const leaked = excluded.filter((p: any) => prose.includes(p.pmid));
        check('산문이 제외된 논문을 PMID 로 우회 인용하지 않았다', leaked.length === 0,
            leaked.map((p: any) => p.pmid).join(','));
    } else {
        console.log('  ·  이번 결과에 철회 논문 없음');
    }
    // ── 초록이 없는 논문 ── 실측 8%. `summary: ""` 를 그대로 보냈을 때 모델이 그 공백을
    //   연구 내용으로 옮겨 적었다: "일부 검토 논문 [1, 3] 에서는 구체적인 결론을 제시하지
    //   않았습니다" — PubMed 에 초록이 없다는 뜻일 뿐인데 논문이 결론을 안 냈다는 거짓이 된다.
    //   전용 프롬프트 블록으로 3회 재측정해도 3회 모두 같아서, 철회와 같게 목록에서 빼냈다.
    const noAbs = card.noAbstract ?? [];
    check('카드에 noAbstract 칸이 있다', Array.isArray(card.noAbstract), JSON.stringify(card.noAbstract)?.slice(0, 40));
    check('번호 매기는 목록에 초록 없는 논문이 없다',
        (card.papers ?? []).every((p: any) => p.summaryKind !== 'none'),
        `${(card.papers ?? []).filter((p: any) => p.summaryKind === 'none').length}건 섞임`);
    if (noAbs.length) {
        console.log(`  ·  초록없음 제외 ${noAbs.length}건: ${noAbs.map((p: any) => p.pmid).join(', ')}`);
        const leaked = noAbs.filter((p: any) => prose.includes(p.pmid));
        check('산문이 초록 없는 논문을 PMID 로 우회 인용하지 않았다', leaked.length === 0,
            leaked.map((p: any) => p.pmid).join(','));
    }

    // 결론 라벨이 없는 초록에서 위치로 집은 발췌를 모델이 "결론을 내렸다" 로 쓰면 안 된다
    const excerptPos = (card.papers ?? [])
        .map((p: any, i: number) => (p.summaryKind === 'excerpt' ? i + 1 : 0)).filter(Boolean);
    if (excerptPos.length) {
        const claimedConclusion = excerptPos.filter(n =>
            new RegExp(`결론(을 내렸|적으로)[^.]{0,40}\\[${n}\\]|\\[${n}\\][^.]{0,40}결론(을 내렸|지었)`).test(prose));
        check('발췌를 "결론을 내렸다" 로 쓰지 않았다', claimedConclusion.length === 0,
            claimedConclusion.length ? `[${claimedConclusion.join('][')}]` : `발췌 ${excerptPos.length}건`);
    }
}

check('식별자(PMID·DOI·URL·제목)를 고치지 않았다', idBad === 0, `변조 ${idBad}건`);
check(isArxiv ? '심사 여부를 지어내지 않았다' : '근거 등급을 추정으로 채우지 않았다', evBad === 0, `변조 ${evBad}건`);
// 분모는 **대조된 건수**다. 재조회 정렬이 흔들려 빠진 논문은 판정 대상이 아닌데, 예전엔
// card.papers.length 로 나눠 정렬만 흔들려도 절대 통과할 수 없는 검사였다(거짓 실패).
check('요약도 도구 출력 그대로다 (카드 고정)', compared > 0 && summaryTranslated === compared,
    `${summaryTranslated}/${compared}건 대조${compared < card.papers.length ? ` (정렬 변동 ${card.papers.length - compared}건 제외)` : ''}`);

if (isArxiv) {
    const pre = (card.papers ?? []).filter((p: any) => !p.published).length;
    console.log(`\n프리프린트 ${pre}/${card.papers?.length ?? 0}건 (동료심사 전 — 배지가 회색으로 뜬다)`);
} else {
    const nulls = (card.papers ?? []).filter((p: any) => !p.evidence).length;
    console.log(`\n미분류 ${nulls}/${card.papers?.length ?? 0}건 (실측 평균 35% — 배지 없이 렌더된다)`);
}

console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
