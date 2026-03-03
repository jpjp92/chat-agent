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

    const hasPillKeyword = ['약', '알약', '약품', '정', '캡슐', '명칭', '식별', '이거 뭔', '무슨 약', '이게 뭐야'].some(k => textContent.includes(k));
    const hasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));

    // Route 1: Pill image identification → vision preprocessing needed
    if (hasPillKeyword && hasImage) {
        console.log('[LangGraph] Router decided: VISION processing required');
        return { nextNode: "vision" };
    }

    // All other cases → generator (drug info tool will be called automatically by LLM if needed)
    return { nextNode: "generator" };
};
