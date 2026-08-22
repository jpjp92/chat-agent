import { tool } from "@langchain/core/tools";
import { parseDdgHtml, formatDdgResults } from "./ddg-parse";
import { z } from "zod";
import { searchMfdsPills } from "../mfds-logic";
import { searchPill } from "../pill-logic";

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
            const html = await res.text();
            // 🔴 파싱은 `server/agent/ddg-parse.ts` 로 분리했다 — 여기 정규식이 박혀 있던 탓에
            //    DDG 가 HTML 을 바꿔도(속성 순서 변경 + uddg 리디렉션 폐지) 아무도 몰랐고,
            //    **전 검색에서 출처 URL 이 0건**이 됐다. 순수 함수라 하니스로 고정된다.
            const results = parseDdgHtml(html);
            if (results.length === 0) {
                console.warn('[Agent Tool] searchWebTool: 파싱 결과 0건 — DDG HTML 구조가 또 바뀌었을 수 있다. 질의:', query);
            }
            return formatDdgResults(query, results);
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
        // 1순위: MFDS 식약처 DB (Supabase mfds_pills 테이블)
        try {
            const mfds = await searchMfdsPills({ imprint_front, imprint_back, color, shape });

            if (mfds.match_type !== 'none' && mfds.results.length > 0) {
                let out = `[PROVIDED_PILL_DATA]\nmatch_type: ${mfds.match_type}\n`;
                mfds.results.forEach((r, i) => {
                    out += `Candidate ${i + 1}:\n`;
                    out += `- Name: ${r.item_name}\n`;
                    out += `- Company: ${r.entp_name}\n`;
                    out += `- Imprint: ${r.mark_codes.join(', ')}\n`;
                    out += `- Color: ${r.color_class1 ?? '-'}\n`;
                    out += `- Shape: ${r.drug_shape ?? '-'}\n`;
                    out += `- Form: ${r.form_code_name ?? '-'}\n`;
                    out += `- Image: ${r.item_image ?? ''}\n`;
                    out += `- Detail URL: ${r.detail_url}\n\n`;
                });
                return out;
            }
        } catch (e: any) {
            console.warn('[identifyPillTool] MFDS DB 조회 실패, pharm.or.kr 폴백:', e?.message);
        }

        // 2순위: pharm.or.kr 스크래핑 폴백
        try {
            const result = await searchPill({ imprint_front, imprint_back, color, shape });

            if (result.match_type === 'none' || result.filteredResults.length === 0) {
                return "약학정보원 DB에서 일치하는 약품을 찾지 못했습니다. 시각적 유사성을 기반으로 답변하되, 반드시 의사나 약사에게 정확한 식별을 의뢰하라고 경고하세요.";
            }

            let out = `[PROVIDED_PILL_DATA]\nmatch_type: ${result.match_type}\n`;
            result.filteredResults.forEach((r, i) => {
                out += `Candidate ${i + 1}:\n`;
                out += `- Name: ${r.product_name}\n`;
                out += `- Company: ${r.company}\n`;
                out += `- Imprint: ${r.front_imprint} / ${r.back_imprint}\n`;
                out += `- Color: ${r.color}\n`;
                out += `- Shape: ${r.shape}\n`;
                out += `- Image: ${r.thumbnail}\n`;
                out += `- Detail URL: ${r.detail_url}\n\n`;
            });
            return out;
        } catch (e: any) {
            console.error('[identifyPillTool] 모든 DB 조회 실패:', e?.message);
            return "약학정보원 DB 조회 중 오류가 발생했습니다. (검색 실패)";
        }
    },
    {
        name: "identify_pill",
        description: "Search the Korean pharmaceutical database (MFDS/식약처) to identify a pill based on its visual characteristics (imprint, color, shape). Call this tool only when you have extracted visual information from a pill image.",
        schema: z.object({
            imprint_front: z.string().describe("The exact text imprinted on the front of the pill. Empty string if none."),
            imprint_back: z.string().optional().describe("The exact text imprinted on the back of the pill. Empty string if none."),
            color: z.string().optional().describe("The main color of the pill (e.g. 하양, 노랑, 주황, 분홍, 초록, 파랑, 갈색)."),
            shape: z.string().optional().describe("The shape of the pill (e.g. 원형, 타원형, 장방형, 육각형, 기타)."),
        }),
    }
);
