/**
 * 논문 카드 **멀티턴** 확인 — `npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/live-paper-multiturn.mts [모델]`
 *
 * 단발 하니스(live-paper-card.mts)가 못 보는 자리다. 카드가 뜬 다음 턴에서는
 * `stripCitations` 가 꺼져 있고 카드 고정도 살아 있어 **두 계약이 부딪힌다**(REF_Paper §I).
 *
 * 지킬 것 넷:
 *   1. 후속 설명 턴은 카드를 **다시 그리지 않는다** (같은 카드가 두 번 뜨면 화면이 어지럽다)
 *   2. "세 번째 논문" 이 카드의 3번과 **같은 논문**이다 (번호가 대화 너머로 유지되는가)
 *   3. 새 주제 턴은 **새 카드의 번호**로 다시 매긴다 (이전 카드 번호가 남으면 안 된다)
 *   4. 재구성 요청(표)은 3문단 규칙에 막히지 않는다
 *
 * 실키를 쓰는 수동 하니스라 `npm test` 에는 넣지 않는다.
 * 🔴 `TIER1=1` 을 권한다 — 무료 키가 마르면 라우터가 폴백해 판정이 오염된다.
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
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
    console.log('[프로브] TIER1 유료 키 단독 사용');
}

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { pendingCardBlocks, dropMarkersOutsideRange, PINNED_CARD_INTENT_SET } = await import('../../server/agent/card-tool-output.js');
const { HumanMessage, AIMessage } = await import('@langchain/core/messages');

const model = process.argv[2] || 'gemini-3.7-flash';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const graph = compileAgentGraph(getSystemInstruction('Korean'), false, () => {}, 'Korean');
const history: any[] = [];

/** route.ts 와 같은 이벤트 소비 순서로 한 턴을 돌린다(카드 도달까지 재현). */
async function turn(text: string): Promise<{ prose: string; card: any | null; intent: string; otherCards: string[] }> {
    history.push(new HumanMessage({ content: [{ type: 'text', text }] }));
    let delivered = '', intent = '';
    /**
     * 🔴 route.ts 는 논문 턴 스트림에 **카드 범위 밖 마커 제거**를 건다. 그걸 재현하지 않으면
     * 하니스는 사용자가 보지 않는 글을 검사하게 된다. route.ts 와 **같은 함수**를 쓴다 —
     * 복제하면 규칙이 갈라져도 하니스는 계속 초록이다(§tests/README ③).
     */
    let paperCount = 0;
    const events = await graph.streamEvents({
        messages: [...history], webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
        model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
        activeCards: [], cardContexts: [], lastTurnSearched: false,
    } as any, { version: 'v2' });

    for await (const ev of events as any) {
        const node = ev.metadata?.langgraph_node;
        if (ev.event === 'on_chain_end' && ev.name === 'router') {
            if (typeof ev.data?.output?.intent === 'string') intent = ev.data.output.intent;
        } else if (ev.event === 'on_tool_end') {
            // 본문 스트림보다 먼저 오는 이벤트에서 카드 건수를 잡는다(route.ts 와 같은 순서)
            const out = String(ev.data?.output?.content ?? ev.data?.output ?? '');
            const b = out.match(/```json:paper\s*\n([\s\S]*?)\n```/);
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
            else {
                const missing = pendingCardBlocks(msgText, delivered, intent);
                if (missing.length) delivered += '\n\n' + missing.join('\n\n') + '\n';
            }
        }
    }
    history.push(new AIMessage(delivered));
    const block = delivered.match(/```json:paper\n([\s\S]*?)\n```/);
    let card: any = null;
    if (block) { try { card = JSON.parse(block[1]); } catch { /* 깨진 카드는 null */ } }
    const prose = (block ? delivered.slice(0, block.index) : delivered).trim();
    /** 논문 외 카드도 본다 — 가드가 다른 도메인을 납치하지 않는지 보려면 필요하다. */
    const otherCards = [...delivered.matchAll(/```json:(\w+)/g)].map(m => m[1]).filter(k => k !== 'paper');
    return { prose, card, intent, otherCards };
}

console.log(`\n모델 ${model}\n`);

// ── 1턴: 카드가 뜬다 ──
console.log('1턴  "프로바이오틱스가 감기 예방에 효과 있는지 논문 찾아줘"');
const t1 = await turn('프로바이오틱스가 감기 예방에 효과 있는지 논문 찾아줘');
check('카드가 뜬다', Boolean(t1.card?.papers?.length), `${t1.card?.papers?.length ?? 0}건`);
if (!t1.card?.papers?.length) { console.log(t1.prose.slice(0, 300)); process.exit(1); }
const first = t1.card.papers;
console.log(`     3번 = ${first[2]?.pmid} "${String(first[2]?.title).slice(0, 60)}"`);

// ── 2턴: 후속 설명 — 카드를 다시 그리지 않는다 ──
console.log('\n2턴  "세 번째 논문 좀 더 설명해줘"');
const t2 = await turn('세 번째 논문 좀 더 설명해줘');
const sameList = (a: any, b: any) => JSON.stringify((a?.papers ?? []).map((p: any) => p.pmid))
    === JSON.stringify((b?.papers ?? []).map((p: any) => p.pmid));
check('카드를 다시 그리지 않는다', t2.card === null,
    t2.card ? `카드가 또 나왔다 (의도=${t2.intent}, 목록 ${sameList(t1.card, t2.card) ? '동일' : '다름'}: ${(t2.card.papers ?? []).map((p: any) => p.pmid).join(',')})` : '산문만');
console.log('     ' + t2.prose.slice(0, 200).replace(/\n+/g, ' '));
/**
 * 🔴 번호가 대화 너머로 유지되는가 — **제목 어휘로 보면 안 된다.**
 *
 * 두 번 놓쳤다. ⓐ `children` 이 `schoolchildren` 안에 들어 있어 멀쩡한 답을 오탐했고
 * ⓑ 한국어로 풀어 쓰는 모델(luna·gpt-5.4-mini)은 영어 제목을 아예 인용하지 않아 미탐했다.
 * gpt-5.4-mini 는 "학령기 아동, 두 균주, 하루 2회 3개월, 결석 감소" 로 3번을 정확히
 * 설명했는데 제목 한 단어도 안 겹쳤다.
 *
 * live-paper-card.mts 에서 검증된 **변별 질문**을 그대로 쓴다 — 논문 목록 전체를 주고
 * "이 설명은 몇 번을 말하는가" 를 묻는다. "n번이 맞는가" 로 물으면 안 되는 이유도 거기 있다.
 */
const t3title = String(first[2]?.title ?? '');
const catalog = first.map((p: any, i: number) =>
    `${i + 1}. ${p.title}${p.summary ? `\n   ${String(p.summary).slice(0, 220)}` : ''}`).join('\n');
const { GoogleGenAI } = await import('@google/genai');
const { getNextApiKey } = await import('../../server/config.js');
const { ROUTER_MODEL } = await import('../../server/models.js');
let judged: number[] | null = null;
for (let attempt = 0; attempt < 12 && judged === null; attempt++) {
    try {
        const r = await new GoogleGenAI({ apiKey: getNextApiKey() }).models.generateContent({
            model: ROUTER_MODEL,
            contents: [{ role: 'user', parts: [{ text:
`Below is a numbered list of papers, then a Korean answer that explains ONE of them.

PAPERS
${catalog}

ANSWER
${t2.prose.slice(0, 1500)}

Which paper does this answer explain? Judge by the study design, population, intervention and result it describes — the answer may be a translation that never quotes the English title. Output ONLY {"papers": [n]}.` }] }],
            config: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        });
        judged = JSON.parse((r.text ?? '{}').replace(/,\s*([\]}])/g, '$1'))?.papers ?? [];
    } catch (e: any) {
        if (e?.status !== 429 && e?.status !== 503) throw e;
    }
}
if (judged === null || !judged.length) {
    console.log('  ?  판정 불가(키 소진·응답 이상) — 이 검사는 건너뜀');
} else {
    check('3번 논문을 설명한다 (번호가 대화 너머로 유지된다)', judged.includes(3),
        `판정기: ${judged.join('·')}번`);
    if (!judged.includes(3)) console.log('--- 2턴 산문 ---\n' + t2.prose.slice(0, 600) + '\n---');
}
// 다른 논문 얘기로 새면 그것도 결함이다
/**
 * 🔴 "다른 논문 제목 어휘가 나오면 샌 것" 은 무른 판정이다 — 같은 주제의 논문들은
 * `probiotics`·`common cold` 를 공유해서 정답도 걸린다(실측 오탐). **3번 제목에 없는**
 * 어휘만 남겨서 본다. 그래도 애매하면 저자·연도 같은 고유값이 더 정확하다.
 */
const tokens = (t: string) => t.toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
const targetWords = new Set(tokens(t3title));
// 🔴 `includes` 로 보면 안 된다 — `children` 이 `schoolchildren` 안에 들어 있어서
//   3번 논문만 설명한 멀쩡한 답이 "5번으로 샜다" 로 잡혔다(실측 오탐). 토큰 단위로 본다.
const proseWords = new Set(tokens(t2.prose));
const others = first
    .map((p: any, i: number) => ({ p, i }))
    .filter(({ i }: any) => i !== 2)
    .filter(({ p }: any) => tokens(String(p.title))
        .filter((w: string) => w.length > 7 && !targetWords.has(w))
        .some((w: string) => proseWords.has(w)));
check('다른 논문으로 새지 않는다', others.length === 0,
    others.map(({ p, i }: any) => `${i + 1}번 ${p.pmid} "${String(p.title).slice(0, 50)}"`).join(' / '));
if (others.length) console.log('--- 2턴 산문 전문 ---\n' + t2.prose + '\n---');

// ── 3턴: 새 주제 — 새 카드, 번호는 새 카드 기준 ──
console.log('\n3턴  "그럼 비타민D 는?"');
const t3 = await turn('그럼 비타민D 논문은?');
check('새 카드가 뜬다', Boolean(t3.card?.papers?.length), `${t3.card?.papers?.length ?? 0}건`);
if (t3.card?.papers?.length) {
    /**
     * ⚖️ 겹침은 결함이 아니다. 비타민D 검색이 프로바이오틱스 카드에도 있던 보충제
     * 네트워크 메타분석(40969681)을 정당하게 돌려준다 — 실측으로 확인하고 검사에서 뺐다.
     * 여기서 지킬 것은 겹침 여부가 아니라 **번호가 새 카드 기준인가**다(아래).
     */
    const overlap = t3.card.papers.filter((p: any) => first.some((q: any) => q.pmid === p.pmid));
    console.log(`     이전 카드와 겹치는 논문 ${overlap.length}건${overlap.length ? ` (${overlap.map((p: any) => p.pmid).join(',')}) — 주제가 겹치면 정상` : ''}`);
    const cited = [...new Set([...t3.prose.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])))];
    const over = cited.filter(n => n < 1 || n > t3.card.papers.length);
    check('인용 번호가 새 카드 범위 안이다', over.length === 0,
        over.length ? `범위 밖 ${over.join(',')} — 새 카드는 ${t3.card.papers.length}건뿐 (이전 카드 번호가 남았다)`
                    : `${JSON.stringify(cited)} / 논문 ${t3.card.papers.length}건`);
    /**
     * 🔴 실측: 새 카드가 1건뿐이던 턴에 모델이 "이전 검색 결과에서 … [5] 입니다" 로 답했다.
     * [5] 는 지난 턴 카드의 번호다 — 화면 카드에는 그 번호가 없어 사용자는 빈 곳을 가리킨
     * 마커를 본다. 카드가 5건이면 범위 검사만으로는 안 잡힌다(우연히 범위 안이라서).
     */
    check('지난 턴 결과를 번호로 부르지 않는다',
        !/(이전|지난|앞선|앞의|먼저)\s*(검색|턴|결과|카드|답변)[^\n]{0,250}?\[\d+\]/.test(t3.prose),
        t3.prose.match(/(이전|지난|앞선|앞의|먼저)\s*(검색|턴|결과|카드|답변)[^\n]{0,250}?\[\d+\]/)?.[0]?.slice(0, 90) ?? '');
    console.log('     ' + t3.prose.slice(0, 260).replace(/\n+/g, ' '));
    check('새 카드에도 분리 칸이 실린다',
        Array.isArray(t3.card.retracted) && Array.isArray(t3.card.noAbstract));
}

// ── 4턴: 재구성 — 3문단 규칙이 표를 막지 않는가 ──
console.log('\n4턴  "지금까지 나온 논문들 표로 정리해줘"');
const t4 = await turn('지금까지 나온 논문들 표로 정리해줘');
check('표를 만든다 (3문단 규칙이 재구성을 막지 않는다)', /\|.*\|/.test(t4.prose), t4.prose.slice(0, 80));
check('재구성 턴은 카드를 다시 그리지 않는다', t4.card === null,
    t4.card ? `의도=${t4.intent}, ${(t4.card.papers ?? []).map((p: any) => p.pmid).join(',')}` : '');
// 표에 적힌 PMID 는 실제로 나온 것이어야 한다 — 재구성 턴이 논문을 지어내면 안 된다
const known = new Set([...first, ...(t3.card?.papers ?? [])].map((p: any) => p.pmid));
const invented = [...new Set([...t4.prose.matchAll(/\b(\d{7,8})\b/g)].map(m => m[1]))].filter(id => !known.has(id));
check('재구성 턴이 PMID 를 지어내지 않는다', invented.length === 0, invented.join(','));

// ── 5턴: 가드의 폭발 반경 — 논문 카드가 떠 있어도 다른 도메인은 그대로 가야 한다 ──
console.log('\n5턴  "오늘 서울 날씨 어때?"  (논문 카드가 떠 있는 상태)');
const t5 = await turn('오늘 서울 날씨 어때?');
check('논문 후속 가드가 날씨 질문을 납치하지 않는다', t5.intent === 'weather', `의도=${t5.intent}`);
/**
 * ⚖️ 카드 유무는 **외부 API 상태**에 달렸다 — 실측에서 KMA 실패 → OpenWeather 폴백도
 * 타임아웃 나서 카드가 안 떴다. 이 하니스가 지키려는 건 "논문 가드가 날씨 턴을 납치했는가"
 * 하나뿐이고 그건 위 의도 검사가 본다. 카드는 참고로만 찍고 실패로 세지 않는다.
 */
console.log(`     날씨 카드: ${t5.otherCards.includes('weather') ? '뜸' : '안 뜸 (외부 API 상태 — 판정 대상 아님)'}`);
check('논문 카드를 다시 그리지 않는다', t5.card === null);

// ── 6턴: 새 논문 주제 — 가드가 재조회를 막으면 안 된다 ──
console.log('\n6턴  "아스피린 심혈관 예방 연구 있어?"');
const t6 = await turn('아스피린 심혈관 예방 연구 있어?');
check('새 논문 주제는 재조회한다 (가드가 가두지 않는다)', Boolean(t6.card?.papers?.length),
    `의도=${t6.intent}, ${t6.card?.papers?.length ?? 0}건`);
if (t6.card?.papers?.length) {
    const stale = t6.card.papers.filter((p: any) => first.some((q: any) => q.pmid === p.pmid));
    check('이전 프로바이오틱스 카드를 재활용하지 않는다', stale.length < t6.card.papers.length,
        `겹침 ${stale.length}/${t6.card.papers.length}`);
}

// ── 7턴: 결과가 적은 새 주제 — 이전 카드 번호가 흘러들어오는지 ──
//   🔴 카드가 5건이면 지난 턴 번호를 써도 우연히 범위 안이라 안 잡힌다. 일부러 좁은 주제로 묻는다.
console.log('\n7턴  "칼프로텍틴 대변검사 크론병 감별 논문은?"  (결과가 적은 주제)');
const t7 = await turn('칼프로텍틴 대변검사로 크론병 감별하는 논문은?');
if (t7.card?.papers?.length) {
    console.log(`     새 카드 ${t7.card.papers.length}건`);
    const cited7 = [...new Set([...t7.prose.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1])))];
    const over7 = cited7.filter(n => n < 1 || n > t7.card.papers.length);
    check('적은 결과에서도 인용 번호가 카드 범위 안이다', over7.length === 0,
        over7.length ? `범위 밖 ${over7.join(',')} — 카드는 ${t7.card.papers.length}건뿐`
                     : `${JSON.stringify(cited7)} / ${t7.card.papers.length}건`);
    const known7 = new Set([...first, ...(t3.card?.papers ?? []), ...(t6.card?.papers ?? [])].map((p: any) => p.pmid));
    const reused = t7.card.papers.filter((p: any) => known7.has(p.pmid));
    console.log(`     이전 카드와 겹침 ${reused.length}건`);
} else {
    console.log(`     카드 없음(0건 경로) — 의도=${t7.intent}`);
    check('0건이어도 인용 번호를 지어내지 않는다', (t7.prose.match(/\[\d+\]/g) ?? []).length === 0);
}

console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);
