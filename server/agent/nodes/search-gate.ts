import { classifySearchNeed, shouldSuppressSearchForFollowup, isFollowupReference } from "../intentRules";

/**
 * Google Search gate — decides whether to enable grounding for the SDK path.
 * Pure decision logic extracted from generator.ts (move-only).
 *
 * Priority of gates (each can only turn search OFF, except medical_qa which forces ON):
 *   multimodal/history-image → youtube → url → renderer → attached-doc → general(needsSearch).
 *
 * Returns `useGoogleSearch` plus the side-values the caller consumes downstream
 * (token budget / diagnostic logs): hasUrlContent, historyHasImage,
 * rendererIntents, explicitSearchRequested.
 */
export const decideGoogleSearch = (ctx: {
    webContent: string;
    messages: any[];
    intent: string;
    needsSearch: boolean;
    hasMultimodalContent: boolean;
    dropImageForSearch: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    latestUserText: string;
}): {
    useGoogleSearch: boolean;
    hasUrlContent: boolean;
    historyHasImage: boolean;
    rendererIntents: Set<string>;
    explicitSearchRequested: boolean;
} => {
    const { webContent, messages, intent, needsSearch, hasMultimodalContent, dropImageForSearch, isYoutubeRequest, hasVideoData, latestUserText } = ctx;

    // Google Search is incompatible with multimodal content (images, video, PDF)
    // Optimization: Disable Google Search for YouTube summaries when transcript OR video data is present
    const hasTranscript = webContent.includes('[TRANSCRIPT]');
    // hasVideoData is hoisted above the while loop — accessible here via closure

    // Disable Google Search when image exists anywhere in conversation history.
    // Gemini API does not support Google Search + image in the same request.
    // Without this, follow-up turns (e.g. "표로 정리해줘") after an image analysis
    // would enable Google Search (no image in *current* turn), causing the model
    // to ignore the image history and return sparse, search-based responses.
    const historyHasImage = messages.some((m: any) =>
        Array.isArray(m.content) && m.content.some((p: any) =>
            p.inlineData || (p.fileData && !p.fileData.fileUri?.includes('youtube'))
        )
    );

    // URL_CONTENT 태그 존재 여부로 Google Search 비활성 여부를 결정.
    // 이전에는 내용 길이 >= 300 조건을 사용했으나, Vercel(해외 IP)에서
    // 한국 뉴스 사이트(Naver 등)가 짧은 HTML을 반환하면 Google Search가 활성화되어
    // 전혀 다른 기사를 요약하는 문제가 발생. URL이 제공된 이상 해당 URL 기반으로만 요약해야 함.
    // [URL_CONTENT:...] 태그 자체가 "URL fetch 시도 완료" 신호이므로 길이 체크 제거.
    const hasUrlContent = webContent.includes('[URL_CONTENT:');

    // Multi-turn YouTube: 1st response is stored as [VIDEO_ANALYSIS_SUMMARY]
    // in webContent. Treat it the same as native video data — no Search needed.
    const hasVideoSummary = webContent.includes('[VIDEO_ANALYSIS_SUMMARY');

    let useGoogleSearch = !hasMultimodalContent && (!historyHasImage || dropImageForSearch);
    // 1턴: transcript/native video 있으면 Search 비활성
    // 2턴+: VIDEO_ANALYSIS_SUMMARY가 있으면 Search 비활성 (1차 분석 결과가 컨텍스트)
    if (isYoutubeRequest && (hasTranscript || hasVideoData || hasVideoSummary)) {
        useGoogleSearch = false;
    }
    if (hasUrlContent) {
        useGoogleSearch = false;
    }
    // Follow-up turns after URL analysis: keep single-pass path
    // so the model can still access document content from history.
    const historyHasUrl = messages.slice(0, -1)
        .filter((m: any) => m._getType() === 'human')
        .some((m: any) => {
            const text = Array.isArray(m.content)
                ? (m.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                : String(m.content);
            return /https?:\/\/\S+/.test(text);
        });
    // Current message URL check: slice(0,-1) misses the current turn, so
    // 2.5 Flash with Google Search sees the URL and tries to fetch it.
    // Disable Search when current prompt contains a non-YouTube URL.
    const currentMsgHasNonYtUrl = (() => {
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg._getType() !== 'human') return false;
        const text = Array.isArray(lastMsg.content)
            ? (lastMsg.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : String(lastMsg.content);
        return /https?:\/\/\S+/.test(text) && !/(?:youtube\.com|youtu\.be)/.test(text);
    })();
    // Fix A: historyHasUrl을 무조건 off로 두면, 1턴에 URL을 한 번 붙인 뒤
    // 그 대화 내내 모든 후속 질문의 검색이 영구히 꺼진다. 새 질문이 URL과 무관해도
    // 검색이 막혀 → 모델이 grounding 툴 없이 검색을 시도하다 [tool_code] print(google_search(...))
    // 환각을 본문으로 토출한다. 따라서:
    //  - 현재 메시지 자체에 URL이 있으면(요약 대상) 기존대로 off.
    //  - history에만 URL이 있으면, 현재 메시지가 직전 답변을 가공·참조하는 follow-up
    //    (요약/정리/비교/위에서…)이고 새 검색요구가 아닐 때만 off. 새 검색요구면
    //    grounding을 살려 아래 general 게이트가 판정하도록 위임.
    if (currentMsgHasNonYtUrl) {
        useGoogleSearch = false;
    } else if (historyHasUrl) {
        const isNewSearchQuery = classifySearchNeed(latestUserText) === 'on';
        const isUrlFollowup = isFollowupReference(latestUserText);
        if (isUrlFollowup && !isNewSearchQuery) {
            useGoogleSearch = false;
            console.log('[LangGraph] historyHasUrl follow-up reference — Google Search suppressed');
        } else {
            console.log(`[LangGraph] historyHasUrl but new query (followup=${isUrlFollowup}, newSearch=${isNewSearchQuery}) — keeping search gate open`);
        }
    }
    // medical_qa: 이미지 없는 경우 Google Search 강제 활성화
    // LLM 내부 지식 의존 → 실시간 의학 정보 + 출처 기반 답변으로 개선
    // (이미지가 있으면 Gemini API 제약상 Search 불가 → hasMultimodalContent/historyHasImage 조건 유지)
    if (intent === 'medical_qa' && !hasMultimodalContent && !historyHasImage) {
        useGoogleSearch = true;
    }
    // Renderer intents should produce structured JSON directly. If Google Search is
    // left on for 3.5, the two-track path turns the request into Stage1 search notes
    // followed by Stage2 summary, which can drop the visualization block entirely.
    const rendererIntents = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);
    const explicitSearchRequested = /(검색|찾아|조사|출처|근거|최신|최근|실시간|뉴스|latest|recent|search|source|cite)/i.test(latestUserText);
    if (rendererIntents.has(intent) && !explicitSearchRequested) {
        useGoogleSearch = false;
    }

    // 첨부 문서 게이트: 추출 텍스트(hwp/docx/xlsx/txt…)는 그 자체가 답변 근거이므로
    // grounding 기본 off. 문서 요약·검토 요청에 불필요한 웹검색이 붙어 레이턴시/환각이
    // 늘던 문제 해결. 단, 사용자가 "문서 외 추가 검증"(검색/조사/최신/출처 등)을 명시 요청하면
    // 게이트를 열어둬 아래 general 게이트(needsSearch)가 판정 → URL 게이트와 동일 철학.
    // 마커: [EXTRACTED_CONTENT:](현재 턴 첨부) / [PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:](후속 턴).
    const hasDocContent = webContent.includes('[EXTRACTED_CONTENT:')
        || webContent.includes('[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:');
    if (hasDocContent && !explicitSearchRequested) {
        useGoogleSearch = false;
        console.log('[LangGraph] Doc content present, no explicit external-search request — Google Search suppressed');
    }

    // General intent: 라우터의 검색 필요 판정(state.needsSearch)을 반영 (게이트 6·7).
    // 위 게이트들이 이미 image/url/video/renderer를 off로 확정했으므로,
    // "순수 general"(useGoogleSearch가 아직 true)일 때만 적용 → 기존 13-intent 분기·tool 로직 전부 보존.
    // medical_qa/renderer는 intent!=='general'이라 제외, image/url/video는 useGoogleSearch===false라 제외.
    // 기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (6-2 게이트6/7, 6-3, 9-B)
    if (intent === 'general' && useGoogleSearch) {
        useGoogleSearch = needsSearch; // 게이트7: 라우터 판정 (default-on이라 누락 시 기존과 동일)
        // 게이트6: 검색결과 멀티턴 가드 — 직전 턴 검색됨 + follow-up 가공형이면 재검색 억제.
        // prevSearched = 직전 human 메시지 classifySearchNeed==='on' 근사 (9-B A안: grounding 마커 미영속).
        const humanMsgs = messages.filter((m: any) => m._getType() === 'human');
        const prevHuman = humanMsgs.length >= 2 ? humanMsgs[humanMsgs.length - 2] : undefined;
        const prevHumanText = prevHuman
            ? (Array.isArray(prevHuman.content)
                ? (prevHuman.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                : String(prevHuman.content))
            : '';
        const prevSearched = prevHumanText ? classifySearchNeed(prevHumanText) === 'on' : false;
        if (shouldSuppressSearchForFollowup(latestUserText, prevSearched)) {
            useGoogleSearch = false;
            console.log('[LangGraph] Multi-turn follow-up guard — Google Search suppressed');
        }
        console.log(`[LangGraph] General search gate — needsSearch=${needsSearch}, prevSearched=${prevSearched}, useGoogleSearch=${useGoogleSearch}`);
    }

    return { useGoogleSearch, hasUrlContent, historyHasImage, rendererIntents, explicitSearchRequested };
};
