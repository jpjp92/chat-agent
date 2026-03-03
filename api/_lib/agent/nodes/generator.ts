import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey } from "../../config.js";
import { identifyPillTool, searchWebTool } from "../tools.js";
import { searchDrugInfoTool } from "../drug-info-tool.js";
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

        // Bind tools to the LLM:
        // - searchDrugInfoTool: For drug name text queries → look up MFDS official DB first
        // - identifyPillTool: For pill image queries → search pharm.or.kr with vision-extracted attributes
        // - searchWebTool: Optional. Use for missing drug usage (용법) and dosage info not provided by standard drug databases.
        // - YouTube requests: No custom tools needed (Gemini handles natively via fileUri)
        const allTools = [searchDrugInfoTool, identifyPillTool, searchWebTool];
        const llmWithTools = isYoutubeRequest ? llm : llm.bindTools(allTools);

        const messages = [
            new SystemMessage(finalInstruction),
            ...state.messages,
        ];

        const response = await llmWithTools.invoke(messages);

        return { messages: [response] };
    };
};
