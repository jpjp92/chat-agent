import { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

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
    })
});

export type AgentStateType = typeof GraphState.State;
