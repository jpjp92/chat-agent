import { cardHasResults, pendingCardBlocks, dropMarkersOutsideRange, PINNED_CARD_INTENT_SET } from './card-tool-output';

/**
 * `graph.streamEvents` 이벤트 → SSE 프레임.
 *
 * 🔴 **이 파일이 따로 있는 이유.** 원래 이 else-if 체인은 route.ts 의 `ReadableStream` 안에
 * 인라인이라 import 가 불가능했다. 그래서 하니스 3종이 각자 루프를 재구현했고, 재구현본에는
 * **분기 순서가 없어서** 실제 결함을 재현하지 못했다:
 *   이름 필터 없는 `on_tool_end` 분기 하나가 뒤의 카드 분기(pharmacy·hospital·vet·law·movie·
 *   weather)와 검색 분기를 **통째로 삼켰다**. 하니스 전부 초록인 채로 배포됐고 사용자 로컬에서
 *   날씨가 `empty_model_response` 로 죽어서야 잡혔다 (DEV_260830 §6.14).
 * 순수 함수로 빼 두면 가짜 이벤트를 넣고 나온 프레임을 검사할 수 있다 — 모델도 네트워크도 없이.
 *
 * ⚖️ 상태는 route.ts 가 아니라 여기가 갖는다. `fullAiResponse` 는 저장·빈응답 판정에,
 *   `allSources` 는 grounding_sources 저장에 쓰이므로 `state` 로 그대로 노출한다.
 */
export interface DispatchState {
    /** 사용자에게 나간 본문 전체 — 비어 있으면 `empty_model_response` 다. */
    fullAiResponse: string;
    allSources: any[];
    /** router 가 정한 intent. 카드 전송 판정과 sports 게이트가 함께 본다. */
    detectedIntent: string;
    /** 청크 경계에 걸린 미완성 인용 마커 보류분. */
    lcCitationBuffer: string;
    /**
     * 이번 턴 논문 카드의 건수 — 인용 마커 `[n]` 이 가리킬 수 있는 최대값이다.
     *
     * 🔴 멀티턴에서 모델이 **지난 턴 카드의 번호**를 가져다 쓴다(실측 2026-08-31):
     *   "이전 검색 결과에서 … 논문 [5] 입니다" — 이번 카드가 1건이면 [5] 는 아무 데도
     *   가리키지 않는다. 프롬프트로 두 번 막아봤지만 2회 중 2회 그대로였다.
     *   `pinCardToProse` 의 같은 방어는 **최종 메시지**에만 걸려서, 산문을 토큰으로 흘리는
     *   Gemini 경로에서는 이미 사용자에게 나간 뒤였다.
     * 도구 종료 이벤트가 본문 첫 토큰보다 **먼저** 온다(실측: #19 vs #24). 그래서 여기서
     * 건수를 잡아 두면 스트림에도 같은 계약을 적용할 수 있다.
     * ⚖️ 0 은 "모른다" 와 "0건" 을 함께 뜻하고, 둘 다 **아무것도 하지 않는다** — 오늘 동작
     *   그대로다. 0건 턴에서 모델이 마커를 지어내는지는 라이브 하니스가 따로 본다
     *   (`live-paper-card.mts` 0건 경로: 인용 0개·PMID 0개).
     */
    pinnedPaperCount: number;
}

export interface StreamDispatch {
    handle: (event: any) => void;
    /**
     * 그래프가 노드 안에서 직접 부르는 전송 콜백(`compileAgentGraph` 의 sendEvent).
     *
     * 🔴 **디스패치가 만들어야 한다.** 처음엔 route.ts 가 자기 지역 변수에 쌓는 콜백을 따로
     * 만들었는데, 그러면 `fullAiResponse` 가 둘로 갈린다 — 디스패치는 "아직 아무것도 안 나갔다"
     * 고 보고 `on_chain_end generator` 에서 최종 메시지를 **다시** 보낸다. 실측(2026-08-31):
     * 노벨상 답변이 화면에 두 번 찍혔다. 인라인이던 시절엔 같은 변수라 생기지 않던 결함이다.
     */
    trackingEvent: (data: any) => void;
    state: DispatchState;
}

export function createStreamDispatch(sendEvent: (data: any) => void): StreamDispatch {
    const st: DispatchState = {
        fullAiResponse: '',
        allSources: [],
        detectedIntent: '',
        lcCitationBuffer: '',
        pinnedPaperCount: 0,
    };

    // 🔴 닫힌 `[1]` 도 보류 대상이다 — 다음 청크가 `(` 로 시작하면 그건 실제 링크
    //    `[1](url)` 이라 지우면 안 되는데, 청크 경계에서는 아직 알 수 없다.
    //    (`]?` 로 열린 `[1` 과 닫힌 `[1]` 을 함께 잡는다)
    const incompletecitation = /\s?\[\d*(?:,\s*\d*)*\]?$/;
    // 가짜 번호 제거 — `(?!\()` 로 실제 링크 `[1](url)` 는 보존한다(gemini-citations.ts 와 동일 규칙).
    //
    // 🔴 논문 의도에서는 **끄다**. 이 턴의 `[1]`·`[2]` 는 모델이 지어낸 게 아니라
    //   **도구가 돌려준 논문 목록의 순번**이고, 프롬프트가 그걸 붙이라고 명시적으로 지시한다.
    //   지우면 산문과 카드를 잇는 유일한 끈이 사라진다(실측: 3.7 답변에서 마커 2개가 통째로
    //   증발했다). 이 턴은 Google grounding 이 아예 안 붙고(allTools=[paperTool] 뿐이라
    //   searchWebTool 이 없다) 도구 결과만 근거라, 원래 이 방어가 막으려던 "grounding URL 을
    //   가리키는 가짜 번호" 가 생길 경로 자체가 없다.
    const stripFabricated = (t: string) => t.replace(/\s?\[\d+(?:,\s*\d+)*\](?!\()/g, '');
    // 실제 스트리밍이 쓰는 건 이쪽이다 — 논문 턴에서만 위 규칙을 건너뛴다.
    // 논문 턴에서는 마커를 지우는 대신 **카드 범위 밖만** 걷어낸다(건수를 모르면 그대로 통과).
    const stripCitations = (t: string) => PINNED_CARD_INTENT_SET.has(st.detectedIntent)
        ? dropMarkersOutsideRange(t, st.pinnedPaperCount) : stripFabricated(t);
    // sports(월드컵 순위/일정 표)는 토큰 증분 스트리밍 시 마크다운 표가 셀 단위로 실시간
    // 조립되며 어색함 → 스트리밍을 건너뛰고 generator on_chain_end에서 완성본을 한 번에 전송.

    const handle = (event: any) => {
      const data = event.data;
      const langGraphNode = (event as any).metadata?.langgraph_node;

      if (event.event === 'on_chat_model_stream') {
        // Only stream prose tokens from the final generation node. Nested LLM calls in
        // other nodes (vision OCR, and Gemini Vision imprint reads inside the `tools` node
        // via searchDrugInfoTool) otherwise leak their output (e.g. "JP","W") into the
        // user-facing answer ahead of the real json:drug block.
        if (langGraphNode !== 'generator') return;
        // sports: 증분 토큰을 흘리지 않고 generator on_chain_end에서 표 전체를 한 번에 전송.
        if (st.detectedIntent === 'sports') return;
        const chunk = data?.chunk;
        const chunkText = chunk?.content;
        if (chunkText && typeof chunkText === 'string') {
          const combined = st.lcCitationBuffer + chunkText;
          st.lcCitationBuffer = '';
          let sanitizedText = combined.replace(/(.)\1{49,}/g, '$1$1$1');
          sanitizedText = sanitizedText.replace(/(?:```json\s*)?\{\s*"tool_code":\s*".*?"\s*\}(?:\s*```)?/gs, '');
          // 🔴 보류가 **먼저**다. 끝에 걸린 `[1]` 을 먼저 지워 버리면 다음 청크의 `(url)` 만
          //    남아 화면에 생 URL 이 뜬다(실제 링크가 청크 경계에서 쪼개지는 경우).
          const incomplete = sanitizedText.match(incompletecitation);
          if (incomplete) { st.lcCitationBuffer = incomplete[0]; sanitizedText = sanitizedText.slice(0, -st.lcCitationBuffer.length); }
          sanitizedText = stripCitations(sanitizedText);
          sanitizedText = sanitizedText.replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '');
          sanitizedText = sanitizedText.replace(/\[MFDS_NOT_FOUND\][^\n]*/g, '');
          sanitizedText = sanitizedText.replace(/⚠️\s*CRITICAL INSTRUCTION:[^\n]*/g, '');
          if (sanitizedText.trim()) { st.fullAiResponse += sanitizedText; sendEvent({ text: sanitizedText }); }
        }
        const gm = chunk?.response_metadata?.groundingMetadata || chunk?.additional_kwargs?.groundingMetadata;
        if (gm?.groundingChunks) {
          const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
          if (sources.length > 0) { sources.forEach((s: any) => { if (!st.allSources.some((e: any) => e.uri === s.uri)) st.allSources.push(s); }); sendEvent({ sources: st.allSources }); }
        }
      } else if (event.event === 'on_tool_end' && ['search_papers', 'search_arxiv'].includes(event.name)) {
        /**
         * 논문 도구가 돌려준 카드의 건수를 잡는다 — 본문 스트림보다 먼저 오는 이벤트다.
         *
         * 🔴 **이름으로 좁혀야 한다.** 처음엔 `on_tool_end` 전체를 잡았는데, 이건 else-if
         * 체인이라 아래의 카드 분기(pharmacy·hospital·vet·law·movie·weather)와 검색 분기가
         * **통째로 죽었다** — 사용자 로컬에서 날씨가 `empty_model_response` 로 실패해서 잡혔다.
         * 하니스는 전부 이 이벤트 루프를 자체 구현해 재현하지 않으므로 못 잡는다.
         */
        const out = String(data?.output?.content ?? data?.output ?? '');
        const block = out.match(/```json:paper\s*\n([\s\S]*?)\n```/);
        if (block) {
          try {
            const papers = JSON.parse(block[1])?.papers;
            if (Array.isArray(papers)) st.pinnedPaperCount = papers.length;
          } catch { /* 부분 출력·에러 카드 — 0 으로 두면 아무것도 하지 않는다 */ }
        }
      } else if (event.event === 'on_chain_end' && event.name === 'router') {
        // router가 정한 intent를 캡처 — generator 스트리밍보다 먼저 끝나므로 sports 게이트에 사용.
        const ri = data?.output?.intent;
        if (typeof ri === 'string') st.detectedIntent = ri;
      } else if (event.event === 'on_chain_end' && event.name === 'LangGraph' && st.lcCitationBuffer) {
        // 스트림 끝이라 뒤에 `(` 가 올 일이 없다 → 보류분에도 가짜 번호 제거를 적용해 flush.
        const flushed = stripCitations(st.lcCitationBuffer); st.lcCitationBuffer = '';
        if (flushed) { st.fullAiResponse += flushed; sendEvent({ text: flushed }); }
      } else if (event.event === 'on_chain_end' && event.name === 'generator') {
        const output = data?.output;
        const modelMsg = output?.messages?.[0];
        const rawMsgText = typeof modelMsg?.content === 'string' ? modelMsg.content : '';
        // 가짜 숫자 인용 제거는 **맨 대괄호에만** 적용한다. Gemini도 groundingSupports 기반
        // 실제 링크 [1](url)을 심게 됐으므로(gemini-citations.ts), 뒤에 '('가 오면 남긴다.
        // 예전 규칙은 대괄호를 통째로 지워 OpenAI 링크를 훼손했고, 그래서 공급자로 갈라 두었다.
        const msgText = output?.provider === 'openai'
          ? rawMsgText.replace(/(.)\1{49,}/g, '$1$1$1')
          : stripCitations(rawMsgText.replace(/(.)\1{49,}/g, '$1$1$1').replace(/`?json:drug`?\s*블록은\s*생성(?:하지\s*마세요|할\s*수\s*없습니다)[.]?\s*/g, '').replace(/\[MFDS_NOT_FOUND\][^\n]*/g, ''));
        if (msgText && !st.fullAiResponse) { st.fullAiResponse = msgText; sendEvent({ text: msgText }); }
        // 🔴 **고정된 카드는 스트리밍과 별개로 보내야 한다.**
        //   Gemini 는 산문을 토큰 단위로 흘려 st.fullAiResponse 를 먼저 채운다. 카드는 그 뒤
        //   langchain-path 의 pinCardToProse 가 **최종 메시지**에 붙이므로, 위 `!st.fullAiResponse`
        //   조건에 걸려 최종 메시지가 통째로 버려졌다 — 도구는 호출됐고 모델은 결과를 읽어
        //   산문까지 썼는데 **카드만 화면에 도달하지 않는다**(실측: gemini-3.7 재현, gpt-5.6 은
        //   이 경로로 스트리밍하지 않아 st.fullAiResponse 가 비어 있어 우연히 멀쩡했다).
        //   카드는 도구 출력로 고정된 값이라 산문과 중복되지 않는다 — 블록만 이어 붙인다.
        else {
            const missing = pendingCardBlocks(msgText, st.fullAiResponse, st.detectedIntent);
            if (missing.length) {
                const block = '\n\n' + missing.join('\n\n') + '\n';
                st.fullAiResponse += block; sendEvent({ text: block });
            }
        }
        const gm = modelMsg?.response_metadata?.groundingMetadata || modelMsg?.additional_kwargs?.groundingMetadata;
        if (gm?.groundingChunks) {
          const sources = gm.groundingChunks.map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null).filter(Boolean);
          if (sources.length > 0) { let added = false; sources.forEach((s: any) => { if (!st.allSources.some((e: any) => e.uri === s.uri)) { st.allSources.push(s); added = true; } }); if (added) sendEvent({ sources: st.allSources }); }
        }
        const stateSources: any[] = output?.groundingSources || [];
        if (stateSources.length > 0) { let added = false; stateSources.forEach((s: any) => { if (s?.uri && !st.allSources.some((e: any) => e.uri === s.uri)) { st.allSources.push(s); added = true; } }); if (added) sendEvent({ sources: st.allSources }); }
      } else if (event.event === 'on_tool_end' && ['pharmacyTool', 'hospitalTool', 'vetTool', 'lawTool', 'movieTool', 'weatherTool'].includes(event.name)) {
        // law_search는 카드 fast-pass지만 law_qa는 같은 도구 결과를 선택 모델이 설명문으로
        // 합성해야 한다. 중간 json:law를 먼저 스트리밍하면 fullAiResponse가 채워져 generator의
        // 최종 설명이 억제되므로, 합성 intent에서는 도구 블록을 사용자 채널로 보내지 않는다.
        if (event.name === 'lawTool' && st.detectedIntent === 'law_qa') return;
        const rawOutput = data?.output;
        const toolOutput: string = typeof rawOutput === 'string' ? rawOutput : typeof rawOutput?.content === 'string' ? rawOutput.content : Array.isArray(rawOutput?.content) ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
        const blockType = event.name === 'hospitalTool' ? 'hospital' : event.name === 'vetTool' ? 'vet' : event.name === 'lawTool' ? 'law' : event.name === 'movieTool' ? 'movie' : event.name === 'weatherTool' ? 'weather' : 'pharmacy';
        // weatherTool은 멀티 도시 시 json:weather 블록을 여러 개 반환 → 전역 매칭으로 모두 스트리밍.
        const blockMatches = toolOutput.match(new RegExp(`\`\`\`json:${blockType}\\n[\\s\\S]*?\\n\`\`\``, 'g'));
        /**
         * 🔴 **빈 카드는 여기서 먼저 보내지 않는다.** 실측(2026-09-02, 그래프 전체 재현):
         *   [on_tool_end lawTool] → 카드 169자 전송 → st.fullAiResponse = 169
         *   [OpenAI] 빈 카드 복구 followup → 산문 504자
         *   [on_chain_end generator] → `msgText && !st.fullAiResponse` 가 false → **산문 통째 폐기**
         * 카드를 선전송하면 그 값이 "이미 답을 보냈다" 는 신호가 돼 generator 의 최종 메시지를
         * 삼킨다. 위 `law_qa` 예외와 **같은 이유**인데 빈 카드에는 예외가 없었다.
         *
         * 결과가 없으면 카드에는 보여줄 게 없고 생성기가 질문에 답해야 한다(§6.29). 그 최종
         * 메시지에 `pinCardToProse` 가 카드를 붙여 오므로 카드도 잃지 않는다 — 산문 토큰이
         * 먼저 흐르는 Gemini 경로에서는 아래 `pendingCardBlocks` 가 붙인다.
         */
        if (blockMatches && cardHasResults(toolOutput)) { const jsonBlock = '\n' + blockMatches.join('\n\n') + '\n\n'; st.fullAiResponse += jsonBlock; sendEvent({ text: jsonBlock }); }
      } else if (event.event === 'on_tool_end' && ['search_web', 'search_drug_info'].includes(event.name)) {
        const rawOutput = data?.output;
        const toolOutput: string = typeof rawOutput === 'string' ? rawOutput : typeof rawOutput?.content === 'string' ? rawOutput.content : Array.isArray(rawOutput?.content) ? rawOutput.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : '';
        const urlBlockMatch = toolOutput.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
        if (urlBlockMatch) { let added = false; urlBlockMatch[1].split('\n').forEach((line: string) => { const [url, ...tp] = line.split(' | '); const title = tp.join(' | ').trim() || url; if (url?.startsWith('http') && !st.allSources.some((e: any) => e.uri === url)) { st.allSources.push({ title, uri: url }); added = true; } }); if (added) sendEvent({ sources: st.allSources }); }
      } else if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
        const finalOutput = data?.output;
        const finalMessages: any[] = finalOutput?.messages || [];
        for (const msg of finalMessages) {
          const msgType = msg._getType?.() ?? msg.getType?.() ?? msg.type;
          if (msgType === 'tool') {
            const content = typeof msg.content === 'string' ? msg.content : '';
            const urlBlockMatch = content.match(/\[WEB_SOURCE_URLS\]\n([\s\S]+?)(?:\n\n|$)/);
            if (urlBlockMatch) { let added = false; urlBlockMatch[1].split('\n').forEach((line: string) => { const [url, ...tp] = line.split(' | '); const title = tp.join(' | ').trim() || url; if (url?.startsWith('http') && !st.allSources.some((e: any) => e.uri === url)) { st.allSources.push({ title, uri: url }); added = true; } }); if (added) sendEvent({ sources: st.allSources }); }
          }
        }
        const finalSources: any[] = finalOutput?.groundingSources || [];
        if (finalSources.length > 0) { let added = false; finalSources.forEach((s: any) => { if (s?.uri && !st.allSources.some((e: any) => e.uri === s.uri)) { st.allSources.push(s); added = true; } }); if (added) sendEvent({ sources: st.allSources }); }
      }
    };

    const trackingEvent = (data: any) => {
        if (data?.text) st.fullAiResponse += data.text;
        sendEvent(data);
    };

    return { handle, trackingEvent, state: st };
}
