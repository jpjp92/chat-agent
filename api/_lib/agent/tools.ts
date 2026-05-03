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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            let res: Response;
            try {
                res = await fetch("https://html.duckduckgo.com/html/", {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    body: `q=${encodeURIComponent(query)}`
                });
            } finally {
                clearTimeout(timeoutId);
            }
            const text = await res.text();
            const snippets: string[] = [];
            const urls: { title: string; url: string }[] = [];

            // Helper: extract real URL from DDG redirect href
            const extractRealUrl = (rawUrl: string): string => {
                try {
                    const base = rawUrl.startsWith('http') ? rawUrl : 'https://duckduckgo.com' + rawUrl;
                    const uddg = new URL(base).searchParams.get('uddg');
                    return uddg ? decodeURIComponent(uddg) : rawUrl;
                } catch { return rawUrl; }
            };

            // Strategy 1: block regex — title link + snippet in proximity
            const blockRegex = /<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,600}?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
            let blockMatch;
            while ((blockMatch = blockRegex.exec(text)) !== null) {
                const realUrl = extractRealUrl(blockMatch[1]);
                const title = blockMatch[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                const snippet = blockMatch[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                if (snippet.length > 20) snippets.push(snippet);
                if (realUrl.startsWith('http') && urls.length < 4) {
                    urls.push({ title: title || realUrl, url: realUrl });
                }
                if (snippets.length >= 4) break;
            }

            // Strategy 2: extract uddg= URLs independently if Strategy 1 missed them
            if (urls.length === 0) {
                const uddgRegex = /href="([^"]*uddg=[^"]+)"/g;
                const titleRegex = /<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
                const allTitles: string[] = [];
                let tm;
                while ((tm = titleRegex.exec(text)) !== null) {
                    allTitles.push(tm[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
                }
                let um; let tIdx = 0;
                while ((um = uddgRegex.exec(text)) !== null && urls.length < 4) {
                    const realUrl = extractRealUrl(um[1]);
                    if (realUrl.startsWith('http') && !urls.some(u => u.url === realUrl)) {
                        urls.push({ title: allTitles[tIdx] || realUrl, url: realUrl });
                    }
                    tIdx++;
                }
            }

            // Strategy 3: snippet-only fallback
            if (snippets.length === 0) {
                const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
                let m;
                while ((m = snippetRegex.exec(text)) !== null) {
                    const s = m[1].replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
                    if (s.length > 20) snippets.push(s);
                    if (snippets.length >= 4) break;
                }
            }

            if (snippets.length === 0) {
                return `웹 검색 결과가 없습니다. 질의: ${query}`;
            }

            let output = `[WEB_SEARCH_RESULTS for "${query}"]\n` + snippets.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
            if (urls.length > 0) {
                output += `\n\n[WEB_SOURCE_URLS]\n` + urls.map(u => `${u.url} | ${u.title}`).join('\n');
            }
            return output;
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
