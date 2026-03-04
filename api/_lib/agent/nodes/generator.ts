import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, API_KEYS } from "../../config.js";
import { identifyPillTool, searchWebTool } from "../tools.js";
import { searchDrugInfoTool } from "../drug-info-tool.js";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * Generator Node
 * Prepares the final System Message with all dynamic context and invokes the multimodal Chat model.
 * For general intents, uses @google/genai SDK directly to capture groundingMetadata which
 * is lost by @langchain/google-genai's response parsing.
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

        // For general queries with Google Search, use @google/genai SDK directly
        // to capture groundingMetadata which is stripped by @langchain/google-genai.
        if (!isYoutubeRequest && state.intent !== "medical") {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = apiKey; // start with the key already chosen above
            let sdkAttempt = 0;
            let sdkSuccess = false;

            while (sdkAttempt < MAX_KEY_RETRIES) {
                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });

                    // Build contents from state messages
                    const sdkContents: any[] = [];
                    for (const msg of state.messages) {
                        if (msg._getType() === 'human') {
                            const contentVal = msg.content;
                            if (Array.isArray(contentVal)) {
                                const textPart = contentVal.find((p: any) => p.type === 'text');
                                sdkContents.push({ role: 'user', parts: [{ text: textPart?.text || '' }] });
                            } else {
                                sdkContents.push({ role: 'user', parts: [{ text: String(contentVal) }] });
                            }
                        } else if (msg._getType() === 'ai') {
                            sdkContents.push({ role: 'model', parts: [{ text: String(msg.content) }] });
                        }
                    }

                    const sdkResponse = await genai.models.generateContent({
                        model: "gemini-2.5-flash",
                        contents: sdkContents,
                        config: {
                            systemInstruction: finalInstruction,
                            tools: [{ googleSearch: {} }],
                            temperature: 0.2,
                            topP: 0.8,
                            topK: 40,
                            maxOutputTokens: 8192,
                        }
                    });

                    // Extract text and grounding
                    const responseText = sdkResponse.text ?? "";
                    const groundingMetadata = sdkResponse.candidates?.[0]?.groundingMetadata;
                    let groundingSources: any[] = [];
                    if (groundingMetadata?.groundingChunks) {
                        groundingSources = groundingMetadata.groundingChunks
                            .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                            .filter(Boolean);
                        console.log(`[LangGraph] Found ${groundingSources.length} grounding sources via @google/genai SDK`);
                    } else {
                        console.log('[LangGraph] No groundingMetadata in SDK response');
                    }

                    sdkSuccess = true;
                    const aiMsg = new AIMessage(responseText);
                    return { messages: [aiMsg], groundingSources };

                } catch (err: any) {
                    const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
                    if (isRateLimit) {
                        markKeyRateLimited(sdkApiKey);
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.log(`[LangGraph] Retrying SDK call with next key (attempt ${sdkAttempt + 1})`);
                            continue;
                        }
                    }
                    // Non-rate-limit error or no more keys: fall through to LangChain
                    if (!sdkSuccess) {
                        console.error('[LangGraph] SDK call failed (non-rate-limit), falling back to LangChain:', err?.message || err);
                    }
                    break;
                }
            }
        }

        // Fallback path: LangChain (for medical intent, YouTube, or SDK failure)
        let lcApiKey = apiKey;
        let lcAttempt = 0;

        while (lcAttempt < API_KEYS.length) {
            try {
                const llm = new ChatGoogleGenerativeAI({
                    model: "gemini-2.5-flash",
                    apiKey: lcApiKey,
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 8192,
                });

                let allTools: any[] = [];
                if (state.intent === "medical") {
                    allTools = [searchDrugInfoTool, identifyPillTool, searchWebTool];
                }

                const llmWithTools = (isYoutubeRequest || allTools.length === 0) ? llm : llm.bindTools(allTools);

                const messages = [
                    new SystemMessage(finalInstruction),
                    ...state.messages,
                ];

                const response = await llmWithTools.invoke(messages);
                return { messages: [response] };

            } catch (err: any) {
                const isRateLimit = err?.status === 429 || err?.statusText === 'Too Many Requests';
                if (isRateLimit) {
                    markKeyRateLimited(lcApiKey);
                    const nextKey = getNextApiKey();
                    if (nextKey && nextKey !== lcApiKey) {
                        lcApiKey = nextKey;
                        lcAttempt++;
                        console.log(`[LangGraph] LangChain 429: retrying with next key (attempt ${lcAttempt + 1})`);
                        continue;
                    }
                }
                throw err; // Re-throw non-rate-limit errors
            }
        }

        throw new Error('[LangGraph] All API keys exhausted for LangChain path.');
    };
};
