import { AgentStateType, IntentType } from "../state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, isDailyQuotaError } from "../../config";
import { ROUTER_MODEL } from "../../models";
import { classifyIntentByRules, hasMedicalIntentKeyword } from "../intentRules";

/**
 * Router Node
 * Uses a lightweight LLM to classify user intent into the supported intent categories.
 * Injects last assistant message as context for follow-up intent continuity.
 * Falls back to keyword heuristics if the LLM fails.
 */
export const routerNode = async (state: AgentStateType) => {
    const lastMessage = state.messages[state.messages.length - 1] as HumanMessage;

    let textContent = "";
    if (typeof lastMessage.content === "string") {
        textContent = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
        for (const part of lastMessage.content) {
            if ((part as any).type === "text") {
                textContent += (part as any).text;
            }
        }
    }

    // Inject last assistant message for follow-up intent continuity
    const lastAssistantMsg = [...state.messages].reverse().find(m => m._getType() === 'ai') as AIMessage | undefined;
    const prevContext = lastAssistantMsg
        ? `\nPrevious assistant response (for follow-up context, first 300 chars): "${String(lastAssistantMsg.content).slice(0, 300)}"`
        : "";

    const attachmentHasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));
    const messageHasImage = state.messages.some((msg: any) =>
        Array.isArray(msg.content) && msg.content.some((part: any) =>
            part.type === 'image_url' ||
            part.inlineData?.mimeType?.startsWith?.('image/') ||
            (part.fileData?.mimeType?.startsWith?.('image/') && !part.fileData.fileUri?.includes('youtube'))
        )
    );
    const hasImage = attachmentHasImage || messageHasImage;

    let intent: IntentType = "general";
    const apiKey = getNextApiKey();

    const hasMedicalKeyword = hasMedicalIntentKeyword(textContent);

    // Fast-path: YouTube URL → 항상 "general" → Router LLM 호출 스킵
    const hasYoutubeUrl = /(?:youtube\.com\/|youtu\.be\/)/.test(textContent) ||
        (state.webContent && /(?:youtube\.com\/|youtu\.be\/)/.test(state.webContent));
    if (hasYoutubeUrl && !hasMedicalKeyword) {
        console.log('[LangGraph] Router fast-path: YouTube URL → general');
        return { nextNode: "generator", intent: "general" };
    }

    // Fast-path: image + explicit drug/pill textual signal → vision (pill identification).
    // IMPORTANT: only a genuine medical/pill keyword (약, 알약, 약품, 식별, pill, tablet, ...) triggers this.
    // A plain image with a generic caption ("이거 뭐야?", "이 사진 분석해줘") or no caption is NOT a pill
    // request — it must fall through to the LLM router / general multimodal generator, which can describe
    // any image. Routing every image to pill identification was the previous misclassification bug.
    if (hasImage && hasMedicalKeyword) {
        console.log('[LangGraph] Router fast-path: image + drug keyword → drug_id vision');
        return { nextNode: "vision", intent: "drug_id" };
    }

    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `Classify the strictly main intent of the user message into one of these categories:
- "drug_id"         : pill/tablet image identification (user has an image AND asks to identify it)
- "drug_info"       : text-based drug name lookup, dosage, side effects, ingredients
- "medical_qa"      : general medical or health question (symptoms, diseases, treatments, anatomy)
- "pharmacy_search" : finding a pharmacy location, operating hours, night/holiday pharmacy (in Seoul)
- "hospital_search" : finding a hospital or clinic location, ER, operating hours, medical departments (in Seoul)
- "vet_search"      : finding a veterinary hospital / animal clinic / pet hospital for pets or animals
- "law_search"      : Korean law/statute lookup, article text, legal provisions, law lists, legal interpretation requests
- "biology"         : biology, protein structure, DNA, RNA, cell biology, genetics, enzymes
- "chemistry"       : chemistry, molecular structure, chemical reaction, element, compound, SMILES
- "physics"         : physics simulation, mechanics, force, motion, gravity, collision, electricity
- "astronomy"       : constellation, star, planet, galaxy, universe, space observation
- "data_viz"        : data analysis, statistics, chart, graph, visualization of numbers/trends
- "general"         : everything else (code, writing, general chat, web search, video summary, etc.)\n${prevContext}\n\nUser Message: "${textContent}"\n\nOutput ONLY a JSON object exactly like this:\n{"intent": "general"}`;

            const response = await ai.models.generateContent({
                model: ROUTER_MODEL,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: { temperature: 0, responseMimeType: "application/json" }
            });

            if (response.text) {
                const parsed = JSON.parse(response.text);
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "pharmacy_search", "hospital_search", "vet_search", "law_search", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
                if (validIntents.includes(parsed.intent)) {
                    intent = parsed.intent as IntentType;
                }
                // Recover only when the LLM missed an explicit drug/pill signal on an image.
                // Do NOT override "general" for arbitrary images — generic photos stay general.
                if (intent === "general" && hasImage && hasMedicalKeyword) {
                    intent = "drug_id";
                }
                console.log(`[LangGraph] Semantic Router parsed intent from LLM: ${intent}`);
            }
        } catch (error: any) {
            const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit && apiKey) {
                if (isDailyQuotaError(error)) {
                    markKeyDailyExhausted(apiKey);
                } else {
                    markKeyRateLimited(apiKey);
                }
            }
            console.warn('[LangGraph] Semantic Router LLM failed, falling back to heuristics:', error?.status ?? error);
            intent = classifyIntentByRules(textContent, hasImage);
        }
    } else {
        intent = classifyIntentByRules(textContent, hasImage);
    }

    // Route: drug_id requires vision preprocessing when image is present
    // If drug_id but no image, treat as drug_info
    if (intent === "drug_id") {
        if (hasImage) {
            console.log('[LangGraph] Router decided: VISION processing required');
            return { nextNode: "vision", intent: "drug_id" };
        } else {
            intent = "drug_info";
        }
    }

    console.log(`[LangGraph] Router decided: intent=${intent}`);
    return { nextNode: "generator", intent };
};
