import { AgentStateType } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";

/**
 * Router Node
 * Analyzes the user's input and attachments to determine if we need
 * specialized preprocessing (like vision for pill images or MFDS drug info lookup).
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

    const medicalKeywords = [
        '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
        '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
        '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
    ];
    // Check for specific keywords, or the standalone word '약' (e.g., "약 찾아줘", "이 약")
    // '요약' (summary) will not match because '약' requires a word boundary/space before it.
    const hasMedicalKeyword = medicalKeywords.some(k => textContent.includes(k)) || /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/.test(textContent);
    const hasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));

    // Route 1: Pill image identification → vision preprocessing needed
    if (hasMedicalKeyword && hasImage) {
        console.log('[LangGraph] Router decided: VISION processing required');
        return { nextNode: "vision", intent: "medical" };
    }

    // Default: Choose intent based on keywords
    const intent = hasMedicalKeyword ? "medical" : "general";
    console.log(`[LangGraph] Router decided: intent=${intent}`);

    return { nextNode: "generator", intent };
};
