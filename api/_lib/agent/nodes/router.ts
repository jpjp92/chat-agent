import { AgentStateType } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey } from "../../config.js";

/**
 * Router Node
 * Uses a lightweight LLM (gemini-2.5-flash-lite) to classify user intent.
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

    const hasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));

    const medicalKeywords = [
        '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
        '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
        '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
    ];

    let intent = "general";
    const apiKey = getNextApiKey();
    
    // Fallback heuristic function
    const heuristicCheck = () => {
        return medicalKeywords.some(k => textContent.includes(k)) || /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/.test(textContent);
    };

    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `Classify the strictly main intent of the user message. 
If the user is asking a medical or pharmaceutical question (e.g., identifying a pill, asking for drug dosage, side effects, etc.), classify as "medical".
If it is a general chat, greeting, code task, web search, or video summary, classify as "general".

Reference examples of medical keywords that MIGHT indicate a medical intent: ${medicalKeywords.join(", ")}

User Message: "${textContent}"

Output ONLY a JSON object exactly like this:
{"intent": "general"} OR {"intent": "medical"}`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite', // Using flash-lite for speed
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    temperature: 0,
                    responseMimeType: "application/json"
                }
            });

            if (response.text) {
                const parsed = JSON.parse(response.text);
                if (parsed.intent === "medical") {
                    intent = "medical";
                }
                console.log(`[LangGraph] Semantic Router parsed intent from LLM: ${intent}`);
            }
        } catch (error) {
            console.warn('[LangGraph] Semantic Router LLM failed, falling back to heuristics:', error);
            if (heuristicCheck()) intent = "medical";
        }
    } else {
        if (heuristicCheck()) intent = "medical";
    }

    // Route 1: Pill image identification → vision preprocessing needed
    if (intent === "medical" && hasImage) {
        console.log('[LangGraph] Router decided: VISION processing required');
        return { nextNode: "vision", intent: "medical" };
    }

    console.log(`[LangGraph] Router decided: intent=${intent}`);
    return { nextNode: "generator", intent };
};
