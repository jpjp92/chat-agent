import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError, API_KEYS } from "../../config.js";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS } from "../../models.js";
import { identifyPillTool, searchWebTool } from "../tools.js";
import { searchDrugInfoTool } from "../drug-info-tool.js";
import { pharmacyTool } from "../pharmacy-tool.js";
import { hospitalTool } from "../hospital-tool.js";
import { vetTool } from "../vet-tool.js";
import { lawTool } from "../law-tool.js";
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

        const extractTextContent = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content
                    .map((part: any) => part?.type === 'text' ? part.text || '' : '')
                    .join('\n');
            }
            return '';
        };

        const latestUserText = (() => {
            const lastHuman = [...state.messages].reverse().find(msg => msg._getType() === 'human');
            return lastHuman ? extractTextContent(lastHuman.content) : '';
        })();

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
        // LangChain path — intents that need custom tools (drug_id, drug_info, pharmacy_search)
        // SDK path — all other intents (Google Search grounding available)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search"];
        const useLangChain = LANGCHAIN_INTENTS.includes(state.intent);

        const resolvedModel = state.model || DEFAULT_CHAT_MODEL;

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        // NOTE: gemini-3.5-flash supports Google Search grounding, but it is not available
        // on the free tier. When 3.5 Flash is selected and grounding is needed, fall back
        // to 2.5 Flash for the grounded response.
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        const needsSearchFallback = resolvedModel === SERVER_MODELS.FLASH_3_5;
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
                let stage1FallbackText = "";
                // Track whether this attempt included multimodal parts (readable in catch)
                let hadMultimodalContent = false;

                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });

                    // Build contents from state messages
                    // Correctly maps all multimodal parts (text, image, pdf, video/YouTube) to SDK format
                    const sdkContents: any[] = [];
                    let hasMultimodalContent = false; // track if any non-text parts exist
                    let hasDocumentContent = false;  // track if PDF/doc (not pure image)

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
                                            if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) hasDocumentContent = true;
                                        } else if (url.startsWith('http')) {
                                            // Public URL: pass directly as fileData (Gemini SDK supports public URLs natively)
                                            // Fetching and re-encoding to base64 is unnecessary and adds 2~5s latency
                                            const urlLower = url.toLowerCase();
                                            const mimeTypeHint = urlLower.includes('.png') ? 'image/png'
                                                : urlLower.includes('.webp') ? 'image/webp'
                                                : urlLower.includes('.gif') ? 'image/gif'
                                                : urlLower.includes('.pdf') || urlLower.includes('/pdf/') || urlLower.includes('chat-docs') ? 'application/pdf'
                                                : 'image/jpeg';
                                            parts.push({ fileData: { fileUri: url, mimeType: mimeTypeHint } });
                                            hasMultimodalContent = true;
                                            hadMultimodalContent = true;
                                            if (mimeTypeHint === 'application/pdf') hasDocumentContent = true;
                                        }
                                    } else if (part.fileData?.fileUri) {
                                        if (forceTextOnly) continue; // skip media on retry
                                        // Native fileData (YouTube video URI or PDF) - supported natively by SDK
                                        parts.push({ fileData: { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType } });
                                        hasMultimodalContent = true;
                                        hadMultimodalContent = true;
                                        if (part.fileData.mimeType === 'application/pdf') hasDocumentContent = true;
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

                    // URL_CONTENT 태그 존재 여부로 Google Search 비활성 여부를 결정.
                    // 이전에는 내용 길이 >= 300 조건을 사용했으나, Vercel(해외 IP)에서
                    // 한국 뉴스 사이트(Naver 등)가 짧은 HTML을 반환하면 Google Search가 활성화되어
                    // 전혀 다른 기사를 요약하는 문제가 발생. URL이 제공된 이상 해당 URL 기반으로만 요약해야 함.
                    // [URL_CONTENT:...] 태그 자체가 "URL fetch 시도 완료" 신호이므로 길이 체크 제거.
                    const hasUrlContent = state.webContent.includes('[URL_CONTENT:');

                    let useGoogleSearch = !hasMultimodalContent && !historyHasImage;
                    // 1턴: transcript 또는 native video 있으면 Search 비활성 (영상 자체가 컨텍스트)
                    // 2턴+: VIDEO_ANALYSIS_SUMMARY가 있어도 Search 허용 — 모델이 문맥에 따라 판단
                    if (isYoutubeRequest && (hasTranscript || hasVideoData)) {
                        useGoogleSearch = false;
                    }
                    if (hasUrlContent) {
                        useGoogleSearch = false;
                    }
                    // medical_qa: 이미지 없는 경우 Google Search 강제 활성화
                    // LLM 내부 지식 의존 → 실시간 의학 정보 + 출처 기반 답변으로 개선
                    // (이미지가 있으면 Gemini API 제약상 Search 불가 → hasMultimodalContent/historyHasImage 조건 유지)
                    if (state.intent === 'medical_qa' && !hasMultimodalContent && !historyHasImage) {
                        useGoogleSearch = true;
                    }
                    // Renderer intents should produce structured JSON directly. If Google Search is
                    // left on for 3.5, the two-track path turns the request into Stage1 search notes
                    // followed by Stage2 summary, which can drop the visualization block entirely.
                    const rendererIntents = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);
                    const explicitSearchRequested = /(검색|찾아|조사|출처|근거|최신|최근|실시간|뉴스|latest|recent|search|source|cite)/i.test(latestUserText);
                    if (rendererIntents.has(state.intent) && !explicitSearchRequested) {
                        useGoogleSearch = false;
                    }

                    // Intent-based token budget: short-output paths get reduced limits to fit within Vercel 60s
                    const resolvedMaxTokens = (() => {
                        if (hasDocumentContent) return 16384;               // PDF·문서 분석
                        if (isYoutubeRequest) return 8192;                  // YouTube 요약
                        if (hasMultimodalContent) return 4096;              // 이미지 분석
                        if (hasUrlContent) return 8192;                     // URL 요약
                        if (state.intent === 'data_viz') return 8192;      // 차트 JSON + 설명
                        if (state.intent === 'astronomy') return 8192;     // 별자리 JSON + 설명
                        if (state.intent === 'biology') return 8192;       // PDB 구조 + 설명
                        if (state.intent === 'chemistry') return 8192;     // SMILES + 설명 (grounding 대응)
                        if (state.intent === 'physics') return 8192;       // 다이어그램 JSON + 설명 (grounding 대응)
                        if (state.intent === 'medical_qa') return 8192;    // 의학 Q&A + 출처
                        return 32768;                                        // 코드·일반
                    })();
                    // Google Search grounding이 활성화되면 검색 결과 + 설명이 추가되어 토큰이 더 필요.
                    // 멀티턴에서도 히스토리가 쌓인 상태에서 grounding 응답이 길어질 수 있으므로 최소 8192 보장.
                    const effectiveMaxTokens = (useGoogleSearch && resolvedMaxTokens < 8192) ? 8192 : resolvedMaxTokens;

                    if ((hasMultimodalContent || historyHasImage) && !isYoutubeRequest) {
                        console.log('[LangGraph] Image in conversation — Google Search disabled', { hasMultimodalContent, historyHasImage });
                    }
                    if (hasUrlContent) {
                        console.log('[LangGraph] URL content provided — Google Search disabled to use full article text');
                    }
                    if (rendererIntents.has(state.intent) && !explicitSearchRequested) {
                        console.log('[LangGraph] Renderer intent — Google Search disabled to preserve structured visualization output');
                    }

                    console.log('[LangGraph] Starting SDK stream | model:', resolvedModel, '| useGoogleSearch:', useGoogleSearch, '| maxTokens:', effectiveMaxTokens, '| contentsLen:', sdkContents.length);
                    // gemini-3.5-flash Search grounding is not available on the free tier.
                    // Fall back to 2.5 Flash for grounded calls; non-search calls keep the selected model.
                    const effectiveModel = (useGoogleSearch && needsSearchFallback)
                        ? SEARCH_FALLBACK_MODEL
                        : resolvedModel;
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] 3.5 Flash + Google Search → falling back to', SEARCH_FALLBACK_MODEL, 'for grounding');
                    }

                    // Thinking config — model-aware branching:
                    // 3.5-flash uses thinkingLevel enum (thinkingBudget deprecated):
                    //   - YouTube native video: "minimal" — disable thinking to stay within Vercel 60s
                    //     (video download 30~50s + medium thinking 15~25s → exceeds 60s limit)
                    //   - All other 3.5-flash paths: "low" — prevents 60s timeout on complex queries
                    //     (default "medium" can take 15~25s before first text output)
                    // 2.5-flash keeps thinkingBudget (thinkingLevel may be unsupported):
                    //   - YouTube: budget 0 (disable)
                    //   - medical_qa: budget 3000 (cap)
                    //   - Others: undefined (model default)
                    const is3xModel = effectiveModel === SERVER_MODELS.FLASH_3_5;
                    const thinkingConfig = is3xModel
                        ? (isYoutubeRequest && hasVideoData)
                            ? { thinkingLevel: "minimal" as const }
                            : { thinkingLevel: "low" as const }
                        : (isYoutubeRequest && hasVideoData)
                            ? { thinkingBudget: 0 }
                            : state.intent === 'medical_qa'
                            ? { thinkingBudget: 3000 }
                            : undefined;

                    // Two-track path for 3.5 + Google Search:
                    // 1) 2.5-flash with Google Search for grounded facts
                    // 2) 3.5-flash with minimal thinking for final synthesis
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] Two-track enabled: stage1(2.5+search) -> stage2(3.5+minimal)');

                        const stage1Response = await genai.models.generateContent({
                            model: SEARCH_FALLBACK_MODEL,
                            contents: sdkContents,
                            config: {
                                systemInstruction: finalInstruction,
                                tools: [{ googleSearch: {} }],
                                temperature: 0.2,
                                topP: 0.8,
                                topK: 40,
                                maxOutputTokens: effectiveMaxTokens,
                                ...(state.intent === 'medical_qa' ? { thinkingConfig: { thinkingBudget: 3000 } } : {}),
                            }
                        });

                        const stage1Parts = stage1Response.candidates?.[0]?.content?.parts ?? [];
                        let stage1Text = (stage1Response.text ?? stage1Parts
                            .filter((p: any) => !p.thought)
                            .map((p: any) => p.text || "")
                            .join(""))
                            .replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '')
                            .trim();

                        const stage1Grounding = stage1Response.candidates?.[0]?.groundingMetadata;
                        if (stage1Grounding?.groundingChunks) {
                            groundingSources = stage1Grounding.groundingChunks
                                .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                .filter(Boolean);
                        }

                        if (!stage1Text) {
                            throw new Error('Two-track stage1 returned empty grounded text');
                        }
                        stage1FallbackText = stage1Text;

                        // Keep synthesis input compact to reduce timeout risk.
                        if (stage1Text.length > 8000) {
                            stage1Text = stage1Text.slice(0, 8000);
                        }

                        const synthesisInstruction = [
                            '[GROUNDING_NOTES_FROM_STAGE1]',
                            stage1Text,
                            '',
                            '[SYNTHESIS_RULES]',
                            '- Use ONLY the grounded notes above as factual source.',
                            '- Do not add new external facts.',
                            '- Do NOT mention the process or source handoff. Never start with phrases like "제시된 정보를 바탕으로", "제공된 정보를 바탕으로", "Based on the provided information", "Based on the sources", "Según la información proporcionada", or "D’après les informations fournies".',
                            '- Start directly with the answer content.',
                            '- Use this structure, translating section labels into the target response language:',
                            '  1. A short "One-line summary" section with exactly one sentence.',
                            '  2. A "Key content" section with concrete, organized subsections.',
                            '  3. A "Considerations" section only if there are meaningful tradeoffs, limitations, risks, or adoption notes.',
                            '- Keep headings concise and avoid generic meta headings such as "Summary of provided information".',
                            '- Preserve useful structure, clarity, and brevity.',
                            '- If evidence is insufficient, state that clearly.',
                        ].join('\n');

                        let stage2ApiKey = sdkApiKey;
                        let stage2Attempt = 0;
                        let stage2QuotaExhausted = false;

                        while (stage2Attempt < MAX_KEY_RETRIES) {
                            try {
                                const stage2Genai = new GoogleGenAI({ apiKey: stage2ApiKey });
                                const stage2Response = await stage2Genai.models.generateContent({
                                    // Stage2 synthesis must run on the originally selected model (3.5),
                                    // not on effectiveModel (2.5 used only for Stage1 grounding).
                                    model: resolvedModel,
                                    contents: [{ role: 'user', parts: [{ text: synthesisInstruction }] }],
                                    config: {
                                        maxOutputTokens: effectiveMaxTokens,
                                        thinkingConfig: { thinkingLevel: 'minimal' as any },
                                    },
                                });

                                responseText = stage2Response.text || '';
                                break;
                            } catch (error: any) {
                                const status = error?.status ?? error?.code;
                                if (status === 429 || status === 503) {
                                    stage2Attempt += 1;
                                    // Daily/project-level quota exhausted — rotating keys won't help
                                    // Skip remaining key retries and go directly to 2.5 fallback
                                    if (isDailyQuotaError(error)) {
                                        console.warn(`[LangGraph] Stage2 daily quota exhausted for ${resolvedModel}. Skipping key rotation → 2.5 fallback.`);
                                        markKeyDailyExhausted(stage2ApiKey);
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    console.warn(`[LangGraph] Stage2 quota error (${status}) attempt ${stage2Attempt}/${MAX_KEY_RETRIES}. Rotating API key.`);
                                    if (stage2Attempt >= MAX_KEY_RETRIES) {
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    const nextStage2Key = getNextApiKey();
                                    if (!nextStage2Key) {
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    stage2ApiKey = nextStage2Key;
                                    continue;
                                }
                                throw error;
                            }
                        }

                        if (stage2QuotaExhausted) {
                            console.warn('[LangGraph] Stage2 exhausted all API keys. Falling back to 2.5 synthesis.');
                            let fallbackSuccess = false;
                            for (let retryIdx = 0; retryIdx < MAX_KEY_RETRIES; retryIdx++) {
                                try {
                                    const fallbackKey = getNextApiKey() ?? sdkApiKey;
                                    const fallbackGenai = new GoogleGenAI({ apiKey: fallbackKey });
                                    const fallbackResponse = await fallbackGenai.models.generateContent({
                                        model: SEARCH_FALLBACK_MODEL,
                                        contents: [{ role: 'user', parts: [{ text: synthesisInstruction }] }],
                                        config: {
                                            temperature: 0.2,
                                            topP: 0.8,
                                            topK: 40,
                                            maxOutputTokens: effectiveMaxTokens,
                                            ...(state.intent === 'medical_qa' ? { thinkingConfig: { thinkingBudget: 3000 } } : {}),
                                        },
                                    });
                                    responseText = fallbackResponse.text || stage1Text;
                                    fallbackSuccess = true;
                                    console.log('[LangGraph] Stage2 fallback to 2.5 succeeded');
                                    break;
                                } catch (fallbackError: any) {
                                    const fbStatus = fallbackError?.status ?? fallbackError?.code;
                                    if (fbStatus === 429 || fbStatus === 503) {
                                        console.warn(`[LangGraph] Stage2 fallback retry ${retryIdx + 1}/${MAX_KEY_RETRIES} failed with ${fbStatus}`);
                                        continue;
                                    }
                                    console.error('[LangGraph] Stage2 fallback fatal error:', fallbackError.message);
                                    break;
                                }
                            }
                            
                            // If all fallback attempts failed, use stage1Text as fallback
                            if (!fallbackSuccess) {
                                console.warn('[LangGraph] Stage2 fallback exhausted. Using Stage1 grounded text as response.');
                                responseText = stage1Text;
                            }
                        }

                        if (!responseText && stage1FallbackText) {
                            console.warn('[LangGraph] Stage2 returned empty text. Using Stage1 grounded text as safe fallback.');
                            responseText = stage1FallbackText;
                        }
                    } else {
                        const singlePassResponse = await genai.models.generateContent({
                            model: effectiveModel,
                            contents: sdkContents,
                            config: {
                                systemInstruction: finalInstruction,
                                ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                ...(is3xModel ? {} : { temperature: 0.2, topP: 0.8, topK: 40 }),
                                maxOutputTokens: effectiveMaxTokens,
                                ...(thinkingConfig ? { thinkingConfig: thinkingConfig as any } : {}),
                            }
                        });

                        const singleParts = singlePassResponse.candidates?.[0]?.content?.parts ?? [];
                        responseText = (singlePassResponse.text ?? singleParts
                            .filter((p: any) => !p.thought)
                            .map((p: any) => p.text || '')
                            .join('')).trim();

                        const singleGrounding = singlePassResponse.candidates?.[0]?.groundingMetadata;
                        if (singleGrounding?.groundingChunks) {
                            groundingSources = singleGrounding.groundingChunks
                                .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                .filter(Boolean);
                        }
                    }

                    if (!responseText) {
                        throw new Error('SDK returned empty response text');
                    }

                    if (sendEvent && responseText) sendEvent({ text: responseText });
                    if (groundingSources.length > 0) {
                        console.log(`[LangGraph] Two-track grounding sources: ${groundingSources.length}`);
                    }

                    sdkSuccess = true;
                    const aiMsg = new AIMessage(responseText);
                    return { messages: [aiMsg], groundingSources };

                } catch (err: any) {
                    // If text was already streamed to the client, do NOT retry — would cause duplicate output
                    if (responseText) {
                        console.warn('[LangGraph] Error after partial stream (err:', err?.status, ') — returning partial response to avoid duplication');
                        if (sendEvent) sendEvent({ cutOff: true });
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
                        if (isRateLimit) {
                            if (isDailyQuotaError(err)) {
                                markKeyDailyExhausted(sdkApiKey);
                            } else {
                                markKeyRateLimited(sdkApiKey);
                            }
                        }
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
                const is3xLcModel = resolvedModel === SERVER_MODELS.FLASH_3_5;
                const llm = new ChatGoogleGenerativeAI({
                    model: resolvedModel,
                    apiKey: lcApiKey,
                    ...(is3xLcModel ? {} : { temperature: 0.2, topP: 0.8, topK: 40 }),
                    // Drug card JSON is compact — 8192 is sufficient and reduces Vercel 60s timeout risk
                    maxOutputTokens: 8192,
                    maxRetries: 0,
                });

                let allTools: any[] = [];
                if (state.intent === "drug_id") {
                    allTools = [identifyPillTool, searchWebTool];
                } else if (state.intent === "drug_info") {
                    allTools = [searchDrugInfoTool, searchWebTool];
                } else if (state.intent === "pharmacy_search") {
                    allTools = [pharmacyTool, searchWebTool];
                } else if (state.intent === "hospital_search") {
                    allTools = [hospitalTool, searchWebTool];
                } else if (state.intent === "vet_search") {
                    allTools = [vetTool, searchWebTool];
                } else if (state.intent === "law_search") {
                    allTools = [lawTool];
                }

                const llmWithTools = allTools.length === 0 ? llm : llm.bindTools(allTools);

                // Fast-pass: Bypass final LLM generation if pharmacyTool / hospitalTool has successfully executed
                const lastMsg = state.messages[state.messages.length - 1];
                if (state.intent === "pharmacy_search" && lastMsg._getType() === "tool" && lastMsg.name === "pharmacyTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:pharmacy')) {
                        console.log('[LangGraph] Fast-passing pharmacyTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "hospital_search" && lastMsg._getType() === "tool" && lastMsg.name === "hospitalTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:hospital')) {
                        console.log('[LangGraph] Fast-passing hospitalTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "vet_search" && lastMsg._getType() === "tool" && lastMsg.name === "vetTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:vet')) {
                        console.log('[LangGraph] Fast-passing vetTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "law_search" && lastMsg._getType() === "tool" && lastMsg.name === "lawTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:law')) {
                        console.log('[LangGraph] Fast-passing lawTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }

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
                    if (isRateLimit) {
                        if (isDailyQuotaError(err)) {
                            markKeyDailyExhausted(lcApiKey);
                        } else {
                            markKeyRateLimited(lcApiKey);
                        }
                    }
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
