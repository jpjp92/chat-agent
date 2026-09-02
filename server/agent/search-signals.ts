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

/**
 * 논문 카드 도구 + **사용자가 검색을 명시 요청** → 종합 단계에 웹 검색을 붙여 돌려준다.
 *
 * 🔴 왜 필요한가(2026-09-02 실사용). 라우터가 "클로드 skills 관련된 레포 검색" 을
 *   `arxiv_search` 로 보내자, generator 의 `useWebSearch = !localFunctionTool && ...` 가
 *   **로컬 함수가 있다는 이유만으로** 사용자의 명시 검색 요청(tier 300)을 버렸고, 논문 도구엔
 *   `followupWebSearch` 도 없어서 답변 전체가 엉뚱한 arXiv 근거만 달고 나갔다 — 웹으로
 *   빠져나갈 구멍이 하나도 없었다. 라우터 가드(`resolvePaperArtifactIntent`)가 1차 방어이고,
 *   이건 그걸 뚫고 온 경우의 2차 방어다.
 *
 * ⚠️ 논문 두 intent 로만 좁힌다. 약국·병원·날씨 카드는 조회 결과가 곧 답이라 웹을 덧붙일
 *   이유가 없고 레이턴시만 는다. `drug_info` 는 이미 상시 `followupWebSearch: true` 다.
 *
 * 🏠 여기 사는 이유: 개념상 local-tool-registry 가 맞지만, 그 모듈은 도구 12종을 통해
 *   Supabase 클라이언트까지 끌고 와 시크릿 없이는 임포트되지 않는다. 판정은 텍스트 신호이므로
 *   (이 파일의 주제) 여기 두고 도구 모양은 제네릭으로 받는다 — 하니스가 프로덕션을 그대로 실행한다.
 */
const PAPER_CARD_INTENTS = new Set(['paper_search', 'arxiv_search']);

export const withExplicitSearchFollowup = <T extends { intent: string; followupWebSearch?: boolean }>(
    tool: T | undefined,
    latestUserText: string,
): T | undefined =>
    tool && PAPER_CARD_INTENTS.has(tool.intent) && detectExplicitSearchRequest(latestUserText)
        ? { ...tool, followupWebSearch: true }
        : tool;
