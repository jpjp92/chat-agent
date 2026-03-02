import { AgentStateType } from "../state.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey } from "../../config.js";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Vision Node
 * Special preprocessor solely for extracting properties from pill images.
 */
export const visionNode = async (state: AgentStateType) => {
    console.log('[LangGraph] Entering Vision Node');
    const apiKey = getNextApiKey();
    if (!apiKey) throw new Error("No API key available for Vision API");

    // Always use a cheap, fast model for vision preprocessing
    const model = new ChatGoogleGenerativeAI({
        model: "gemini-2.5-flash-lite",
        apiKey: apiKey,
        temperature: 0.1,
    });

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

    try {
        let inlineData = imageAtt.data;
        if (inlineData.startsWith("http")) {
            const res = await fetch(inlineData);
            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                inlineData = Buffer.from(arrayBuffer).toString('base64');
            }
        } else if (inlineData.includes(",")) {
            inlineData = inlineData.split(",")[1];
        }

        const message = new HumanMessage({
            content: [
                { type: "text", text: visionPrompt },
                { type: "image_url", image_url: { url: `data:${imageAtt.mimeType};base64,${inlineData}` } }
            ]
        });

        const response = await model.invoke([message]);
        const visionText = typeof response.content === "string" ? response.content : "";
        const jsonMatch = visionText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            try {
                const pillInfo = JSON.parse(jsonMatch[0]);
                console.log('[LangGraph] Vision Node extracted:', pillInfo);

                // Inject a system mandate into the context info for the LLM to process
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
            } catch (e) { }
        }
    } catch (err) {
        console.warn("[LangGraph] Vision Node Failed", err);
        return {
            contextInfo: `[VISION EXTRACTION FAILED]\n약 이미지 전처리에 실패했습니다. "수동으로 각인, 색상, 모양을 알려주시면 다시 검색해 드릴게요"라고 사용자에게 응답하세요.`,
            nextNode: "generator"
        }
    }

    return { nextNode: "generator" };
};
