import { StateGraph, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { GraphState, AgentStateType } from "./state.js";
import { routerNode } from "./nodes/router.js";
import { visionNode } from "./nodes/vision.js";
import { createGeneratorNode } from "./nodes/generator.js";
import { identifyPillTool } from "./tools.js";

/**
 * Compiles the LangGraph StateGraph instance.
 * Sets up edges, conditional routing, and binding the executable tools.
 */
export const compileAgentGraph = (systemInstruction: string, isYoutubeRequest: boolean) => {

    // 1. Initialize Nodes
    const generator = createGeneratorNode(systemInstruction, isYoutubeRequest);
    const toolNode = new ToolNode([identifyPillTool]);

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
