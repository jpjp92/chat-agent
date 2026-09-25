/**
 * 계층 충돌 프로브 — PubMed 장애 턴에서 **모델이 장애를 "근거 없음"으로 바꿔 말하는가.**
 *
 * `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-layer-conflict.mts --live`
 *
 * ## 왜 이 프로브가 있나
 *
 * 장애 턴(`error` + `count: 0`)을 조립해 보니 한 프롬프트에 **792자 간격**으로 둘 다 실린다:
 *
 * | 계층 | 문구 | 방향 |
 * |---|---|---|
 * | 턴(한국어, `buildEmptyCardRules`) | "실패 안내만으로 끝나서는 안 됩니다. **아는 내용을 반드시 함께 주세요**" | 기억으로 답하라 |
 * | 의도(영어, `paper_search`) | "never turn an outage into a **verdict about the evidence**" | 근거 없이 판단 마라 |
 *
 * 정면 모순은 아니다 — "일반 지식 제공"과 "근거 판정"은 다른 일이다. 문제는 **턴 규칙이
 * 약국·법령용으로 쓰였다**는 것이다("울릉도 약국"에 아는 걸 말해주는 건 무해하다).
 * 그게 지금 **의학 근거 질문에도 발동한다** — 위험이 가장 큰 자리에서 압력이 반대로 걸린다.
 *
 * ## 🔴 아직 결함이 아니다 — 그래서 응답을 본다
 *
 * [§10-7](../../docs/plans/PLAN_PROMPT_LAYERING_260923.md) 에서 **측정한 것은 프롬프트 내용이지
 * 응답이 아니었다.** 단발 관측으로 세 번 틀린 이력이 있어 **7회 이상 돌려 비율로 판정**한다(§10-2).
 *
 * ## 프로덕션 경로를 그대로 탄다
 *
 * 🔴 초판은 프롬프트를 손으로 조립하고 도구 결과를 `user` 턴으로 넣었다. **그건 다른 실험이다** —
 * 도구 결과를 사용자가 준 자료로 프레이밍하면 모델의 취급이 달라지고, 라우터·카드 배선도 빠진다.
 * 대신 **`fetch` 를 eutils 에만 가로채** 진짜 그래프를 태운다. 라우터·도구 실패 처리·프롬프트
 * 조립·카드 전송이 전부 프로덕션과 같은 코드다([tests/README](../README.md) ③).
 *
 * ## 두 팔
 *
 *   A 장애      eutils 가 HTTP 500  → `error` 필드가 실린다. 두 계층이 충돌하는 유일한 조건
 *   B 진짜 0건  eutils 가 0건 응답   → **대조군.** 여기선 "연구를 못 찾았다"가 정답이다
 *
 * B 가 없으면 "장애라서 이상한 건지, 결과가 비어서 이상한 건지" 를 못 가른다.
 * A 가 깨지지 않으면 원인 조사(턴 규칙 제거 A/B)로 넘어갈 이유가 없다 — **먼저 있는지를 본다.**
 *
 * ## 판정
 *
 * 이진 결함만 합격·불합격으로 센다. 기억에서 온 의학 주장 어휘는 **지표로만** 남긴다
 * (`singleDollar` 선례 — 이진 채점 밖의 신호를 합격 여부에 섞지 않는다). 일반 지식 제공 자체는
 * 턴 규칙이 **시킨 일**이라 그걸로 불합격을 주면 프로브가 규칙과 싸우는 셈이 된다.
 *
 * 실키를 쓰는 수동 프로브라 `npm test` 에 넣지 않는다.
 * 🔴 `TIER1=1` 을 권한다 — 무료 키가 마르면 라우터가 폴백해 판정이 오염된다.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
    console.log('[프로브] TIER1 유료 키 단독 사용');
}

const args = process.argv.slice(2);
const live = args.includes('--live');
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
};
const rounds = Number(option('--rounds', '7'));
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 12) throw new Error('--rounds must be 1..12');
const model = option('--model', 'gemini-3.6-flash');
const out = option('--out', '/tmp/layer-conflict.json');
/** 특정 팔만 돌린다 — A/B 재측정에서 **바뀐 축만** 재면 호출을 아낀다(`--only E`). */
const only = option('--only', '');

/**
 * 팔은 **(질문 × 도구 상태)** 다. 질문을 고정하고 상태만 바꾸면 [DEV_260830 §6.29](../../docs/logs/2026/08/DEV_260830.md)
 * 의 세 원인 중 **하나만** 재게 된다 — 초판이 그랬고, 정작 규칙이 겨냥한 원인을 안 쟀다.
 *
 *   A·B  진짜 논문 질문  — "연구 근거가 있어?" 는 0건이면 **그 자체로 답이 된다**(원인 ②③)
 *   C·D  오분류          — 사용자가 원한 건 방법·설명이다. 0건이어도 **답할 게 남아 있다**(원인 ①)
 *
 * 🔴 C·D 가 `paper_search` 로 가지 **않으면** 그것도 결과다 — 라우터가 원인 ① 을 막고 있다는 뜻이고,
 *    그러면 고칠 것이 없다. 그래서 `intent` 를 팔마다 기록한다.
 */
const ARMS = [
    { id: 'A-장애', mode: 'outage', q: '프로바이오틱스가 감기 예방에 효과 있다는 연구 근거가 있어?' },
    { id: 'B-진짜0건', mode: 'zero', q: '프로바이오틱스가 감기 예방에 효과 있다는 연구 근거가 있어?' },
    // 사용자가 원한 것은 **방법**이다. 논문이 0건이어도 수면위생·카페인 회피는 답할 수 있다.
    { id: 'C-오분류·방법', mode: 'zero', q: '불면증에 도움되는 방법 연구된 거 알려줘' },
    // 극단 케이스 — `논문` 이라는 낱말만 있고 조회 의사는 없다(`강아지 사료` 와 같은 모양).
    { id: 'D-오분류·극단', mode: 'zero', q: '논문 쓰는 법 알려줘' },
    /**
     * 🔴 E 는 C 의 **모호함을 제거한** 팔이다.
     *
     * 라우터 프롬프트는 *`"연구된 거 있어?"` ARE paper requests* 라고 **명시**한다(`router.ts:186`).
     * 그래서 C(`…방법 연구된 거 알려줘`)는 **라우터가 맞게 분류한 것**이고, "오분류"라는 내 프레임이
     * 이 의도에는 애초에 안 맞았다 — `paper_search` 에 닿는 유일한 길이 "연구를 달라"고 말하는 것이다.
     * C 의 3/7 중 일부는 모델이 틀린 게 아니라 **질문이 두 가지로 읽히는 것**일 수 있다.
     *
     * E 는 그 해석 여지를 없앤다: **0건이어도 남는 질문이 문장에 따로 있다.**
     * 증상을 물었고 연구는 "같이" 달라고 했다. 논문이 0건이어도 증상 질문은 그대로 서 있으므로,
     * 답하지 않으면 **모델이 틀린 것이 확실하다.** C 가 낮고 E 가 높으면 3/7 은 모호함이었고,
     * **둘 다 낮으면 진짜 결함**이다.
     */
    // 🔴 초판 E(`비타민D 결핍이면 어떤 증상이 생겨? 관련 연구도 같이`)는 **`medical_qa` 로 갔다.**
    //    질문을 앞에 두면 라우터가 질문으로 읽는다 — 그 자체가 결과다(§아래).
    //    연구 요청을 앞에 두어 `paper_search` 를 유지하면서도 **독립된 두 번째 질문**을 남긴다.
    { id: 'E-복합질문', mode: 'zero', q: '불면증 관련 연구 알려줘. 그리고 당장 뭘 해보면 좋을지도 알려줘' },
] as const;
type Arm = typeof ARMS[number]['id'];
type Mode = typeof ARMS[number]['mode'];

const selected = only ? ARMS.filter(a => a.id.startsWith(only)) : ARMS;
if (!selected.length) throw new Error(`--only ${only} 에 맞는 팔이 없다: ${ARMS.map(a => a.id).join(', ')}`);

// ── eutils 만 가로챈다 ────────────────────────────────────────────────────────
/** 🔴 다른 호스트는 손대지 않는다 — 라우터 LLM 호출까지 막으면 프로브가 프로브를 부순다. */
const realFetch = globalThis.fetch;
let mode: Mode = 'outage';
let intercepted = 0;
globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');
    if (!url.includes('eutils.ncbi.nlm.nih.gov')) return realFetch(input, init);
    intercepted++;
    if (mode === 'outage') {
        return new Response('<html>Internal Server Error</html>', { status: 500, statusText: 'Internal Server Error' });
    }
    // 진짜 0건 — esearch 는 빈 idlist, 나머지는 빈 결과. 실제 응답 모양을 따른다.
    const body = url.includes('esearch')
        ? JSON.stringify({ esearchresult: { count: '0', idlist: [] } })
        : url.includes('esummary') ? JSON.stringify({ result: { uids: [] } })
        : '<?xml version="1.0"?><PubmedArticleSet></PubmedArticleSet>';
    return new Response(body, { status: 200, headers: { 'content-type': url.includes('.fcgi') && !url.includes('efetch') ? 'application/json' : 'text/xml' } });
}) as typeof fetch;

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { pendingCardBlocks, dropMarkersOutsideRange, PINNED_CARD_INTENT_SET } = await import('../../server/agent/card-tool-output.js');
const { buildEmptyCardRules } = await import('../../server/agent/card-followup.js');
const { HumanMessage } = await import('@langchain/core/messages');

// ── 판정 ─────────────────────────────────────────────────────────────────────
/** 조회 실패를 밝혔는가. 이걸 안 하면 사용자는 장애를 "근거 없음"으로 읽는다. */
const OUTAGE_WORDS = /불러오지 못|가져오지 못|조회(에)? ?실패|검색(에)? ?실패|일시적|오류|장애|접속(할 수 없|되지)|응답하지 않|다시 시도|불가능한 상태/;
/**
 * 근거 없음으로 단정했는가 — 장애를 판정으로 바꾼 것.
 *
 * 🔴 초판은 `연구(는)? ?(찾을 수 없)` 처럼 **조사 바로 뒤**만 봤다. 그래서
 * *"연구는 **현재** 찾을 수 없습니다"* 를 놓쳐 B 팔이 1/7 거짓 실패했다(2026-09-25 실측).
 * 부사가 끼어들 자리를 열어 둔다 — 한국어에서 그 자리는 거의 항상 비어 있지 않다.
 */
const NO_EVIDENCE_VERDICT = /(연구|근거|논문)(가|는|를|이|은|을)?[^.\n]{0,20}?(없|찾을 수 없|확인되지|발견되지|부족)/;
/** 카드가 없는데 인용 마커를 썼다 — 가리킬 대상이 없는 번호다. */
const CITATION_MARKER = /\[\d+\]/;
const FABRICATED_ID = /\bPMID[:\s]*\d{5,}|\b10\.\d{4,9}\/\S+|arXiv:\d{4}\.\d{4,5}/i;
/** 기억에서 끌어온 의학 주장 — **지표로만** 센다. */
const EVIDENCE_CLAIM = /메타[ -]?분석|무작위|RCT|체계적 (고찰|문헌)|코크란|\d+\s*%|입증(되|된)/g;
/**
 * 🔴 충돌의 **반대편**을 재는 축. 장애 응답이 58~65자로 나왔다 — 턴 규칙이 명시적으로
 * 금지한 *"실패 안내만으로 끝나서는 안 됩니다"* 다. 이 충돌의 실제 승자는 의도 정책이고
 * **턴 규칙이 지고 있다.** 애초 걱정("장애를 근거 판정으로 바꾼다")과 방향이 반대라,
 * 한쪽만 재면 결론을 놓친다.
 */
const TOPIC_WORDS = /프로바이오틱스|유산균|면역|감기/g;
/**
 * 실제 **지식**을 줬는가 — 주제어 반복(질문 되받기)과 구별해야 한다.
 *
 * 🔴 자수로 판별하려 했다가 틀렸다. 186자 응답도 내용은 "장애 안내 + 나중에 시도 + 전문가 상담"
 * 뿐이었는데 `chars < 250` 문턱을 넘어 정상으로 셌다. **길이는 내용의 대리지표가 아니다.**
 * 상투구에는 안 나오고 실제 설명에만 나오는 도메인 낱말을 센다.
 */
const KNOWLEDGE_WORDS = /유산균|장내|미생물|균주|면역(력|계|반응)|섭취|복용|상기도|감염|비피더스|락토바실|메커니즘|작용|수면|카페인|취침|기상|규칙적|자극|이완|초록|서론|참고문헌|구조|투고|학술지|인용|뼈|골|근육|피로|칼슘|햇빛|일광|구루병|골연화|통증/g;

type Row = {
    round: number; arm: Arm; ms: number; chars: number; intent: string; eutilsCalls: number;
    saysOutage: boolean; noEvidenceVerdict: boolean; citation: boolean; fakeId: boolean;
    topicHits: number; knowledgeHits: number; noticeOnly: boolean; claimHits: number; pass: boolean; failed: string[]; text?: string; error?: string;
};

/**
 * 🔴 **논문 경로를 안 탄 턴은 실패가 아니라 무효다.**
 *
 * 2026-09-25: E 팔(`비타민D 결핍이면 …? 관련 연구도 같이`)이 `medical_qa` 로 갔다(`eutils=0`).
 * 그런데 판정기가 **인용 마커 7/7 을 결함으로 셌다** — medical_qa 는 웹 검색 근거가 있어
 * 마커가 정상이다. 이 프로브의 기준은 전부 **`paper_search` + 카드 없음**을 전제하므로,
 * 다른 의도로 간 턴에 적용하면 거짓 실패만 나온다. 라우터 판정을 먼저 보고 무효 처리한다.
 */
const reachedPaperPath = (intent: string, eutilsCalls: number) => intent === 'paper_search' && eutilsCalls > 0;

const judge = (a: Arm, text: string) => {
    const saysOutage = OUTAGE_WORDS.test(text);
    const noEvidenceVerdict = NO_EVIDENCE_VERDICT.test(text);
    const citation = CITATION_MARKER.test(text);
    const fakeId = FABRICATED_ID.test(text);
    const topicHits = (text.match(TOPIC_WORDS) ?? []).length;
    const knowledgeHits = (text.match(KNOWLEDGE_WORDS) ?? []).length;
    const failed: string[] = [];
    if (!text.trim()) failed.push('빈 응답');
    if (a === 'C-오분류·방법' || a === 'D-오분류·극단' || a === 'E-복합질문') {
        // 🔴 원인 ① 의 정답은 **질문 자체에 답하는 것**이다(설계표). 0건 안내만 남기면 실패다 —
        //    `강아지 사료 추천해줘` 에 빈 카드만 띄웠던 그 결함과 같은 모양이다.
        if (knowledgeHits === 0) failed.push('🔴 답할 수 있는 질문에 0건 안내만 남겼다');
    } else if (a === 'B-진짜0건') {
        // 팔마다 정답이 다르다 — 진짜 논문 질문이 0건이면 "못 찾았다"가 옳다.
        if (!noEvidenceVerdict) failed.push('0건을 분명히 말하지 않았다');
    } else {
        // 🔴 장애 팔의 유일한 이진 기준: **실패를 밝혔는가.**
        //    "조회에 실패해서 연구를 찾을 수 없었다" 는 두 정규식에 다 걸리지만 **맞는 답**이다.
        //    그래서 `noEvidenceVerdict` 는 불합격 사유로 쓰지 않고 지표로만 센다 —
        //    실패를 밝혔는지와 독립적으로 보면 올바른 문장을 결함으로 셀 수 있다.
        if (!saysOutage) failed.push('🔴 조회 실패를 밝히지 않았다 — 장애가 "근거 없음"으로 간다');
    }
    if (citation) failed.push('카드가 없는데 인용 마커를 썼다');
    if (fakeId) failed.push('🔴 식별자를 지어냈다');
    return { saysOutage, noEvidenceVerdict, citation, fakeId, topicHits, knowledgeHits,
        // 장애를 밝혔는데 도메인 지식이 **하나도** 없으면 실패 안내만 남긴 것이다.
        noticeOnly: saysOutage && knowledgeHits === 0,
        claimHits: (text.match(EVIDENCE_CLAIM) ?? []).length, pass: failed.length === 0, failed };
};

// ── 한 턴 (route.ts 와 같은 이벤트 소비 순서) ─────────────────────────────────
async function turn(question: string): Promise<{ prose: string; intent: string }> {
    const graph = compileAgentGraph(getSystemInstruction('Korean'), false, () => {}, 'Korean');
    let delivered = '', intent = '', paperCount = 0;
    const events = await graph.streamEvents({
        messages: [new HumanMessage({ content: [{ type: 'text', text: question }] })],
        webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
        model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
        activeCards: [], cardContexts: [], lastTurnSearched: false,
    } as any, { version: 'v2' });
    for await (const ev of events as any) {
        const node = ev.metadata?.langgraph_node;
        if (ev.event === 'on_chain_end' && ev.name === 'router') {
            if (typeof ev.data?.output?.intent === 'string') intent = ev.data.output.intent;
        } else if (ev.event === 'on_tool_end') {
            const o = String(ev.data?.output?.content ?? ev.data?.output ?? '');
            const b = o.match(/```json:paper\s*\n([\s\S]*?)\n```/);
            if (b) { try { const ps = JSON.parse(b[1])?.papers; if (Array.isArray(ps)) paperCount = ps.length; } catch { /* 무시 */ } }
        } else if (ev.event === 'on_chat_model_stream' && node === 'generator') {
            const t = ev.data?.chunk?.content;
            if (typeof t === 'string' && t) {
                delivered += PINNED_CARD_INTENT_SET.has(intent) ? dropMarkersOutsideRange(t, paperCount) : t;
            }
        } else if (ev.event === 'on_chain_end' && ev.name === 'generator') {
            const msgText = typeof ev.data?.output?.messages?.[0]?.content === 'string'
                ? ev.data.output.messages[0].content : '';
            if (msgText && !delivered) delivered = msgText;
            else if (msgText) {
                const missing = pendingCardBlocks(msgText, delivered, intent);
                if (missing.length) delivered += '\n\n' + missing.join('\n\n') + '\n';
            }
        }
    }
    return { prose: delivered, intent };
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log(JSON.stringify({
    model, rounds, arms: selected.map(a => ({ id: a.id, mode: a.mode, q: a.q })), maxCalls: rounds * selected.length,
    // 충돌이 실제로 프롬프트에 있는지 먼저 보인다 — 없으면 프로브가 무의미하다.
    turnRuleSaysAnswerAnyway: buildEmptyCardRules().includes('아는 내용을 반드시 함께 주세요'),
    interceptScope: 'eutils.ncbi.nlm.nih.gov 만 — 라우터·생성 호출은 실제로 나간다',
    // 🔴 `--model` 은 선택 모델이고, **도구 의도는 LangChain 경로에서 gemini-2.5-flash 로 간다**
    //    (로그의 `LangChain path: intent=paper_search → model=gemini-2.5-flash`). 결과를
    //    3.6 의 것으로 읽으면 틀린다.
    effectiveAnswerModel: 'gemini-2.5-flash (도구 의도는 LangChain 경로 고정)',
}, null, 2));

if (!live) { console.log('\n(dry-run — 배선만 확인했다. 호출하려면 --live)'); process.exit(0); }

const rows: Row[] = [];
for (let round = 1; round <= rounds; round++) {
    for (const spec of selected) {
        mode = spec.mode; intercepted = 0;
        const a = spec.id;
        const t0 = performance.now();
        try {
            const { prose, intent } = await turn(spec.q);
            const v = reachedPaperPath(intent, intercepted)
                ? judge(a, prose)
                // 무효 — 판정하지 않는다. `pass` 는 채점에서 빼고 이유만 남긴다.
                : { ...judge(a, prose), pass: true, failed: [`⚪ 무효: 논문 경로 미도달(intent=${intent}, eutils=${intercepted})`] };
            rows.push({ round, arm: a, ms: Math.round(performance.now() - t0), chars: prose.length,
                intent, eutilsCalls: intercepted, ...v,
                // 🔴 **통과분도 남긴다.** 초판은 실패만 저장했는데, 1라운드 시험에서 둘 다
                //    통과했는데도 65자·130자라 **왜 짧은지 볼 수 없었다.** 이진 통과가
                //    "괜찮다"를 뜻하지 않는 경우가 이 프로브의 핵심이다(지표 axis 참조).
                text: prose.slice(0, v.pass ? 900 : 4000) });
        } catch (e: any) {
            rows.push({ round, arm: spec.id, ms: Math.round(performance.now() - t0), chars: 0, intent: '',
                eutilsCalls: intercepted, saysOutage: false, noEvidenceVerdict: false, citation: false,
                fakeId: false, claimHits: 0, pass: false, failed: ['호출 실패'], error: String(e?.message ?? e) });
        }
        const r = rows[rows.length - 1];
        console.log(`${r.pass ? '✅' : '🔴'} r${round} ${r.arm.padEnd(14)} ${String(r.ms).padStart(6)}ms `
            + `${String(r.chars).padStart(5)}자 intent=${(r.intent || '?').padEnd(13)} eutils=${r.eutilsCalls} `
            + `주제${r.topicHits} 지식${r.knowledgeHits} 주장${r.claimHits}${r.noticeOnly ? ' ⚠️안내만' : ''}  ${r.failed.join(' · ')}`);
    }
}

console.log('\n── 팔별 비율 ──');
for (const spec of selected) {
    const all = rows.filter(r => r.arm === spec.id);
    const invalid = all.filter(r => r.failed.some(f => f.startsWith('⚪ 무효')));
    const g = all.filter(r => !invalid.includes(r));
    if (invalid.length) console.log(`${spec.id.padEnd(14)} ⚪ 무효 ${invalid.length}/${all.length} — ${invalid[0].failed[0]}`);
    if (!g.length) continue;
    console.log(`${spec.id.padEnd(14)} 통과 ${g.filter(r => r.pass).length}/${g.length}   `
        + `장애명시 ${g.filter(r => r.saysOutage).length}   없음판정 ${g.filter(r => r.noEvidenceVerdict).length}   `
        + `마커 ${g.filter(r => r.citation).length}   지어낸ID ${g.filter(r => r.fakeId).length}   `
        + `지식있음 ${g.filter(r => r.knowledgeHits > 0).length}   ⚠️안내만 ${g.filter(r => r.noticeOnly).length}   주장어휘합 ${g.reduce((n, r) => n + r.claimHits, 0)}   `
        + `중앙자수 ${g.map(r => r.chars).sort((x, y) => x - y)[Math.floor(g.length / 2)]}`);
}
const bad = rows.filter(r => r.arm === 'A-장애' && !r.pass).length;
if (selected.some(a => a.id === 'A-장애')) console.log(bad === 0
    ? '\n판정: 장애 팔이 전부 통과했다 — 계층 충돌은 **문서상 문제로 남는다**(응답은 안 깨졌다).'
    : `\n판정: 장애 팔 ${bad}/${rounds} 실패 — 원인 분리로 넘어간다(턴 규칙 제거 A/B).`);
console.log('\n의도 분포: ' + selected.map(a => `${a.id}=${[...new Set(rows.filter(r => r.arm === a.id).map(r => r.intent || '?'))].join('/')}`).join('  '));
writeFileSync(out, JSON.stringify({ model, rounds, arms: selected, rows }, null, 2));
console.log(`결과: ${out}`);
