import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, API_KEYS } from "../../config.js";
import { identifyPillTool, searchWebTool } from "../tools.js";
import { searchDrugInfoTool } from "../drug-info-tool.js";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { getIntentFocusHint } from "../prompt.js";

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

        // Inject Current Date/Time to prevent hallucination
        const now = new Date();
        const tz = state.timeZone || 'Asia/Seoul';
        const currentDateStr = new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
            hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short'
        }).format(now);
        finalInstruction = `[CURRENT_SYSTEM_TIME (Timezone: ${tz}): ${currentDateStr}]\n\n` + finalInstruction;

        // Inject Dynamic Contexts
        if (state.webContent) {
            finalInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${state.webContent}`;
        }
        if (state.contextInfo) {
            finalInstruction += `\n\n${state.contextInfo}`;
        }

        // Inject intent-specific focus hint to guide renderer selection
        const intentHint = getIntentFocusHint(state.intent);
        if (intentHint) {
            finalInstruction += `\n\n${intentHint}`;
        }

        // Intent routing:
        // LangChain path — intents that need custom tools (drug_id, drug_info)
        // SDK path — all other intents (Google Search grounding available)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info"];
        const useLangChain = LANGCHAIN_INTENTS.includes(state.intent);

        // Model selection: data_viz can use lighter model; others use state.model
        const MODEL_OVERRIDES: Partial<Record<string, string>> = {
            data_viz: "gemini-2.5-flash-lite",
        };
        const resolvedModel = MODEL_OVERRIDES[state.intent] ?? (state.model || "gemini-2.5-flash");

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = apiKey; // start with the key already chosen above
            let sdkAttempt = 0;
            let sdkSuccess = false;

            while (sdkAttempt < MAX_KEY_RETRIES) {
                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });

                    // Build contents from state messages
                    // Correctly maps all multimodal parts (text, image, pdf, video/YouTube) to SDK format
                    const sdkContents: any[] = [];
                    let hasMultimodalContent = false; // track if any non-text parts exist

                    for (const msg of state.messages) {
                        if (msg._getType() === 'human') {
                            const contentVal = msg.content;
                            if (Array.isArray(contentVal)) {
                                const parts: any[] = [];
                                for (const part of contentVal as any[]) {
                                    if (part.type === 'text') {
                                        parts.push({ text: part.text || '' });
                                    } else if (part.type === 'image_url' && part.image_url?.url) {
                                        const url: string = part.image_url.url;
                                        if (url.startsWith('data:')) {
                                            // base64 inline data URI (e.g. data:image/jpeg;base64,...)
                                            let b64data = url;
                                            let mimeType = 'application/octet-stream';
                                            if (url.includes('base64,')) {
                                                const partsArray = url.split('base64,');
                                                b64data = partsArray[1];
                                                mimeType = url.split(':')[1].split(';')[0];
                                            }
                                            parts.push({ inlineData: { mimeType, data: b64data } });
                                            hasMultimodalContent = true;
                                        } else if (url.startsWith('http')) {
                                            // Public URL: fetch and convert to inline base64
                                            try {
                                                const fetchRes = await fetch(url);
                                                if (fetchRes.ok) {
                                                    const contentType = fetchRes.headers.get('content-type') || 'image/jpeg';
                                                    const mimeType = contentType.split(';')[0];
                                                    const arrayBuffer = await fetchRes.arrayBuffer();
                                                    const b64 = Buffer.from(arrayBuffer).toString('base64');
                                                    parts.push({ inlineData: { mimeType, data: b64 } });
                                                    hasMultimodalContent = true;
                                                }
                                            } catch (fetchErr) {
                                                console.warn('[LangGraph] Failed to fetch image URL for SDK:', fetchErr);
                                            }
                                        }
                                    } else if (part.fileData?.fileUri) {
                                        // Native fileData (YouTube video URI) - supported natively by SDK
                                        parts.push({ fileData: { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType } });
                                        hasMultimodalContent = true;
                                    }
                                }
                                if (parts.length === 0) parts.push({ text: '' });
                                sdkContents.push({ role: 'user', parts });
                            } else {
                                sdkContents.push({ role: 'user', parts: [{ text: String(contentVal) }] });
                            }
                        } else if (msg._getType() === 'ai') {
                            sdkContents.push({ role: 'model', parts: [{ text: String(msg.content) }] });
                        }
                    }

                    // Google Search is incompatible with multimodal content (images, video, PDF)
                    // Optimization: Disable Google Search for YouTube summaries when transcript OR video data is present
                    const hasTranscript = state.webContent.includes('[YOUTUBE_VIDEO_INFO]');
                    const hasVideoData = state.messages.some((m: any) => 
                        Array.isArray(m.content) && m.content.some((p: any) => p.fileData)
                    );
                    
                    let useGoogleSearch = !hasMultimodalContent;
                    if (isYoutubeRequest && (hasTranscript || hasVideoData)) {
                        useGoogleSearch = false;
                    }
                    
                    if (hasMultimodalContent && !isYoutubeRequest) {
                        console.log('[LangGraph] Multimodal content detected — Google Search disabled');
                    }

                    const sdkResponse = await genai.models.generateContent({
                        model: resolvedModel,
                        contents: sdkContents,
                        config: {
                            systemInstruction: finalInstruction,
                            tools: useGoogleSearch ? [{ googleSearch: {} }] : undefined,
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

        // LangChain path: drug_id and drug_info intents need custom DB/identification tools.
        // Note: YouTube and general multimodal requests are handled exclusively in the SDK path above.
        let lcApiKey = apiKey;
        let lcAttempt = 0;

        while (lcAttempt < API_KEYS.length) {
            try {
                const llm = new ChatGoogleGenerativeAI({
                    model: resolvedModel,
                    apiKey: lcApiKey,
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 8192,
                });

                let allTools: any[] = [];
                if (state.intent === "drug_id") {
                    allTools = [identifyPillTool, searchWebTool];
                } else if (state.intent === "drug_info") {
                    allTools = [searchDrugInfoTool, searchWebTool];
                }

                const llmWithTools = allTools.length === 0 ? llm : llm.bindTools(allTools);

                // LangChain does not support fileData content parts — strip them for compatibility.
                // Medical intent images are pre-processed by the vision node (text extracted),
                // so filtering fileData here is safe.
                const safeMessages = state.messages.map((msg: any) => {
                    if (msg._getType() === 'human' && Array.isArray(msg.content)) {
                        const safeParts = (msg.content as any[]).filter((p: any) =>
                            p.type === 'text' || p.type === 'image_url'
                        );
                        if (safeParts.length === msg.content.length) return msg;
                        return new HumanMessage({ content: safeParts.length > 0 ? safeParts : [{ type: 'text', text: '' }] });
                    }
                    return msg;
                });

                const messages = [
                    new SystemMessage(finalInstruction),
                    ...safeMessages,
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
