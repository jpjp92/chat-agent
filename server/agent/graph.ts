import { type LangName, DEFAULT_LANG_NAME } from './lang';
import 'server-only';
import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { GraphState, AgentStateType } from "./state";
import { routerNode } from "./nodes/router";
import { visionNode } from "./nodes/vision";
import { createGeneratorNode } from "./nodes/generator";
import { identifyPillTool, searchWebTool } from "./tools";
import { searchDrugInfoTool } from "./drug-info-tool";
import { pharmacyTool } from "./pharmacy-tool";
import { hospitalTool } from "./hospital-tool";
import { vetTool } from "./vet-tool";
import { lawTool } from "./law-tool";
import { movieTool } from "./movie-tool";
import { weatherTool } from "./weather-tool";
import { arxivTool } from "./arxiv-tool";
import { paperTool } from "./paper-tool";

/**
 * LangGraph StateGraph 인스턴스를 컴파일한다.
 * 엣지·조건부 라우팅을 설정하고 실행 도구를 연결한다.
 */
export const compileAgentGraph = (
    systemInstruction: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void,
    langName: LangName = DEFAULT_LANG_NAME,
    /** 9단계 A/B 전용 — 프로덕션(`route.ts`)은 넘기지 않는다. 판정 후 제거(PLAN §10-11). */
    experiment: { timeBlockAt?: 'start' | 'end' | 'both' } = {},
) => {

    // langName: 렌더러 스펙(의도별 주입) 중 [WEATHER FORMATTING]이 언어별이라 generator까지 전달한다.
    const generator = createGeneratorNode(systemInstruction, isYoutubeRequest, sendEvent, langName, experiment);
    const toolNode = new ToolNode([identifyPillTool, searchDrugInfoTool, searchWebTool, pharmacyTool, hospitalTool, vetTool, lawTool, movieTool, weatherTool, paperTool, arxivTool]);

    // 2. 조건부 라우팅 정의
    // generator LLM 이 도구 호출을 결정했는지 판단
    const shouldContinueToTools = (state: AgentStateType) => {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage._getType() === 'ai' && (lastMessage as any).tool_calls?.length > 0) {
            return "tools";
        }
        return END;
    };

    // Router 노드 판정 후 어디로 갈지 결정
    const routePostRouter = (state: AgentStateType) => {
        // 이미지 있는 drug_id → vision 전처리, 나머지는 바로 generator
        return state.nextNode === "vision" ? "vision" : "generator";
    };

    // 3. 그래프 구성
    const workflow = new StateGraph(GraphState)
        .addNode("router", routerNode)
        .addNode("vision", visionNode)
        .addNode("generator", generator)
        .addNode("tools", toolNode)

        // 흐름
        .addEdge(START, "router")
        .addConditionalEdges("router", routePostRouter)
        .addEdge("vision", "generator")
        .addConditionalEdges("generator", shouldContinueToTools, {
            tools: "tools",
            __end__: END
        })
        .addEdge("tools", "generator"); // 다시 generator 로 돌아가 결과를 종합

    return workflow.compile();
};
