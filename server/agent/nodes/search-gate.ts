import { classifySearchNeed, isFollowupReference } from "../intentRules";
import { TIER, decideSearch, formatSearchTrace, type SearchSignal } from "../search-policy";
import { collectTextSearchSignals, wantsExternalVerification } from "../search-signals";

/**
 * Google Search gate — decides whether to enable grounding for the SDK path.
 *
 * 구조: 증거(Signal) → 정책(Policy) 2단 분리. 기획 docs/plans/PLAN_SEARCH_POLICY_260815.md
 *
 * 이전에는 게이트들이 `useGoogleSearch` boolean을 순차적으로 덮어썼고, 우선순위가
 * if문의 물리적 배치 순서로만 존재했다. 그래서 휴리스틱 추측(멀티턴 가드)이 사용자의
 * 명시적 검색 요청을 이길 수 있었다(DEV_260815).
 *
 * 지금은 아무도 덮어쓰지 않는다. 각 게이트는 근거를 담은 **신호를 제출**하고,
 * decideSearch()가 선언된 tier로 승자를 정한다:
 *   400 물리제약(멀티모달) > 300 사용자 명시 > 200 근거 제공됨(URL·문서·영상·렌더러)
 *   > 100 분류기(라우터·멀티턴 가드) > 0 기본값
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

    const signals: SearchSignal[] = [];

    // ── 컨텍스트 증거 수집 ────────────────────────────────────────────────
    const hasTranscript = webContent.includes('[TRANSCRIPT]');

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
    const hasUrlContent = webContent.includes('[URL_CONTENT:');

    // Multi-turn YouTube: 1st response is stored as [VIDEO_ANALYSIS_SUMMARY]
    // in webContent. Treat it the same as native video data — no Search needed.
    const hasVideoSummary = webContent.includes('[VIDEO_ANALYSIS_SUMMARY');

    // 첨부 문서: 추출 텍스트(hwp/docx/xlsx/txt…)는 그 자체가 답변 근거다.
    // 마커: [EXTRACTED_CONTENT:](현재 턴 첨부) / [PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:](후속 턴).
    const hasDocContent = webContent.includes('[EXTRACTED_CONTENT:')
        || webContent.includes('[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:');

    const rendererIntents = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);
    // 근거 밖 추가 검증 요구 — renderer·첨부문서 게이트의 탈출구(기존 넓은 정규식의 역할).
    const explicitSearchRequested = wantsExternalVerification(latestUserText);

    // ── tier 400: 물리 제약 (Gemini API가 멀티모달 + grounding 동시 거부) ──
    if (hasMultimodalContent) {
        signals.push({ tier: TIER.HARD_CONSTRAINT, verdict: 'off', source: 'multimodal', reason: '현재 턴 멀티모달 — API가 grounding 거부' });
    }
    if (historyHasImage && !dropImageForSearch) {
        signals.push({ tier: TIER.HARD_CONSTRAINT, verdict: 'off', source: 'history-image', reason: '히스토리 이미지 — API가 grounding 거부' });
    }

    // ── tier 200: 답변 근거가 이미 제공됨 ────────────────────────────────
    // 1턴: transcript/native video, 2턴+: VIDEO_ANALYSIS_SUMMARY(1차 분석 결과가 컨텍스트)
    if (isYoutubeRequest && (hasTranscript || hasVideoData || hasVideoSummary)) {
        signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'video-content', reason: '영상 자막·분석 결과가 근거' });
    }
    if (hasUrlContent) {
        signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'url-content', reason: 'URL 본문이 근거' });
    }

    // Current message URL check: history 검사는 현재 턴을 놓치므로,
    // 2.5 Flash + Google Search가 URL을 보고 직접 fetch를 시도하는 문제가 있다.
    const currentMsgHasNonYtUrl = (() => {
        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg._getType() !== 'human') return false;
        const text = Array.isArray(lastMsg.content)
            ? (lastMsg.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : String(lastMsg.content);
        return /https?:\/\/\S+/.test(text) && !/(?:youtube\.com|youtu\.be)/.test(text);
    })();

    const historyHasUrl = messages.slice(0, -1)
        .filter((m: any) => m._getType() === 'human')
        .some((m: any) => {
            const text = Array.isArray(m.content)
                ? (m.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                : String(m.content);
            return /https?:\/\/\S+/.test(text);
        });

    // Fix A(보존): historyHasUrl을 무조건 off로 두면, 1턴에 URL을 한 번 붙인 뒤 그 대화 내내
    // 모든 후속 질문의 검색이 영구히 꺼진다. 새 질문이 URL과 무관해도 검색이 막혀 →
    // 모델이 grounding 툴 없이 [tool_code] print(google_search(...)) 환각을 본문으로 토출한다.
    //  - 현재 메시지 자체에 URL이 있으면(요약 대상) off 신호.
    //  - history에만 URL이 있으면, 현재 메시지가 가공형 follow-up이고 새 검색요구가 아닐 때만 off.
    if (currentMsgHasNonYtUrl) {
        signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'url-content', reason: '현재 메시지에 URL — 해당 URL 기반 답변' });
    } else if (historyHasUrl) {
        const isNewSearchQuery = classifySearchNeed(latestUserText) === 'on';
        const isUrlFollowup = isFollowupReference(latestUserText);
        if (isUrlFollowup && !isNewSearchQuery) {
            signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'url-content', reason: 'history URL 가공형 follow-up' });
        } else {
            console.log(`[LangGraph] historyHasUrl but new query (followup=${isUrlFollowup}, newSearch=${isNewSearchQuery}) — no url signal`);
        }
    }

    // 첨부 문서 게이트: 문서 요약·검토에 불필요한 웹검색이 붙어 레이턴시/환각이 늘던 문제 해결.
    // 사용자가 "문서 외 추가 검증"을 명시 요청하면 신호를 내지 않는다(= 게이트를 연다).
    if (hasDocContent && !explicitSearchRequested) {
        signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'doc-content', reason: '첨부 문서 본문이 근거' });
    }

    // Renderer intents should produce structured JSON directly. If Google Search is
    // left on for 3.5, the two-track path turns the request into Stage1 search notes
    // followed by Stage2 summary, which can drop the visualization block entirely.
    if (rendererIntents.has(intent) && !explicitSearchRequested) {
        signals.push({ tier: TIER.CONTEXT_GROUNDED, verdict: 'off', source: 'renderer', reason: '구조화 출력 보존' });
    }

    // ── tier 100: medical_qa 강제 ON ─────────────────────────────────────
    // LLM 내부 지식 의존 → 실시간 의학 정보 + 출처 기반 답변으로 개선.
    // 동 tier에서 rule/router보다 앞서므로 분류기 판정을 이기고, 400/200에는 진다
    // (이미지가 있으면 API 제약, URL·문서가 있으면 그게 근거).
    if (intent === 'medical_qa') {
        signals.push({ tier: TIER.CLASSIFIER, verdict: 'on', source: 'medical-qa', reason: '의약 질의 — 출처 기반 답변 강제' });
    }

    // ── tier 300/100: 최신 발화 텍스트 신호 (명시 요청 · 라우터 · 멀티턴 가드) ──
    // prevSearched = 직전 human 메시지 classifySearchNeed==='on' 근사
    // (9-B A안: grounding 마커 미영속. Step 6에서 실제 검색 여부 영속화로 대체 예정.)
    const humanMsgs = messages.filter((m: any) => m._getType() === 'human');
    const prevHuman = humanMsgs.length >= 2 ? humanMsgs[humanMsgs.length - 2] : undefined;
    const prevHumanText = prevHuman
        ? (Array.isArray(prevHuman.content)
            ? (prevHuman.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : String(prevHuman.content))
        : '';
    const prevSearched = prevHumanText ? classifySearchNeed(prevHumanText) === 'on' : false;

    signals.push(...collectTextSearchSignals({
        latestUserText,
        prevSearched,
        needsSearch,
        isGeneralIntent: intent === 'general',
    }));

    // ── 정책 적용 ────────────────────────────────────────────────────────
    const decision = decideSearch(signals);
    console.log(formatSearchTrace(decision));

    return {
        useGoogleSearch: decision.useGoogleSearch,
        hasUrlContent,
        historyHasImage,
        rendererIntents,
        explicitSearchRequested,
    };
};
