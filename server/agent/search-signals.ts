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
} from "./intentRules";
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

    // tier 300 — 사용자 명시 요청. 이번 결함(DEV_260815)을 막는 신호가 정확히 이것이다.
    // 멀티턴 가드(100)도, 첨부문서(200)도 이걸 뒤집지 못한다.
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
    }

    return signals;
};
