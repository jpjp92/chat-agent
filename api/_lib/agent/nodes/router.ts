import { AgentStateType, IntentType } from "../state.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey } from "../../config.js";

/**
 * Router Node
 * Uses a lightweight LLM (gemini-2.5-flash-lite) to classify user intent into 9 categories.
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

    const hasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));

    const medicalKeywords = [
        '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
        '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
        '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
    ];

    let intent: IntentType = "general";
    const apiKey = getNextApiKey();

    // Fallback heuristic function
    const heuristicCheck = (): IntentType => {
        if (medicalKeywords.some(k => textContent.includes(k)) || /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/.test(textContent)) {
            return hasImage ? "drug_id" : "drug_info";
        }
        return "general";
    };

    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `Classify the strictly main intent of the user message into one of these 9 categories:
- "drug_id"    : pill/tablet image identification (user has an image AND asks to identify it)
- "drug_info"  : text-based drug name lookup, dosage, side effects, ingredients
- "medical_qa" : general medical or health question (symptoms, diseases, treatments, anatomy)
- "biology"    : biology, protein structure, DNA, RNA, cell biology, genetics, enzymes
- "chemistry"  : chemistry, molecular structure, chemical reaction, element, compound, SMILES
- "physics"    : physics simulation, mechanics, force, motion, gravity, collision, electricity
- "astronomy"  : constellation, star, planet, galaxy, universe, space observation
- "data_viz"   : data analysis, statistics, chart, graph, visualization of numbers/trends
- "general"    : everything else (code, writing, general chat, web search, video summary, etc.)\n${prevContext}\n\nUser Message: "${textContent}"\n\nOutput ONLY a JSON object exactly like this:\n{"intent": "general"}`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: { temperature: 0, responseMimeType: "application/json" }
            });

            if (response.text) {
                const parsed = JSON.parse(response.text);
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
                if (validIntents.includes(parsed.intent)) {
                    intent = parsed.intent as IntentType;
                }
                console.log(`[LangGraph] Semantic Router parsed intent from LLM: ${intent}`);
            }
        } catch (error) {
            console.warn('[LangGraph] Semantic Router LLM failed, falling back to heuristics:', error);
            intent = heuristicCheck();
        }
    } else {
        intent = heuristicCheck();
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
