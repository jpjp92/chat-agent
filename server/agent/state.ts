import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { DEFAULT_CHAT_MODEL } from "../models";

export type IntentType =
    | "drug_id"      // 알약 이미지 식별 요청
    | "drug_info"    // 텍스트 약품 정보 조회
    | "medical_qa"   // 일반 의학/건강 질의
    | "biology"      // 생명과학 (단백질, DNA, 세포)
    | "chemistry"    // 화학 (분자구조, 반응, 원소)
    | "physics"      // 물리 (역학, 시뮬레이션)
    | "astronomy"    // 천문 (별자리, 행성, 우주)
    | "data_viz"     // 데이터/통계 (차트, 그래프)
    | "pharmacy_search" // 약국 위치/영업시간 탐색 (서울 한정)
    | "hospital_search" // 병원 위치/영업시간 탐색 (서울 한정)
    | "vet_search"    // 동물병원 위치 탐색 (전국)
    | "law_search"    // 국가법령정보 조회
    | "movie_search"  // 영화 상영시간표 (CGV/롯데/메가박스)
    | "sports"        // 월드컵 순위/대진/득점왕 (football-data.org)
    | "weather"       // 날씨 카드 (KMA + OpenWeather 하이브리드)
    | "general";     // 나머지 모든 것

/**
 * AgentState definition for LangGraph.js
 * Tracks conversation history, user attachments, extraction results, and routing flow.
 */
export const GraphState = Annotation.Root({
    // The conversation history including user inputs, AI responses, and Tool messages.
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // Text content extracted from uploaded documents/web pages by the frontend.
    webContent: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // 현재 화면에 표시된 영화 상영표 요약(클라이언트 전달). 멀티턴 후속 질문 답변용.
    movieContext: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // 이번 턴이 영화 카드에 대한 후속 질문인지(라우터 판정). generator의 movieContext 주입 게이트.
    movieFollowup: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),

    // Any files, images, or media attached by the user.
    attachments: Annotation<any[]>({
        reducer: (x, y) => (y && y.length > 0 ? [...x, ...y] : x),
        default: () => [],
    }),

    // Accumulated textual context to inject into the system prompt (e.g. from Tool calls).
    contextInfo: Annotation<string>({
        reducer: (x, y) => (y ? x + "\n\n" + y : x),
        default: () => "",
    }),

    // Identified or extracted data for pill images (set by Vision Preprocessor).
    pillData: Annotation<any>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),

    // Current session ID for DB persistence.
    sessionId: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // Used by the Router to determine the next destination node in the graph.
    nextNode: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "generator", // Default fallback
    }),

    // The selected language model to be used by the generator node
    model: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => DEFAULT_CHAT_MODEL,
    }),

    // The client's local timezone to display the correct time.
    timeZone: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "Asia/Seoul",
    }),

    // Determines which set of tools to bind and which prompt sections to inject
    intent: Annotation<IntentType>({
        reducer: (x, y) => y ?? x,
        default: () => "general",
    }),

    // Grounding sources extracted from the Google Search response (populated by generator node).
    groundingSources: Annotation<any[]>({
        reducer: (x, y) => (y && y.length > 0 ? y : x),
        default: () => [],
    }),

    // Whether the current general-intent request needs Google Search grounding.
    // Set by the router (rule + lite LLM); read by the generator's search gate.
    // 기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (6-4)
    // reducer는 반드시 `?? `를 사용 — boolean이라 `||`를 쓰면 false가 default(true)로 덮인다.
    // default는 on(true) — 회색지대/판정 누락 시 검색누락 방어를 우선 (기획 9 안전판).
    needsSearch: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => true,
    })
});

export type AgentStateType = typeof GraphState.State;
