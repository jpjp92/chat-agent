import { classifySearchNeed, isFollowupReference } from "../intent-rules";
import { TIER, decideSearch, formatSearchTrace, type SearchSignal } from "../search-policy";
import { collectTextSearchSignals, wantsExternalVerification } from "../search-signals";

/**
 * Google Search 게이트 — SDK 경로에서 grounding 을 켤지 정한다.
 *
 * 구조: 증거(Signal) → 정책(Policy) 2단 분리. 기획 docs/plans/PLAN_SEARCH_POLICY_260815.md
 *
 * 아무 게이트도 `useGoogleSearch` 를 덮어쓰지 않는다(덮어쓰기 순서가 우선순위가 되면 휴리스틱 추측이
 * 사용자의 명시적 검색 요청을 이긴다). 각 게이트는 근거를 담은 **신호를 제출**하고,
 * decideSearch()가 선언된 tier로 승자를 정한다:
 *   400 물리제약(멀티모달) > 300 사용자 명시 > 200 근거 제공됨(URL·문서·영상·렌더러)
 *   > 100 분류기(라우터·멀티턴 가드) > 0 기본값
 *
 * `useGoogleSearch` 와 호출부가 아래에서 쓰는 부가 값(토큰 상한·진단 로그)을
 * 돌려준다: hasUrlContent, rendererIntents, explicitSearchRequested.
 */
export const decideGoogleSearch = (ctx: {
    webContent: string;
    messages: any[];
    intent: string;
    needsSearch: boolean;
    hasMultimodalContent: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    latestUserText: string;
    /** 직전 턴 실제 검색 여부(state). undefined면 정규식 근사로 폴백. */
    lastTurnSearched?: boolean;
    /**
     * 어느 공급자로 이 턴을 생성하는가. **TIER 400 의 적용 여부를 가른다.**
     *
     * TIER 400 은 정책이 아니라 **물리 사실**("Gemini 는 이미지와 grounding 을 한 요청에 못 담는다")이다.
     * OpenAI Responses 는 input_image 와 web_search 를 함께 보내므로, 이 제약을 OpenAI 에 걸면
     * 이미지 첨부 뒤의 명시 검색 요청(300)이 눌린다 → DEV_260902
     *
     * 주의: 걷어내는 건 400 뿐이다. 200(URL·문서·영상 본문이 근거)·100 은 공급자와 무관한
     * 판단이므로 그대로 적용된다.
     *
     * 기본값 'gemini'.
     */
    provider?: 'gemini' | 'openai';
}): {
    useGoogleSearch: boolean;
    hasUrlContent: boolean;
    rendererIntents: Set<string>;
    explicitSearchRequested: boolean;
} => {
    const { webContent, messages, intent, needsSearch, hasMultimodalContent, isYoutubeRequest, hasVideoData, latestUserText, lastTurnSearched, provider = 'gemini' } = ctx;

    const signals: SearchSignal[] = [];

    // ── 컨텍스트 증거 수집 ────────────────────────────────────────────────
    const hasTranscript = webContent.includes('[TRANSCRIPT]');

    // URL_CONTENT 태그 존재 여부로 Google Search 비활성 여부를 결정.
    // 이전에는 내용 길이 >= 300 조건을 사용했으나, Vercel(해외 IP)에서
    // 한국 뉴스 사이트(Naver 등)가 짧은 HTML을 반환하면 Google Search가 활성화되어
    // 전혀 다른 기사를 요약하는 문제가 발생. URL이 제공된 이상 해당 URL 기반으로만 요약해야 함.
    const hasUrlContent = webContent.includes('[URL_CONTENT:');

    // 멀티턴 YouTube: 첫 응답은 webContent 에 [VIDEO_ANALYSIS_SUMMARY] 로 저장된다.
    // 기본 영상 데이터와 똑같이 취급 — 검색 불필요.
    const hasVideoSummary = webContent.includes('[VIDEO_ANALYSIS_SUMMARY');

    // 첨부 문서: 추출 텍스트(hwp/docx/xlsx/txt…)는 그 자체가 답변 근거다.
    // 마커: [EXTRACTED_CONTENT:](현재 턴 첨부) / [PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:](후속 턴).
    const hasDocContent = webContent.includes('[EXTRACTED_CONTENT:')
        || webContent.includes('[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:');

    const rendererIntents = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);
    // 근거 밖 추가 검증 요구 — renderer·첨부문서 게이트의 탈출구(기존 넓은 정규식의 역할).
    const explicitSearchRequested = wantsExternalVerification(latestUserText);

    // ── tier 400: 물리 제약 (Gemini API가 멀티모달 + grounding 동시 거부) ──
    // OpenAI 에는 이 제약이 없다(input_image + web_search 동시 전송 가능) → 신호 자체를 내지 않는다.
    // 여기서 켜는 게 아니라 **끄지 않는 것**이다 — 아래 300/100 이 평소대로 판정한다.
    //
    // 주의: `hasMultimodalContent` 는 **서버가 받은 히스토리**(최근 10개, 첨부는 최근 mediaWindow 개까지만
    // 미디어) 기준이다. 그래서 이미지가 검색을 끄는 범위는 "대화 내내"가 아니라 **첨부 직후 턴**이다 —
    // 그 경계는 history.ts 가 로그로 남긴다(DEV_260902 §9.5).
    if (provider === 'gemini' && hasMultimodalContent) {
        signals.push({ tier: TIER.HARD_CONSTRAINT, verdict: 'off', source: 'multimodal', reason: '멀티모달 — API가 grounding 거부' });
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

    // 렌더러 인텐트는 구조화 JSON 을 바로 만들어야 한다. Google Search 를 켜 두면
    // 검색 메모 → 요약 두 단계로 흘러 시각화 블록이 통째로 빠질 수 있다
    // (3.5 two-track 에서 실제로 났다).
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
    // prevSearched: state.lastTurnSearched(실제 grounding 출처 유무) 우선, 없으면 정규식 근사 폴백.
    // 근사는 룰로 켜진 검색만 잡아 medical_qa·카드처럼 intent 로 강제된 검색을 놓친다(DEV_260815_DEPLOY_CHECK).
    // `activeCards`와 같은 폴백 구조라 구버전 클라이언트(groundingSources 미전송)도 동작한다.
    const prevSearchedApprox = (() => {
        const humanMsgs = messages.filter((m: any) => m._getType() === 'human');
        const prevHuman = humanMsgs.length >= 2 ? humanMsgs[humanMsgs.length - 2] : undefined;
        if (!prevHuman) return false;
        const text = Array.isArray(prevHuman.content)
            ? (prevHuman.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : String(prevHuman.content);
        return text ? classifySearchNeed(text) === 'on' : false;
    })();
    const prevSearched = lastTurnSearched ?? prevSearchedApprox;

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
        rendererIntents,
        explicitSearchRequested,
    };
};
