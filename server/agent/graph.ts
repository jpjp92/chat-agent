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
import { worldCupTool } from "./worldcup-tool";
import { weatherTool } from "./weather-tool";
import { arxivTool } from "./arxiv-tool";
import { paperTool } from "./paper-tool";

/**
 * Compiles the LangGraph StateGraph instance.
 * Sets up edges, conditional routing, and binding the executable tools.
 */
export const compileAgentGraph = (systemInstruction: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void, langName: LangName = DEFAULT_LANG_NAME) => {

    // langName: 렌더러 스펙(의도별 주입) 중 [WEATHER FORMATTING]이 언어별이라 generator까지 전달한다.
    const generator = createGeneratorNode(systemInstruction, isYoutubeRequest, sendEvent, langName);
    const toolNode = new ToolNode([identifyPillTool, searchDrugInfoTool, searchWebTool, pharmacyTool, hospitalTool, vetTool, lawTool, movieTool, worldCupTool, weatherTool, paperTool, arxivTool]);

    // 2. Define Conditional Routing
    // Evaluates if the generator LLM decided to invoke a tool
    const shouldContinueToTools = (state: AgentStateType) => {
        const messages = state.messages;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage._getType() === 'ai' && (lastMessage as any).tool_calls?.length > 0) {
            return "tools";
        }
        return END;
    };

    // Evaluates where to go after the Router Node detects constraints
    const routePostRouter = (state: AgentStateType) => {
        // drug_id with image → vision preprocessing; all others go directly to generator
        return state.nextNode === "vision" ? "vision" : "generator";
    };

    // 3. Construct Graph
    const workflow = new StateGraph(GraphState)
        .addNode("router", routerNode)
        .addNode("vision", visionNode)
        .addNode("generator", generator)
        .addNode("tools", toolNode)

        // Directed Logic Flow
        .addEdge(START, "router")
        .addConditionalEdges("router", routePostRouter)
        .addEdge("vision", "generator")
        .addConditionalEdges("generator", shouldContinueToTools, {
            tools: "tools",
            __end__: END
        })
        .addEdge("tools", "generator"); // Recursively back to generator to synthesize

    return workflow.compile();
};
