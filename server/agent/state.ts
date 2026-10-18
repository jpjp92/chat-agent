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
    | "law_qa"        // 국가법령정보를 근거로 설명·시나리오 해설
    | "movie_search"  // 영화 상영시간표 (CGV/롯데/메가박스)
    | "weather"       // 날씨 카드 (KMA + OpenWeather 하이브리드)
    | "paper_search"  // 의학·생명과학 논문 근거 조회 (PubMed)
    | "arxiv_search"  // 물리·수학·전산·공학·계량경제 논문 조회 (arXiv). 라우터가 paper_source 에서 파생시킨다
    | "general";     // 나머지 모든 것

/**
 * LangGraph.js AgentState 정의
 * 대화 기록·사용자 첨부·추출 결과·라우팅 흐름을 담는다.
 */
export const GraphState = Annotation.Root({
    // 사용자 입력·AI 응답·Tool 메시지를 포함한 대화 기록.
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // 프론트엔드가 업로드 문서/웹 페이지에서 추출한 텍스트.
    webContent: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // 현재 화면에 표시된 영화 상영표 요약(클라이언트 전달). 멀티턴 후속 질문 답변용.
    movieContext: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // 화면에 떠 있는 카드 종류(클라이언트 판정). 서버가 받는 히스토리는 최근 10개로 잘려 있어
    // 카드가 그 창 밖으로 밀리면 후속 판정이 꺼진다 — 전체 히스토리를 가진 클라가 알려준다.
    // 구버전 클라(미전송)면 라우터의 창 내 스캔으로 폴백한다.
    activeCards: Annotation<{ weather?: boolean; paper?: boolean; pharmacy?: boolean; hospital?: boolean; vet?: boolean; law?: boolean; latest?: "pharmacy" | "hospital" | "vet" | "law" }>({
        reducer: (x, y) => y ?? x,
        default: () => ({}),
    }),

    // 클라이언트가 최근 전체 대화에서 추출한 카드 원문. 서버 히스토리 절단 이후에도
    // 위치·법률 카드 후속 질문을 조회 재실행 없이 정확히 답하는 근거로 사용한다.
    cardContexts: Annotation<Partial<Record<"pharmacy" | "hospital" | "vet" | "law", string>>>({
        reducer: (x, y) => y ?? x,
        default: () => ({}),
    }),

    cardFollowup: Annotation<"" | "pharmacy" | "hospital" | "vet" | "law">({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // 이번 턴이 영화 카드에 대한 후속 질문인지(라우터 판정). generator의 movieContext 주입 게이트.
    movieFollowup: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),
    /**
     * 이번 턴이 영화 카드 위에서 **웹 검색으로** 답하는 턴인가(줄거리·평점 등 상영표에 없는 정보).
     * 검색 턴에도 화면 상영작을 넘겨야 한다 — `movieFollowup` 만 보면 검색 턴엔 상영작이 빠져 모델이
     * 화면과 모순되는 답(상영 중인 영화를 "찾기 어렵다")을 한다 → DEV_260831
     */
    movieSearchTurn: Annotation<boolean>({
        reducer: (_prev, next) => next,
        default: () => false,
    }),

    // 이번 턴이 직전 답변의 **재구성 요청**인지(라우터 follow_up === "refine").
    // "표로 정리해줘"·"요약해줘"·"비교해줘" 같은 턴은 툴도 검색도 없이 도는 경우가 많아,
    // 모델이 추가한 항목을 검증할 장치가 없다 — generator 가 이 턴에 재구성 규칙을 붙이도록 state 로 넘긴다
    // → DEV_260815_DEPLOY_CHECK
    reformatTurn: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),

    // 이번 턴이 "화면에 떠 있는 날씨 카드"에 대한 후속 대화인지(라우터 판정).
    // generator가 카드 재생성·표 재출력 금지 지시를 주입하는 게이트.
    weatherFollowup: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),

    // 이번 턴이 "화면에 떠 있는 논문 카드"에 대한 후속 대화인지(라우터 판정).
    // generator 가 근거 고정 규칙을 붙이도록 state 로 넘긴다 — 없으면 초록에 없는 연구 결과가 사실처럼
    // 나간다 → DEV_260830 §6.22
    paperFollowup: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),

    // 사용자가 첨부한 파일·이미지·미디어.
    attachments: Annotation<any[]>({
        reducer: (x, y) => (y && y.length > 0 ? [...x, ...y] : x),
        default: () => [],
    }),

    // 시스템 프롬프트에 넣을 누적 문맥 (예: 도구 호출 결과).
    contextInfo: Annotation<string>({
        reducer: (x, y) => (y ? x + "\n\n" + y : x),
        default: () => "",
    }),

    // 약 이미지에서 식별·추출한 데이터 (Vision 전처리기가 설정).
    pillData: Annotation<any>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),

    // DB 저장용 현재 세션 ID.
    sessionId: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // Router 가 그래프의 다음 노드를 정할 때 쓴다.
    nextNode: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "generator", // 기본 폴백
    }),

    // generator 노드가 쓸 선택 모델
    model: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => DEFAULT_CHAT_MODEL,
    }),

    // 올바른 시각을 보여주기 위한 클라이언트 현지 시간대.
    timeZone: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "Asia/Seoul",
    }),

    // 바인딩할 도구 묶음과 주입할 프롬프트 섹션을 정한다
    intent: Annotation<IntentType>({
        reducer: (x, y) => y ?? x,
        default: () => "general",
    }),

    // Google Search 응답에서 추출한 grounding 출처 (generator 노드가 채움).
    groundingSources: Annotation<any[]>({
        reducer: (x, y) => (y && y.length > 0 ? y : x),
        default: () => [],
    }),

    // 이번 general 인텐트 요청이 Google Search grounding 이 필요한지.
    // router(규칙 + lite LLM)가 설정하고 generator 의 검색 게이트가 읽는다.
    // 기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (6-4)
    // reducer는 반드시 `?? `를 사용 — boolean이라 `||`를 쓰면 false가 default(true)로 덮인다.
    // default는 on(true) — 회색지대/판정 누락 시 검색누락 방어를 우선 (기획 9 안전판).
    needsSearch: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => true,
    }),

    // 직전 턴에 실제로 검색이 일어났는지 (history의 grounding 출처로 판정 — history.ts).
    // search-gate의 멀티턴 가드가 쓴다. undefined면 판단 불가 → 게이트가 기존 정규식 근사로 폴백.
    // 기획: docs/plans/PLAN_SEARCH_POLICY_260815.md §3 (Step 6)
    lastTurnSearched: Annotation<boolean | undefined>({
        reducer: (x, y) => y ?? x,
        default: () => undefined,
    }),
    // 직전 턴 출처 이름표(제목) — 근거 규칙(grounded-history-rules.ts)에 싣는다. DEV_261013.
    lastTurnSourceLabels: Annotation<string[]>({
        reducer: (x, y) => y ?? x,
        default: () => [],
    })
});

export type AgentStateType = typeof GraphState.State;
