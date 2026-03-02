import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey } from "../../config.js";
import { identifyPillTool } from "../tools.js";
import { SystemMessage } from "@langchain/core/messages";

/**
 * Generator Node
 * Prepares the final System Message with all dynamic context and invokes the multimodal Chat model.
 * Note: Tools execute recursively handled by ToolNode, but generator specifies the bindings.
 */
export const createGeneratorNode = (systemInstructionBase: string, isYoutubeRequest: boolean) => {
    return async (state: AgentStateType) => {
        console.log('[LangGraph] Entering Generator Node');
        const apiKey = getNextApiKey();
        if (!apiKey) throw new Error("No API key available");

        let finalInstruction = systemInstructionBase;

        // Inject Dynamic Contexts
        if (state.webContent) {
            finalInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${state.webContent}`;
        }
        if (state.contextInfo) {
            finalInstruction += `\n\n${state.contextInfo}`;
        }

        // Initialize Gemini with standard configuration
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            apiKey: apiKey,
            temperature: 0.2,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
        });

        // 1. If it's a YouTube request, Google bypasses tools for native integration
        // 2. Otherwise bind the tools we designed (identifyPillTool)
        const llmWithTools = isYoutubeRequest ? llm : llm.bindTools([identifyPillTool]);

        const messages = [
            new SystemMessage(finalInstruction),
            ...state.messages,
        ];

        const response = await llmWithTools.invoke(messages);

        return { messages: [response] };
    };
};
