/**
 * 스트림 디스패치 — 이벤트를 넣고 **나온 SSE 프레임**을 본다.
 *
 * 🔴 이 하니스가 있는 이유. 이벤트 루프가 route.ts 의 `ReadableStream` 안에 인라인이라
 * import 가 안 됐고, 하니스 3종이 각자 루프를 재구현했다. 재구현본에는 **분기 순서**가 없어서
 * 실제 결함을 재현하지 못했다 — 이름 필터 없는 `on_tool_end` 분기 하나가 else-if 체인의
 * 뒤쪽 카드 분기 6종과 검색 분기를 통째로 삼킨 채 배포됐고, 사용자 로컬에서 날씨가
 * `empty_model_response` 로 죽어서야 잡혔다 (DEV_260830 §6.14).
 *
 * 여기서는 진짜 `createStreamDispatch` 를 태운다. 모델도 네트워크도 없다.
 */
import { createStreamDispatch } from '../server/agent/stream-dispatch';

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failed++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** 디스패치 하나를 만들고 이벤트를 순서대로 먹인 뒤, 나온 프레임과 최종 상태를 돌려준다. */
const run = (events: any[]) => {
    const frames: any[] = [];
    const d = createStreamDispatch(f => frames.push(f));
    for (const e of events) d.handle(e);
    return { frames, state: d.state, text: frames.filter(f => f.text).map(f => f.text).join('') };
};

const routerEvent = (intent: string) =>
    ({ event: 'on_chain_end', name: 'router', data: { output: { intent } } });
const toolEnd = (name: string, content: string) =>
    ({ event: 'on_tool_end', name, data: { output: { content } } });
const token = (t: string) =>
    ({ event: 'on_chat_model_stream', metadata: { langgraph_node: 'generator' }, data: { chunk: { content: t } } });
const block = (type: string, body = '{"x":1}') => '```json:' + type + '\n' + body + '\n```';

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n§1 카드 8종 — 도구가 끝나면 그 카드가 화면으로 나간다');
{
    // 🔴 회귀의 심장. 분기 하나가 뒤를 삼키면 여기서 6건이 **동시에** 빨개진다.
    const CARDS: [string, string][] = [
        ['pharmacyTool', 'pharmacy'], ['hospitalTool', 'hospital'], ['vetTool', 'vet'],
        ['lawTool', 'law'], ['movieTool', 'movie'], ['weatherTool', 'weather'],
    ];
    for (const [tool, type] of CARDS) {
        const { text } = run([routerEvent(type), toolEnd(tool, block(type))]);
        check(`${tool} → json:${type} 프레임`, text.includes(block(type)), text.slice(0, 40) || '(빈 프레임)');
    }
    // 논문 카드는 도구가 아니라 generator 최종 메시지에 실려 나간다 — 여기서 새면 안 된다
    const paper = run([routerEvent('paper_search'), toolEnd('search_papers', block('paper', '{"papers":[]}'))]);
    check('논문 도구는 카드를 직접 흘리지 않는다 (pinCardToProse 담당)', paper.text === '', paper.text);
}

console.log('\n§2 🔴 else-if 체인 — 앞 분기가 뒤를 삼키지 않는가');
{
    // 실제 사고: 이름 필터 없는 on_tool_end 가 뒤 분기를 전부 죽였다. 같은 이벤트 이름으로
    // 앞뒤 분기를 함께 태워, **한 턴 안에서** 논문 처리와 날씨 카드가 공존하는지 본다.
    const { text, state } = run([
        routerEvent('weather'),
        toolEnd('search_papers', block('paper', '{"papers":[{"a":1},{"b":2}]}')),
        toolEnd('weatherTool', block('weather')),
        toolEnd('search_web', '[WEB_SOURCE_URLS]\nhttps://ex.com | 예시\n\n'),
    ]);
    check('앞 분기(논문)가 처리돼도', state.pinnedPaperCount === 2, String(state.pinnedPaperCount));
    check('뒤 분기(날씨 카드)가 살아 있다', text.includes(block('weather')), text.slice(0, 40) || '(빈 프레임)');
    check('맨 뒤 분기(웹 출처)도 살아 있다', state.allSources.some(s => s.uri === 'https://ex.com'),
        JSON.stringify(state.allSources));
}

console.log('\n§3 날씨 fast-pass — 본문이 비면 empty_model_response 다');
{
    // 사용자 로컬 재현: 카드가 안 나가면 fullAiResponse 가 비고 route.ts 가 502 를 낸다.
    const ok = run([routerEvent('weather'), toolEnd('weatherTool', block('weather'))]);
    check('카드가 나가면 본문이 채워진다', ok.state.fullAiResponse.length > 0);
    const dead = run([routerEvent('weather'), toolEnd('unknownTool', block('weather'))]);
    check('모르는 도구는 아무것도 안 내보낸다', dead.state.fullAiResponse === '');
}

console.log('\n§4 law_qa — 중간 법률 카드를 사용자 채널로 보내지 않는다');
{
    const qa = run([routerEvent('law_qa'), toolEnd('lawTool', block('law'))]);
    check('law_qa 는 카드를 흘리지 않는다 (최종 설명이 억제된다)', qa.text === '', qa.text);
    const search = run([routerEvent('law_search'), toolEnd('lawTool', block('law'))]);
    check('law_search 는 카드를 흘린다', search.text.includes(block('law')));
}

console.log('\n§5 sports — 토큰을 흘리지 않고 최종본을 한 번에 보낸다');
{
    const s = run([routerEvent('sports'), token('| 순위 |'), token(' 팀 |')]);
    check('sports 는 증분 토큰을 막는다', s.text === '', s.text);
    const g = run([routerEvent('general'), token('안녕'), token('하세요')]);
    check('일반 의도는 토큰이 흐른다', g.text === '안녕하세요', g.text);
}

console.log('\n§6 generator 노드 밖의 LLM 출력은 새지 않는다');
{
    // vision OCR·의약품 각인 판독의 중간 출력("JP","W")이 본문에 섞여 나가던 사고
    const leak = run([{ event: 'on_chat_model_stream', metadata: { langgraph_node: 'tools' },
                        data: { chunk: { content: 'JP' } } }]);
    check('generator 아닌 노드의 토큰은 버린다', leak.text === '', leak.text);
}

console.log('\n§7 인용 마커 — 청크 경계 보류와 범위 밖 제거');
{
    const link = run([routerEvent('general'), token('문장입니다.[1]'), token('(https://ex.com) 끝'),
                      { event: 'on_chain_end', name: 'LangGraph', data: {} }]);
    check('청크 경계에서 쪼개진 실제 링크가 살아남는다',
        link.text === '문장입니다.[1](https://ex.com) 끝', link.text);

    const fake = run([routerEvent('general'), token('근거가 있습니다[3].'),
                      { event: 'on_chain_end', name: 'LangGraph', data: {} }]);
    check('일반 의도에서 지어낸 번호는 지운다', !fake.text.includes('[3]'), fake.text);

    // 논문 의도에서는 카드 순번이라 지우면 안 된다 — 단 **범위 밖**은 걷어낸다
    const paper = run([routerEvent('paper_search'),
                       toolEnd('search_papers', block('paper', '{"papers":[{"a":1},{"b":2}]}')),
                       token('첫 연구[1]와 다섯째[5]를 봅니다.'),
                       { event: 'on_chain_end', name: 'LangGraph', data: {} }]);
    check('논문 의도: 범위 안 마커는 남는다', paper.text.includes('[1]'), paper.text);
    check('논문 의도: 범위 밖 마커는 사라진다', !paper.text.includes('[5]'), paper.text);
}

console.log('\n§7b 🔴 그래프 콜백으로 이미 나간 본문을 최종 메시지로 또 보내지 않는다');
{
    // 🔴 실측(2026-08-31, 사용자 로컬): "2026년 노벨 물리학상 수상자 알려줘" 답변이 **두 번**
    //   찍혔다. 원인은 리팩터링이다 — route.ts 의 `trackingEvent`(그래프 콜백 경로)가 route.ts
    //   지역 변수에 쌓는데, 디스패치는 자기 `state.fullAiResponse` 를 보고 "아직 아무것도 안
    //   나갔다" 고 판단해 최종 메시지를 다시 보냈다. 옮기기 전에는 **같은 변수**였다.
    //   → 콜백도 디스패치가 만들어 준다. 상태가 하나여야 이 판정이 성립한다.
    const frames: any[] = [];
    const d = createStreamDispatch(f => frames.push(f));
    check('디스패치가 그래프 콜백을 제공한다', typeof d.trackingEvent === 'function');
    d.trackingEvent({ text: '노벨상은 10월에 발표됩니다.' });
    d.handle({ event: 'on_chain_end', name: 'generator',
               data: { output: { messages: [{ content: '노벨상은 10월에 발표됩니다.' }] } } });
    const text = frames.filter(f => f.text).map(f => f.text).join('');
    check('본문이 한 번만 나간다', text === '노벨상은 10월에 발표됩니다.', JSON.stringify(text));
    check('상태도 한 번만 쌓인다', d.state.fullAiResponse === '노벨상은 10월에 발표됩니다.',
        JSON.stringify(d.state.fullAiResponse));
}

console.log('\n§8 출처 중복 제거');
{
    const { state } = run([
        toolEnd('search_web', '[WEB_SOURCE_URLS]\nhttps://a.com | A\nhttps://b.com | B\n\n'),
        toolEnd('search_web', '[WEB_SOURCE_URLS]\nhttps://a.com | A 중복\n\n'),
    ]);
    check('같은 URL 은 한 번만', state.allSources.length === 2, JSON.stringify(state.allSources.map(s => s.uri)));
}


// ─────────────────────────────────────────────────────────────────────────────
console.log('\n§9 빈 카드는 선전송하지 않는다 — 그러면 생성기의 산문을 삼킨다');
{
    /**
     * 🔴 실측(2026-09-02, 그래프 전체 재현). `이혼 소송비용 얼마나 들까?` 가 **카드만** 뜨고
     * 산문이 0줄이었다. 세 층을 차례로 고쳤는데(§6.29 fast-pass 2곳) 화면이 안 바뀌어
     * 세 번 헛짚었고, 그래프를 통째로 태운 로그가 범인을 짚었다:
     *
     *   [on_tool_end lawTool] → 카드 169자 전송 → fullAiResponse = 169
     *   [OpenAI] 빈 카드 복구 followup → 산문 504자
     *   [on_chain_end generator] → `msgText && !st.fullAiResponse` 가 false → **산문 폐기**
     *
     * 카드 선전송이 "이미 답을 보냈다" 는 신호가 돼 최종 메시지를 삼킨다. 바로 위 `law_qa`
     * 예외와 같은 이유인데 **빈 카드에는 예외가 없었다.**
     */
    const emptyLaw = block('law', '{"query":"이혼 소송비용","mode":"list","count":0,"laws":[],"notice":"관련 법령을 찾을 수 없습니다."}');
    const fullLaw = block('law', '{"query":"근로기준법","mode":"list","count":2,"laws":[{"name":"근로기준법"},{"name":"시행령"}]}');

    const empty = run([
        routerEvent('law_search'),
        toolEnd('lawTool', emptyLaw),
        { event: 'on_chain_end', name: 'generator',
          data: { output: { provider: 'openai', messages: [{ content: `이혼 소송비용은 사건에 따라 다릅니다.\n\n${emptyLaw}` }] } } },
    ]);
    const emptyText = empty.text;
    check('🔴 빈 카드 턴에도 산문이 사용자에게 도달한다',
        emptyText.includes('이혼 소송비용은 사건에 따라 다릅니다'), JSON.stringify(emptyText.slice(0, 80)));
    check('카드도 함께 도달한다 — 선전송을 막아도 잃지 않는다', emptyText.includes('json:law'));
    check('카드가 두 번 나가지 않는다', (emptyText.match(/json:law/g) ?? []).length === 1);

    // 결과가 있는 카드는 종전대로 즉시 나간다(지연 이득을 유지한다)
    const full = run([routerEvent('law_search'), toolEnd('lawTool', fullLaw)]);
    check('결과 있는 카드는 도구 종료 즉시 선전송된다',
        full.text.includes('json:law'));

    // 위치 카드도 같은 규칙이어야 한다 — 약국 0건도 막다른 길이었다
    const emptyPharm = block('pharmacy', '{"count":0,"pharmacies":[],"notice":"해당 지역에 약국이 없습니다."}');
    const p = run([
        routerEvent('pharmacy_search'),
        toolEnd('pharmacyTool', emptyPharm),
        { event: 'on_chain_end', name: 'generator',
          data: { output: { provider: 'openai', messages: [{ content: `울릉도에는 등록된 약국이 없습니다.\n\n${emptyPharm}` }] } } },
    ]);
    check('약국 0건도 산문이 도달한다',
        p.text.includes('울릉도에는 등록된 약국이 없습니다'));
}

console.log(`\n${failed ? `🔴 ${failed}건 실패` : '✅ 전부 통과'} (통과 ${passed})`);
if (failed) process.exit(1);

