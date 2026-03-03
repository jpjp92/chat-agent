import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchPill } from "../pill-logic.js";

/**
 * Tool for searching the web using DuckDuckGo Html.
 * Useful for finding specific missing information like drug usage, dosage, or ingredients.
 */
export const searchWebTool = tool(
    async ({ query }) => {
        try {
            console.log(`[Agent Tool] searchWebTool called with query: ${query}`);
            const res = await fetch("https://html.duckduckgo.com/html/", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                body: `q=${encodeURIComponent(query)}`
            });
            const text = await res.text();
            let results = [];
            // Regex to parse snippet text from DDG HTML
            let regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                let snippet = match[1].replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
                if (snippet && snippet.length > 20) {
                    results.push(snippet);
                }
                if (results.length >= 4) break;
            }
            if (results.length === 0) {
                return `웹 검색 결과가 없습니다. 질의: ${query}`;
            }
            return `[WEB_SEARCH_RESULTS for "${query}"]\n` + results.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
        } catch (e: any) {
            console.error("[Agent Tool] searchWebTool error:", e);
            return "웹 검색 중 오류가 발생했습니다.";
        }
    },
    {
        name: "search_web",
        description: "Search the web for general information, especially useful for finding specific drug usage (용법), dosage (용량), or ingredient details that are not provided by visual drug databases.",
        schema: z.object({
            query: z.string().describe("The search query (e.g., '타파진정 10mg 주요 성분과 용법')"),
        }),
    }
);

/**
 * Tool for identifying pills using the pharm.or.kr database.
 * The model will use this when it visually extracts attributes from an image.
 */
export const identifyPillTool = tool(
    async ({ imprint_front, imprint_back, color, shape }) => {
        try {
            console.log(`[Agent Tool] identifyPillTool called with:`, { imprint_front, imprint_back, color, shape });

            const result = await searchPill({
                imprint_front,
                imprint_back,
                color,
                shape
            });

            if (result.match_type === 'none' || result.filteredResults.length === 0) {
                return "약학정보원 DB에서 일치하는 약품을 찾지 못했습니다. 시각적 유사성을 기반으로 답변하되, 반드시 의사나 약사에게 정확한 식별을 의뢰하라고 경고하세요.";
            }

            // Format the results into a string block for the LLM
            let formattedResult = `[PROVIDED_PILL_DATA]\nmatch_type: ${result.match_type}\n`;
            result.filteredResults.forEach((r, idx) => {
                formattedResult += `Candidate ${idx + 1}:\n`;
                formattedResult += `- Name: ${r.product_name}\n`;
                formattedResult += `- Company: ${r.company}\n`;
                formattedResult += `- Imprint: ${r.front_imprint} / ${r.back_imprint}\n`;
                formattedResult += `- Color: ${r.color}\n`;
                formattedResult += `- Shape: ${r.shape}\n`;
                formattedResult += `- Image: ${r.thumbnail}\n`;
                formattedResult += `- Detail URL: ${r.detail_url}\n\n`;
            });

            return formattedResult;
        } catch (e: any) {
            console.error("[Agent Tool] searchPillTool error:", e);
            return "약학정보원 DB 조회 중 오류가 발생했습니다. (검색 실패)";
        }
    },
    {
        name: "identify_pill",
        description: "Search the Korean pharmaceutical database (pharm.or.kr) to identify a pill based on its visual characteristics (imprint, color, shape). Call this tool only when you have extracted visual information from a pill image.",
        schema: z.object({
            imprint_front: z.string().describe("The exact text imprinted on the front of the pill. Empty string if none."),
            imprint_back: z.string().optional().describe("The exact text imprinted on the back of the pill. Empty string if none."),
            color: z.string().optional().describe("The main color of the pill (e.g. 하양, 노랑, 주황, 분홍, 초록, 파랑, 갈색)."),
            shape: z.string().optional().describe("The shape of the pill (e.g. 원형, 타원형, 장방형, 육각형, 기타)."),
        }),
    }
);
