import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey, markKeyRateLimited, API_KEYS } from "../../config.js";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Vision Node
 * Special preprocessor solely for extracting properties from pill images.
 */
export const visionNode = async (state: AgentStateType) => {
    console.log('[LangGraph] Entering Vision Node');
    let apiKey = getNextApiKey();
    if (!apiKey) throw new Error("No API key available for Vision API");

    const visionPrompt = `You are a pharmaceutical pill identification expert. Carefully examine the pill in the image and extract its visual characteristics.

CRITICAL INSTRUCTIONS for imprint reading:
- Read ALL characters exactly as they appear, preserving case (uppercase/lowercase)
- Logos made of combined letters (e.g., "dHP", "dP", "BI", "MSD") should be read as a single imprint string
- Do NOT split letters that are physically connected or part of a logo
- If you see a stylized logo, describe each letter you can identify in order (left-to-right, top-to-bottom)
- Hyphens, slashes, and numbers after letters (e.g., "J 80", "M 5") should be included in the imprint field

Return ONLY a JSON object in this exact format, no other text:
{
  "imprint_front": "exact characters visible on front face, or null if none",
  "imprint_back": "exact characters visible on back face, or null if none",
  "color": "one of: 하양, 노랑, 주황, 분홍, 빨강, 갈색, 연두, 초록, 청록, 파랑, 남색, 보라, 회색, 검정",
  "shape": "one of: 원형, 타원형, 장방형, 삼각형, 사각형, 마름모형, 오각형, 육각형, 팔각형, 기타",
  "confidence": "high|medium|low"
}`;

    const imageAtt = state.attachments.find(att => att.mimeType && att.mimeType.startsWith('image/'));
    if (!imageAtt) {
        return { nextNode: "generator" }; // fallback
    }

    // Build message once — reused across retry attempts
    let imageUrlPart: any;
    if (imageAtt.data.startsWith("http")) {
        imageUrlPart = { type: "image_url", image_url: { url: imageAtt.data } };
    } else {
        const inlineData = imageAtt.data.includes(",") ? imageAtt.data.split(",")[1] : imageAtt.data;
        imageUrlPart = { type: "image_url", image_url: { url: `data:${imageAtt.mimeType};base64,${inlineData}` } };
    }
    const message = new HumanMessage({
        content: [
            { type: "text", text: visionPrompt },
            imageUrlPart,
        ]
    });

    const MAX_ATTEMPTS = Math.min(2, API_KEYS.length); // 1 retry on 429
    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
        try {
            const model = new ChatGoogleGenerativeAI({
                model: "gemini-2.5-flash",
                apiKey: apiKey,
                temperature: 0.1,
            });

            const response = await model.invoke([message]);
            const visionText = typeof response.content === "string" ? response.content : "";
            const jsonMatch = visionText.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                try {
                    const pillInfo = JSON.parse(jsonMatch[0]);
                    console.log('[LangGraph] Vision Node extracted:', pillInfo);

                    const contextUpdate = `[VISION EXTRACTION SUCCESS]
The user attached an image of a pill. We have successfully extracted its visual properties:
${JSON.stringify(pillInfo, null, 2)}

[MANDATORY LLM INSTRUCTION]
You MUST call the 'identify_pill' tool using the properties extracted above. Do NOT guess the drug name based on your internal knowledge without calling the tool first.`;

                    return {
                        pillData: pillInfo,
                        contextInfo: contextUpdate,
                        nextNode: "generator"
                    };
                } catch (e: any) {
                    console.warn('[LangGraph] Vision Node JSON parse failed:', e.message, '| raw:', jsonMatch[0].slice(0, 100));
                }
            }

            return { nextNode: "generator" }; // LLM succeeded but no parseable JSON

        } catch (err: any) {
            const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit && attempt < MAX_ATTEMPTS - 1) {
                markKeyRateLimited(apiKey);
                const nextKey = getNextApiKey();
                if (nextKey && nextKey !== apiKey) {
                    apiKey = nextKey;
                    attempt++;
                    console.warn('[LangGraph] Vision Node 429: retrying with next key');
                    continue;
                }
            }
            console.warn("[LangGraph] Vision Node Failed:", err?.status ?? err);
            return {
                contextInfo: `[VISION EXTRACTION FAILED]\n약 이미지 전처리에 실패했습니다. "수동으로 각인, 색상, 모양을 알려주시면 다시 검색해 드릴게요"라고 사용자에게 응답하세요.`,
                nextNode: "generator"
            };
        }
    }

    return { nextNode: "generator" };
};
