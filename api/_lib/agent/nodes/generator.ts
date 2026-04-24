import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyInvalid, API_KEYS } from "../../config.js";
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
export const createGeneratorNode = (systemInstructionBase: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void) => {
    return async (state: AgentStateType) => {
        console.log('[LangGraph] Entering Generator Node');
        const apiKey = getNextApiKey();
        console.log('[LangGraph] API key available:', !!apiKey, '| intent:', state.intent, '| model:', state.model);
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

        const resolvedModel = state.model || "gemini-2.5-flash";

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        let sdkSuccess = false; // declared outside if-block so LangChain fallback check at line ~277 can read it
        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = apiKey; // start with the key already chosen above
            let sdkAttempt = 0;
            // When multimodal content (YouTube fileData, PDF URL) causes a 500,
            // retry once without media parts + Google Search enabled.
            let forceTextOnly = false;

            while (sdkAttempt < MAX_KEY_RETRIES) {
                // Declare outside try so catch block can read them for duplicate-guard
                let responseText = "";
                let groundingSources: any[] = [];
                // Track whether this attempt included multimodal parts (readable in catch)
                let hadMultimodalContent = false;

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
                                        if (forceTextOnly) continue; // skip media on retry
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
                                            hadMultimodalContent = true;
                                        } else if (url.startsWith('http')) {
                                            // Public URL: pass directly as fileData (Gemini SDK supports public URLs natively)
                                            // Fetching and re-encoding to base64 is unnecessary and adds 2~5s latency
                                            const urlLower = url.toLowerCase();
                                            const mimeTypeHint = urlLower.includes('.png') ? 'image/png'
                                                : urlLower.includes('.webp') ? 'image/webp'
                                                : urlLower.includes('.gif') ? 'image/gif'
                                                : urlLower.includes('.pdf') || urlLower.includes('/pdf/') ? 'application/pdf'
                                                : 'image/jpeg';
                                            parts.push({ fileData: { fileUri: url, mimeType: mimeTypeHint } });
                                            hasMultimodalContent = true;
                                            hadMultimodalContent = true;
                                        }
                                    } else if (part.fileData?.fileUri) {
                                        if (forceTextOnly) continue; // skip media on retry
                                        // Native fileData (YouTube video URI) - supported natively by SDK
                                        parts.push({ fileData: { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType } });
                                        hasMultimodalContent = true;
                                        hadMultimodalContent = true;
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
                    const hasTranscript = state.webContent.includes('[TRANSCRIPT]');
                    const hasVideoData = state.messages.some((m: any) =>
                        Array.isArray(m.content) && m.content.some((p: any) => p.fileData)
                    );

                    // Disable Google Search when image exists anywhere in conversation history.
                    // Gemini API does not support Google Search + image in the same request.
                    // Without this, follow-up turns (e.g. "표로 정리해줘") after an image analysis
                    // would enable Google Search (no image in *current* turn), causing the model
                    // to ignore the image history and return sparse, search-based responses.
                    const historyHasImage = state.messages.some((m: any) =>
                        Array.isArray(m.content) && m.content.some((p: any) =>
                            p.inlineData || (p.fileData && !p.fileData.fileUri?.includes('youtube'))
                        )
                    );

                    // Disable Google Search when the full article text is already provided
                    // to prevent the LLM from using a brief Google snippet instead of the full content.
                    // Only disable if there's actual non-empty content after the tag.
                    const urlContentMatch = state.webContent.match(/\[URL_CONTENT:[^\]]+\]\n([\s\S]+)/);
                    // 300자 미만이면 JS 렌더링 실패로 간주 → Google Search fallback 허용
                    const hasUrlContent = !!(urlContentMatch && urlContentMatch[1].trim().length >= 300);

                    let useGoogleSearch = !hasMultimodalContent && !historyHasImage;
                    if (isYoutubeRequest && (hasTranscript || hasVideoData)) {
                        useGoogleSearch = false;
                    }
                    if (hasUrlContent) {
                        useGoogleSearch = false;
                    }

                    if ((hasMultimodalContent || historyHasImage) && !isYoutubeRequest) {
                        console.log('[LangGraph] Image in conversation — Google Search disabled', { hasMultimodalContent, historyHasImage });
                    }
                    if (hasUrlContent) {
                        console.log('[LangGraph] URL content provided — Google Search disabled to use full article text');
                    }

                    console.log('[LangGraph] Starting SDK stream | model:', resolvedModel, '| useGoogleSearch:', useGoogleSearch, '| contentsLen:', sdkContents.length);
                    // Streaming SDK call — emits chunks to client in real-time
                    const sdkStream = await genai.models.generateContentStream({
                        model: resolvedModel,
                        contents: sdkContents,
                        config: {
                            systemInstruction: finalInstruction,
                            tools: useGoogleSearch ? [{ googleSearch: {} }] : undefined,
                            temperature: 0.2,
                            topP: 0.8,
                            topK: 40,
                            maxOutputTokens: 32768,
                        }
                    });

                    let chunkCount = 0;

                    for await (const chunk of sdkStream) {
                        chunkCount++;
                        const candidate = chunk.candidates?.[0];
                        const finishReason = candidate?.finishReason;
                        if (finishReason === 'MAX_TOKENS') {
                            console.warn('[LangGraph] Response truncated — MAX_TOKENS reached (responseLen so far:', responseText.length, ')');
                        }
                        if (finishReason && finishReason !== 'STOP') {
                            console.warn('[LangGraph] Non-STOP finishReason:', finishReason, JSON.stringify(candidate?.safetyRatings));
                        }
                        let chunkText = "";
                        try { chunkText = chunk.text ?? ""; } catch (e: any) {
                            console.warn('[LangGraph] chunk.text threw:', e?.message);
                        }
                        if (!chunkText && candidate?.content?.parts) {
                            chunkText = candidate.content.parts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || "").join("");
                        }
                        if (chunkText) {
                            let sanitized = chunkText.replace(/(.)\1{49,}/g, '$1$1$1');
                            // Strip grounding inline citations before sending — sources are shown as chips
                            sanitized = sanitized.replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
                            if (sanitized.trim()) {
                                responseText += sanitized;
                                if (sendEvent) sendEvent({ text: sanitized });
                            }
                        }
                        // Grounding metadata arrives on final chunk
                        const gm = chunk.candidates?.[0]?.groundingMetadata;
                        if (gm?.groundingChunks) {
                            groundingSources = gm.groundingChunks
                                .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                .filter(Boolean);
                        }
                    }

                    console.log('[LangGraph] SDK stream done | chunkCount:', chunkCount, '| responseLen:', responseText.length, '| sources:', groundingSources.length);

                    // Fallback: if streaming returned no text (e.g. vercel dev proxy buffers SSE chunks),
                    // retry with non-streaming generateContent. First try with Google Search off
                    // (grounding can alter response structure), then with it on.
                    if (!responseText) {
                        console.log('[LangGraph] Stream empty (chunkCount:', chunkCount, ') — falling back to generateContent');
                        for (const fbUseSearch of (useGoogleSearch ? [false, true] : [false])) {
                            const fallbackResponse = await genai.models.generateContent({
                                model: resolvedModel,
                                contents: sdkContents,
                                config: {
                                    systemInstruction: finalInstruction,
                                    tools: fbUseSearch ? [{ googleSearch: {} }] : undefined,
                                    temperature: 0.2,
                                    topP: 0.8,
                                    topK: 40,
                                    maxOutputTokens: 32768,
                                }
                            });
                            // Extract text from parts directly to handle thought-only or grounding responses
                            const fbParts = fallbackResponse.candidates?.[0]?.content?.parts ?? [];
                            responseText = (fallbackResponse.text ?? fbParts.filter((p: any) => !p.thought).map((p: any) => p.text || "").join("")).trim();
                            const fbGrounding = fallbackResponse.candidates?.[0]?.groundingMetadata;
                            if (fbGrounding?.groundingChunks) {
                                groundingSources = fbGrounding.groundingChunks
                                    .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                    .filter(Boolean);
                            }
                            console.log('[LangGraph] Fallback generateContent | search:', fbUseSearch, '| responseLen:', responseText.length);
                            if (responseText) {
                                // Strip grounding inline citations before sending — sources are shown as chips
                                responseText = responseText.replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '');
                                if (sendEvent) sendEvent({ text: responseText });
                                break;
                            }
                        }
                    }

                    if (groundingSources.length > 0) {
                        console.log(`[LangGraph] Found ${groundingSources.length} grounding sources`);
                    }

                    sdkSuccess = true;
                    const aiMsg = new AIMessage(responseText);
                    return { messages: [aiMsg], groundingSources };

                } catch (err: any) {
                    // If text was already streamed to the client, do NOT retry — would cause duplicate output
                    if (responseText) {
                        console.warn('[LangGraph] Error after partial stream (err:', err?.status, ') — returning partial response to avoid duplication');
                        sdkSuccess = true;
                        return { messages: [new AIMessage(responseText)], groundingSources };
                    }
                    const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
                    const isUnavailable = err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('UNAVAILABLE');
                    const isAuth = err?.status === 401 || err?.status === 403;
                    if (isAuth) {
                        markKeyInvalid(sdkApiKey);
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.warn(`[LangGraph] SDK 401/403: retrying with next key (attempt ${sdkAttempt + 1})`);
                            continue;
                        }
                    } else if (isRateLimit || isUnavailable) {
                        if (isRateLimit) markKeyRateLimited(sdkApiKey);
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.log(`[LangGraph] Retrying SDK call with next key (attempt ${sdkAttempt + 1}) reason:`, isRateLimit ? '429' : '503');
                            continue;
                        }
                    } else if (err?.status === 500 && hadMultimodalContent && !forceTextOnly) {
                        // Multimodal 500: video/image inaccessible or transient server error.
                        // Retry once without media parts — Google Search will auto-enable (hasMultimodalContent=false).
                        forceTextOnly = true;
                        sdkAttempt++;
                        console.warn('[LangGraph] SDK 500 on multimodal — retrying text-only with Google Search enabled');
                        continue;
                    }
                    // Non-retryable error or no more keys
                    console.error('[LangGraph] SDK call failed:', err?.status, err?.message || err);
                    break;
                }
            }
        }

        // LangChain path: drug_id and drug_info intents need custom DB/identification tools.
        // Note: for non-drug intents, this path acts as an unstreamed fallback when SDK fully fails.
        if (!useLangChain && !sdkSuccess) {
            console.error('[LangGraph] SDK path failed for intent:', state.intent, '— falling back to LangChain (no streaming)');
        }
        let lcApiKey = getNextApiKey() ?? apiKey;
        let lcAttempt = 0;

        while (lcAttempt < API_KEYS.length) {
            try {
                const llm = new ChatGoogleGenerativeAI({
                    model: resolvedModel,
                    apiKey: lcApiKey,
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 32768,
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
                // Failed to parse stream: transient Gemini API error — retry with next key
                const isStreamError = typeof err?.message === 'string' && (
                    err.message.includes('Failed to parse stream') ||
                    err.message.includes('INTERNAL') ||
                    err.message.includes('503')
                );
                if (isRateLimit || isStreamError) {
                    if (isRateLimit) markKeyRateLimited(lcApiKey);
                    const nextKey = getNextApiKey();
                    if (nextKey && nextKey !== lcApiKey) {
                        lcApiKey = nextKey;
                        lcAttempt++;
                        console.log(`[LangGraph] LangChain retry (attempt ${lcAttempt + 1}) reason:`, isRateLimit ? '429' : 'stream-error', err?.message?.slice(0, 80));
                        continue;
                    }
                }
                const isAuth = err?.status === 401 || err?.status === 403;
                if (isAuth) markKeyInvalid(lcApiKey);
                console.error('[LangGraph] LangChain path fatal error:', err?.status, err?.message?.slice(0, 120));
                throw err;
            }
        }

        throw new Error('[LangGraph] All API keys exhausted for LangChain path.');
    };
};
