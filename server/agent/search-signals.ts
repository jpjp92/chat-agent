/**
 * Search Signals — 텍스트로부터 얻는 검색 근거를 신호로 변환한다.
 *
 * 기획: docs/plans/PLAN_SEARCH_POLICY_260815.md (Step 4)
 *
 * 여기는 "증거" 레이어다. 판정하지 않는다 — 신호만 낸다.
 * 최종 결정은 search-policy.ts의 decideSearch()가 tier로 내린다.
 *
 * 컨텍스트 증거(멀티모달·URL·영상·첨부문서)는 messages/webContent 검사가 필요하므로
 * nodes/search-gate.ts가 담당한다. 이 파일은 **최신 사용자 발화 텍스트만** 본다 —
 * 그래서 순수 함수이고, 테스트가 프로덕션 경로를 그대로 실행할 수 있다.
 */

import {
    classifySearchNeed,
    shouldSuppressSearchForFollowup,
    detectExplicitSearchRequest,
    wantsGroundedDetail,
} from "./intent-rules";
import { TIER, type SearchSignal } from "./search-policy";

/**
 * "제공된 근거(첨부문서·렌더러 출력) 밖에서 추가 검증을 원하는가."
 *
 * renderer·첨부문서 게이트의 탈출구다. 명시 검색 요청뿐 아니라 시의성 요구
 * (최신·오늘·뉴스…)도 포함한다 — 기존 search-gate의 넓은 정규식이 하던 역할과 같다.
 * tier 300(user-explicit)과 구분되는 개념이라 별도 함수로 둔다.
 */
export const wantsExternalVerification = (text: string): boolean =>
    detectExplicitSearchRequest(text) || classifySearchNeed(text) === "on";

/**
 * 최신 발화 텍스트에서 나오는 신호들.
 *
 * @param isGeneralIntent general intent에서만 분류기(rule/router/가드) 신호를 낸다.
 *        13-intent 분기·툴 로직을 건드리지 않기 위해서다(기존 게이트6·7 조건과 동일).
 */
export const collectTextSearchSignals = (opts: {
    latestUserText: string;
    prevSearched: boolean;
    needsSearch: boolean;
    isGeneralIntent: boolean;
}): SearchSignal[] => {
    const { latestUserText, prevSearched, needsSearch, isGeneralIntent } = opts;
    const signals: SearchSignal[] = [];

    // tier 300 — 사용자 명시 요청. 멀티턴 가드(100)도, 첨부문서(200)도 이걸 뒤집지 못한다(DEV_260815).
    if (detectExplicitSearchRequest(latestUserText)) {
        signals.push({
            tier: TIER.USER_EXPLICIT,
            verdict: "on",
            source: "user-explicit",
            reason: "사용자가 검색·출처를 명시 요청",
        });
    }

    if (!isGeneralIntent) return signals;

    // tier 100 — 라우터 판정(rule + router LLM 합성 결과가 state.needsSearch로 넘어온다).
    signals.push({
        tier: TIER.CLASSIFIER,
        verdict: needsSearch ? "on" : "off",
        source: "router-llm",
        reason: `라우터 needsSearch=${needsSearch}`,
    });

    // tier 100 — 멀티턴 가드. 동 tier에서 router-llm보다 앞선다(SAME_TIER_PRECEDENCE).
    // "최근 검색한 내용 요약해줘"의 temporal ON을 과거참조로 정정하는 것이 존재 이유다.
    if (shouldSuppressSearchForFollowup(latestUserText, prevSearched)) {
        signals.push({
            tier: TIER.CLASSIFIER,
            verdict: "off",
            source: "followup-guard",
            reason: "직전 턴 검색됨 + 가공형 follow-up",
        });
    } else if (wantsGroundedDetail(latestUserText, prevSearched)) {
        signals.push({
            tier: TIER.CLASSIFIER,
            verdict: "on",
            source: "followup-detail",
            reason: "직전 턴 검색됨 + 세부·다른 항목 follow-up",
        });
    }

    return signals;
};

/**
 * 논문 카드 도구 + **사용자가 검색을 명시 요청** → 종합 단계에 웹 검색을 붙여 돌려준다.
 *
 * generator 의 `useWebSearch = !localFunctionTool && ...` 는 로컬 함수가 있으면 웹 검색을 끈다.
 * 라우터가 논문 의도로 미끄러지면(예: 레포 검색이 `arxiv_search` 로) 사용자의 명시 검색 요청(tier 300)이
 * 버려지고 엉뚱한 arXiv 근거만 남는다. 라우터 가드(`resolvePaperArtifactIntent`)가 1차 방어이고,
 * 이건 그걸 뚫고 온 경우의 2차 방어다 → DEV_260902
 *
 * 주의: 논문 두 intent 로만 좁힌다. 약국·병원·날씨 카드는 조회 결과가 곧 답이라 웹을 덧붙일
 * 이유가 없고 레이턴시만 는다. `drug_info` 는 이미 상시 `followupWebSearch: true` 다.
 *
 * 여기 두는 이유: 개념상 local-tool-registry 가 맞지만, 그 모듈은 도구를 통해 Supabase 클라이언트까지
 * 끌고 와 시크릿 없이는 임포트되지 않는다. 판정은 텍스트 신호이므로 여기 두고 도구 모양은 제네릭으로
 * 받는다 — 하니스가 프로덕션을 그대로 실행한다.
 */
const PAPER_CARD_INTENTS = new Set(['paper_search', 'arxiv_search']);

export const withExplicitSearchFollowup = <T extends { intent: string; followupWebSearch?: boolean }>(
    tool: T | undefined,
    latestUserText: string,
): T | undefined =>
    tool && PAPER_CARD_INTENTS.has(tool.intent) && detectExplicitSearchRequest(latestUserText)
        ? { ...tool, followupWebSearch: true }
        : tool;

/**
 * 히스토리 이미지를 이번 요청에서 빼고 검색을 켤 것인가 (Gemini SDK 경로 전용).
 *
 * Gemini 는 이미지와 grounding 을 한 요청에 못 담는다(tier 400). 그래서 **이미지를 빼는 것**이
 * 유일한 탈출구다 — 이미지 내용은 직전 assistant 답변에 텍스트로 전사돼 있어 팩트체크가 가능하다.
 * (OpenAI 는 이 제약이 없어 이 함수를 타지 않는다 — `provider: 'openai'` 로 400 자체가 안 난다.)
 *
 * `general` 과 `medical_qa` 가 대상이다 — `medical_qa` 는 게이트에서 tier 100 검색 강제 ON 이라,
 * 400 에 눌리면 "의약 질의는 출처 기반으로 답한다" 정책이 이미지 직후 턴 동안 무효가 된다 → DEV_260902 §9.2
 *
 * 렌더러 의도(astronomy·biology·chemistry·physics·data_viz)는 제외한다 — 히스토리 이미지가 답의
 * **대상**일 수 있고(`이 사진 속 분자 구조 그려줘`), tier 200 `renderer` 신호로 어차피 off 다.
 */
const IMAGE_DROP_ELIGIBLE_INTENTS = new Set(['general', 'medical_qa']);

export const shouldDropImageForSearch = (opts: {
    intent: string;
    /** 이번 턴에 새로 붙인 이미지가 있는가 — 있으면 그게 질문 대상이므로 빼면 안 된다. */
    currentTurnHasImage: boolean;
    historyHasImage: boolean;
    /** 검색·팩트체크를 원한다는 신호(라우터 needsSearch 또는 발화 어휘). */
    explicitSearchSignal: boolean;
}): boolean =>
    IMAGE_DROP_ELIGIBLE_INTENTS.has(opts.intent)
    && !opts.currentTurnHasImage
    && opts.historyHasImage
    && opts.explicitSearchSignal;

/**
 * LangChain(Gemini) 논문 턴의 **종합 단계**에 웹 검색 도구를 더할 것인가.
 *
 * LangChain 경로는 grounding 을 쓰지 않으므로 논문 의도에 웹 탈출구가 따로 있어야 한다
 * (`drug_info` 는 `[searchDrugInfoTool, searchWebTool]` 로 웹을 함께 준다) → DEV_260902 §9.3
 *
 * `afterToolResult` 가 필수인 이유: 1차 호출에 도구를 둘 주면 `forceDomainTool`(`allTools.length === 1` 요구)이
 * 풀려 모델이 논문 도구를 안 부를 수 있다(그 강제는 Gemini 가 지원하는 요청도 스스로 거절하는 것을 막는다).
 * 그래서 조회는 단독·강제로 끝내고, `ToolMessage` 이후에만 웹을 더한다.
 * OpenAI 의 `functionPhase: 'followup'`(`withExplicitSearchFollowup`)과 같은 구조다.
 */
export const shouldAddWebSearchToPaperFollowup = (
    intent: string,
    afterToolResult: boolean,
    latestUserText: string,
): boolean =>
    PAPER_CARD_INTENTS.has(intent)
    && afterToolResult
    && detectExplicitSearchRequest(latestUserText);
