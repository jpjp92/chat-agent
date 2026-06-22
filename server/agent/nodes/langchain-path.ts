import { AgentStateType } from "../state";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey, markKeyInvalid, API_KEYS } from "../../config";
import { SERVER_MODELS } from "../../models";
import { identifyPillTool, searchWebTool } from "../tools";
import { searchDrugInfoTool } from "../drug-info-tool";
import { pharmacyTool } from "../pharmacy-tool";
import { hospitalTool } from "../hospital-tool";
import { vetTool } from "../vet-tool";
import { lawTool } from "../law-tool";
import { movieTool } from "../movie-tool";
import { worldCupTool } from "../worldcup-tool";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { pillNoMatchMessage, pillLookupErrorMessage, extractPillMatchType, pillCandidateTableMessage } from "./pill-messages";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";

/**
 * LangChain generation path (extracted from generator.ts, 3-A — move-only).
 *
 * Reached either when the intent needs local tools (useLangChain=true) or as an
 * unstreamed fallback after the SDK path fully fails (sdkSuccess=false). Handles:
 * the SDK-failure YouTube guard, fast-pass card bypass, direct pill lookup, tool
 * binding + invoke, and key-rotation retry.
 *
 * Control flow is fully terminal: every branch returns `{ messages }` or throws,
 * so the caller does `return await runLangChainPath(...)`.
 *
 * `finalInstruction` is mutated locally (direct pill lookup appends DB result);
 * the caller does not read it after this point, so nothing is returned for it.
 */
export const runLangChainPath = async (args: {
    state: AgentStateType;
    finalInstruction: string;
    resolvedModel: string;
    apiKey: string;
    systemInstructionBase: string;
    useLangChain: boolean;
    sdkSuccess: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
}): Promise<{ messages: any[] }> => {
    const { state, resolvedModel, apiKey, systemInstructionBase, useLangChain, sdkSuccess, isYoutubeRequest, hasVideoData } = args;
    let finalInstruction = args.finalInstruction;

    // LangChain path: drug_id and drug_info intents need custom DB/identification tools.
    // Note: for non-drug intents, this path acts as an unstreamed fallback when SDK fully fails.
    if (!useLangChain && !sdkSuccess) {
        console.error('[LangGraph] SDK path failed for intent:', state.intent, '— falling back to LangChain (no streaming)');
        // YouTube native video analysis uses fileData which LangChain does not support.
        // Falling through would produce hallucinated content instead of the actual video summary.
        // Return a clear error message so the user knows to retry rather than seeing wrong content.
        if (isYoutubeRequest && hasVideoData) {
            const YT_ERR: Record<string, string> = {
                KOREAN:  'YouTube 영상 분석 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.',
                ENGLISH: 'YouTube video analysis is temporarily unavailable. Please try again in a moment.',
                SPANISH: 'El análisis de video de YouTube no está disponible temporalmente. Por favor, inténtelo de nuevo en un momento.',
                FRENCH:  'L\'analyse vidéo YouTube est temporairement indisponible. Veuillez réessayer dans un instant.',
            };
            const langMatch = systemInstructionBase.match(/YOUR ENTIRE RESPONSE MUST BE IN (\w+) ONLY/);
            const errMsg = langMatch ? (YT_ERR[langMatch[1]] ?? YT_ERR.ENGLISH) : YT_ERR.ENGLISH;
            return { messages: [new AIMessage(errMsg)] };
        }
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

            // Fast-pass: Bypass final LLM generation if pharmacyTool / hospitalTool has successfully executed
            const lastMsg = state.messages[state.messages.length - 1];
            if (state.intent === "drug_id" && lastMsg._getType() === "tool" && lastMsg.name === "identify_pill") {
                const toolContent = (() => {
                    if (typeof lastMsg.content === 'string') return lastMsg.content;
                    if (Array.isArray(lastMsg.content)) return (lastMsg.content as any[]).map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
                    return '';
                })();
                if (toolContent.includes('약학정보원 DB에서 일치하는 약품을 찾지 못했습니다')) {
                    console.log('[LangGraph] Fast-passing identify_pill no-match result');
                    return {
                        messages: [new AIMessage(pillNoMatchMessage(state.pillData))]
                    };
                }
                if (toolContent.includes('약학정보원 DB 조회 중 오류가 발생했습니다')) {
                    console.log('[LangGraph] Fast-passing identify_pill lookup-error result');
                    return {
                        messages: [new AIMessage(pillLookupErrorMessage)]
                    };
                }
            }
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
            if (state.intent === "movie_search" && lastMsg._getType() === "tool" && lastMsg.name === "movieTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:movie')) {
                    console.log('[LangGraph] Fast-passing movieTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }

            let directPillLookupDone = false;
            if (state.intent === "drug_id" && state.pillData && lastMsg._getType() !== "tool") {
                console.log('[LangGraph] Direct identify_pill lookup from vision data');
                const pillLookupResult = await identifyPillTool.invoke({
                    imprint_front: state.pillData.imprint_front ?? "",
                    imprint_back: state.pillData.imprint_back ?? "",
                    color: state.pillData.color ?? "",
                    shape: state.pillData.shape ?? "",
                });
                const pillLookupText = (() => {
                    if (typeof pillLookupResult === 'string') return pillLookupResult;
                    // LangChain may return a ToolMessage object — extract .content
                    const c = (pillLookupResult as any)?.content;
                    if (typeof c === 'string') return c;
                    if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
                    return String(pillLookupResult ?? '');
                })();
                directPillLookupDone = true;

                if (pillLookupText.includes('약학정보원 DB에서 일치하는 약품을 찾지 못했습니다')) {
                    console.log('[LangGraph] Direct identify_pill no-match result');
                    return { messages: [new AIMessage(pillNoMatchMessage(state.pillData))] };
                }
                if (pillLookupText.includes('약학정보원 DB 조회 중 오류가 발생했습니다')) {
                    console.log('[LangGraph] Direct identify_pill lookup-error result');
                    return { messages: [new AIMessage(pillLookupErrorMessage)] };
                }
                const pillMatchType = extractPillMatchType(pillLookupText);
                if (pillMatchType && pillMatchType !== 'exact') {
                    console.log('[LangGraph] Direct identify_pill non-exact result:', pillMatchType);
                    return { messages: [new AIMessage(pillCandidateTableMessage(state.pillData, pillMatchType, pillLookupText))] };
                }

                finalInstruction += `\n\n[IDENTIFY_PILL_DATABASE_RESULT]\n${pillLookupText}\n\n[DRUG_ID_RESPONSE_RULES]\n- Do NOT include or reproduce the raw vision extraction JSON.\n- Use the database result above as the only source for the pill candidate list.\n- Generate a json:drug card ONLY when match_type is exact.`;
            }

            let allTools: any[] = [];
            if (state.intent === "drug_id") {
                // Pill image identification already performed deterministic DB lookup
                // above. Do not expose additional tools here; otherwise the model can
                // enter generator → search/identify tool → generator recursion.
                allTools = directPillLookupDone ? [] : [identifyPillTool, searchWebTool];
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
            } else if (state.intent === "movie_search") {
                allTools = [movieTool];
            } else if (state.intent === "sports") {
                allTools = [worldCupTool];
            }

            const llmWithTools = allTools.length === 0 ? llm : llm.bindTools(allTools);

            // Drug image requests are pre-processed by the vision node. Do not pass the
            // original image into the LangChain tool path again: 3.5 may re-run visual
            // extraction and stream raw JSON instead of calling identify_pill.
            const safeMessages = state.messages.map((msg: any) => {
                if (msg._getType() === 'human' && Array.isArray(msg.content)) {
                    const safeParts = (msg.content as any[]).filter((p: any) =>
                        p.type === 'text' || (state.intent !== 'drug_id' && p.type === 'image_url')
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
            const isTimeout = isTimeoutError(err);
            const isUnavailable = err?.status === 503 || err?.message?.includes('UNAVAILABLE');
            if (isRateLimit || isStreamError || isTimeout || isUnavailable) {
                if (isRateLimit) markRateLimitKey(lcApiKey, err);
                const nextKey = getNextApiKey();
                if (nextKey && nextKey !== lcApiKey) {
                    lcApiKey = nextKey;
                    lcAttempt++;
                    const reason = isRateLimit ? '429' : isTimeout ? 'timeout/504' : isUnavailable ? '503' : 'stream-error';
                    console.log(`[LangGraph] LangChain retry (attempt ${lcAttempt + 1}) reason:`, reason, err?.message?.slice(0, 80));
                    continue;
                }
            }
            const isAuth = isAuthError(err);
            if (isAuth) markKeyInvalid(lcApiKey);
            console.error('[LangGraph] LangChain path fatal error:', err?.status, err?.message?.slice(0, 120));
            throw err;
        }
    }

    throw new Error('[LangGraph] All API keys exhausted for LangChain path.');
};
