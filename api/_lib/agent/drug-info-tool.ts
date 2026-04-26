import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { HumanMessage } from "@langchain/core/messages";
import { getNextApiKey } from "../config.js";
import { searchWebTool } from "./tools.js";

const MFDS_API_ENDPOINT = process.env.MFDS_API_ENDPOINT || '';
const MFDS_API_KEY = process.env.MFDS_API_KEY || '';

/**
 * Uses Gemini SDK with Google Search grounding to retrieve drug info.
 * Called when MFDS returns no results (non-pill products like patches, ointments).
 */
async function searchDrugViaGoogleSearch(drugName: string): Promise<string | null> {
    const apiKey = getNextApiKey();
    if (!apiKey) return null;
    try {
        const genai = new GoogleGenAI({ apiKey });
        const response = await genai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: `${drugName} 의약품의 성분, 효능, 용법, 용량, 주의사항을 알려주세요.` }] }],
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.1,
            },
        });
        const text = response.text?.trim();
        if (!text || text.length < 50) return null;

        const gm = response.candidates?.[0]?.groundingMetadata as any;
        console.log(`[Agent Tool] Google Search drug info for "${drugName}": ${text.length} chars | chunks: ${gm?.groundingChunks?.length ?? 'none'} | queries: ${JSON.stringify(gm?.webSearchQueries)}`);

        // Extract grounding source URLs so chat.ts on_tool_end can surface them as chips
        const chunks = gm?.groundingChunks as any[] | undefined;
        if (chunks && chunks.length > 0) {
            const urlLines = chunks
                .filter((c: any) => c.web?.uri)
                .map((c: any) => `${c.web.uri} | ${c.web.title || c.web.uri}`)
                .join('\n');
            if (urlLines) {
                return `${text}\n\n[WEB_SOURCE_URLS]\n${urlLines}`;
            }
        }
        // Fallback: if grounding chunks are empty but search queries exist, use a Google search URL
        const queries = gm?.webSearchQueries as string[] | undefined;
        if (queries && queries.length > 0) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queries[0])}`;
            return `${text}\n\n[WEB_SOURCE_URLS]\n${searchUrl} | Google 검색: ${queries[0]}`;
        }
        return text;
    } catch (e: any) {
        console.error(`[Agent Tool] Google Search drug info error:`, e.message);
        return null;
    }
}

/**
 * Uses Gemini Vision to read actual imprint text from an MFDS drug image.
 * Called when MFDS API returns "마크" (logo) instead of actual text.
 */
async function extractImprintViaVision(imageUrl: string, side: 'front' | 'back'): Promise<string | null> {
    try {
        const apiKey = getNextApiKey();
        if (!apiKey) return null;

        // Download the image
        const imgController = new AbortController();
        const imgTimeout = setTimeout(() => imgController.abort(), 6000);
        let imgRes: Response;
        try {
            imgRes = await fetch(imageUrl, {
                signal: imgController.signal,
                headers: {
                    'User-Agent': 'curl/8.5.0',
                    'Referer': 'https://nedrug.mfds.go.kr/',
                }
            });
        } finally {
            clearTimeout(imgTimeout);
        }
        if (!imgRes.ok) return null;

        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];

        const model = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            apiKey: apiKey,
            temperature: 0.1,
        });

        const sideLabel = side === 'front' ? '앞면(왼쪽)' : '뒤면(오른쪽)';
        const prompt = `이 의약품 식별 사진의 ${sideLabel} 알약에 새겨진 각인(텍스트, 숫자, 기호, 로고 등)을 정확히 읽어주세요.

규칙:
- 알파벳, 숫자, 특수문자(-) 등 보이는 그대로 대문자로 출력하세요.
- 회사 로고 형태의 도형/심볼은 가장 유사한 알파벳 조합으로 표현하세요 (예: "d-P", "AZ", "Ω").
- 각인이 전혀 없으면 "없음"을 출력하세요.
- 각인 텍스트만 출력하고, 설명이나 부가 텍스트는 절대 포함하지 마세요.`;

        const message = new HumanMessage({
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } }
            ]
        });

        const response = await model.invoke([message]);
        const text = typeof response.content === "string" ? response.content.trim() : "";

        console.log(`[Vision Imprint] ${sideLabel} extracted: "${text}"`);

        if (!text || text === '없음') return null;
        return text;

    } catch (e: any) {
        console.error(`[Vision Imprint] Error extracting ${side} imprint:`, e.message);
        return null;
    }
}

/**
 * Searches the official Korean MFDS (식약처) drug identification database.
 * This is the primary source of truth for pill visual data (imprint, shape, color, image).
 * When MFDS returns "마크" for either imprint face, Gemini Vision reads the actual symbol.
 */
export const searchDrugInfoTool = tool(
    async ({ drug_name }) => {
        try {
            console.log(`[Agent Tool] searchDrugInfoTool called for: ${drug_name}`);

            // MFDS Search Helper
            const fetchMFDS = async (nameToSearch: string) => {
                const encodedName = encodeURIComponent(nameToSearch);
                const url = `${MFDS_API_ENDPOINT}?serviceKey=${MFDS_API_KEY}&numOfRows=5&pageNo=1&type=json&item_name=${encodedName}`;
                const mfdsController = new AbortController();
                const mfdsTimeout = setTimeout(() => mfdsController.abort(), 8000);
                let res: Response;
                try {
                    res = await fetch(url, { signal: mfdsController.signal, headers: { 'User-Agent': 'curl/8.5.0', 'Referer': 'https://www.data.go.kr' } });
                } finally {
                    clearTimeout(mfdsTimeout);
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                return json?.body?.items || [];
            };

            // Strategy 1: Spaceless original input (Works for "딜라트렌정25mg")
            let searchName = drug_name.replace(/\s/g, '');
            console.log(`[Agent Tool] MFDS Strategy 1 (Spaceless): ${searchName}`);
            let items = await fetchMFDS(searchName);

            if (!Array.isArray(items) || items.length === 0) {
                // Strategy 2: Korean units translation (Works for "다파진정10밀리그램")
                const normalizeForMFDS = (name: string): string => {
                    return name
                        .replace(/\s/g, '')
                        .replace(/mcg/gi, '마이크로그램')
                        .replace(/mg/gi, '밀리그램')
                        .replace(/(?<![가-힣])g(?!가)/gi, '그램');
                };
                searchName = normalizeForMFDS(drug_name);
                console.log(`[Agent Tool] MFDS Strategy 2 (Translated): ${searchName}`);
                items = await fetchMFDS(searchName);
            }

            if (!Array.isArray(items) || items.length === 0) {
                // Strategy 3: 구 표기 변환 — MFDS DB는 "밀리그람"(구 표기) 기준 저장
                // "타이레놀정500밀리그램" → "타이레놀정500밀리그람" 으로 재검색
                const oldSpelling = searchName
                    .replace(/밀리그램/g, '밀리그람')
                    .replace(/마이크로그램/g, '마이크로그람')
                    .replace(/그램/g, '그람');
                if (oldSpelling !== searchName) {
                    console.log(`[Agent Tool] MFDS Strategy 3 (Old spelling): ${oldSpelling}`);
                    items = await fetchMFDS(oldSpelling);
                }
            }

            if (!Array.isArray(items) || items.length === 0) {
                console.log(`[Agent Tool] MFDS returned no results for "${drug_name}". Trying Google Search → DuckDuckGo fallback.`);
                const notFoundPrefix = `[MFDS_NOT_FOUND] 식약처 알약식별 DB에 "${drug_name}"이(가) 없습니다 (파스·연고·크림·시럽 등 비알약 제형이거나 미등재).\n\n⚠️ CRITICAL INSTRUCTION: json:drug 블록을 생성하지 마세요. 아래 검색 결과를 바탕으로 성분·효능·용법을 마크다운(헤딩·불릿)으로 상세히 안내하세요. 응답 본문에 URL이나 출처는 포함하지 마세요.\n\n`;

                // 1st: Google Search grounding (most reliable)
                const googleResult = await searchDrugViaGoogleSearch(drug_name);
                if (googleResult) {
                    return notFoundPrefix + googleResult;
                }

                // 2nd: DuckDuckGo fallback
                try {
                    const webResult = await searchWebTool.invoke({ query: `${drug_name} 성분 효능 용법 용량` });
                    const hasWebContent = !webResult.includes('웹 검색 결과가 없습니다') && !webResult.includes('오류가 발생했습니다');
                    if (hasWebContent) {
                        return notFoundPrefix + webResult;
                    }
                } catch (_) { /* ignore */ }

                // 3rd: LLM internal knowledge
                return `[MFDS_NOT_FOUND] 식약처 알약식별 DB는 알약·정제만 관리하므로 "${drug_name}"은(는) 등록 대상이 아닙니다 (파스·연고·크림·시럽·패치 등).\n\n⚠️ CRITICAL INSTRUCTION: json:drug 블록을 생성하지 마세요. 훈련 데이터의 의학 지식을 활용해 성분·효능·용법·주의사항을 마크다운(헤딩·불릿)으로 상세히 안내하세요. 절대로 "찾을 수 없습니다"라고 답하지 마세요.`;
            }

            // For each item, if imprint is "마크" on front or back, use Gemini Vision to read it
            const MARK_VALUES = ['마크', '마크(로고)', 'mark', 'MARK', '각인'];
            const needsVision = items.some((item: any) => {
                const front = typeof item.PRINT_FRONT === 'string' ? item.PRINT_FRONT.trim() : '';
                const back = typeof item.PRINT_BACK === 'string' ? item.PRINT_BACK.trim() : '';
                return MARK_VALUES.includes(front) || MARK_VALUES.includes(back);
            });

            if (needsVision) {
                console.log(`[Agent Tool] "마크" detected — running Gemini Vision imprint extraction...`);
                // Process items in parallel for speed
                await Promise.all(items.map(async (item: any) => {
                    if (!item.ITEM_IMAGE) return;
                    const front = typeof item.PRINT_FRONT === 'string' ? item.PRINT_FRONT.trim() : '';
                    const back = typeof item.PRINT_BACK === 'string' ? item.PRINT_BACK.trim() : '';
                    const frontIsMark = MARK_VALUES.includes(front);
                    const backIsMark = MARK_VALUES.includes(back);

                    const [frontVision, backVision] = await Promise.all([
                        frontIsMark ? extractImprintViaVision(item.ITEM_IMAGE, 'front') : Promise.resolve(null),
                        backIsMark ? extractImprintViaVision(item.ITEM_IMAGE, 'back') : Promise.resolve(null),
                    ]);

                    if (frontVision) {
                        console.log(`[Agent Tool] Vision override PRINT_FRONT: "마크" → "${frontVision}"`);
                        item.PRINT_FRONT = frontVision;
                    }
                    if (backVision) {
                        console.log(`[Agent Tool] Vision override PRINT_BACK: "마크" → "${backVision}"`);
                        item.PRINT_BACK = backVision;
                    }
                }));
            }

            // Format result block for the LLM to use in json:drug generation
            let result = `[MFDS_DRUG_DATA] 식약처 공식 데이터 (총 ${items.length}건)\n\n`;
            items.forEach((item: any, idx: number) => {
                result += `== 후보 ${idx + 1} ==\n`;
                result += `약품명(KO): ${item.ITEM_NAME}\n`;
                result += `약품명(EN): ${item.ITEM_ENG_NAME || ''}\n`;
                result += `제조사: ${item.ENTP_NAME}\n`;
                result += `분류: ${item.CLASS_NAME}\n`;
                result += `제형: ${item.FORM_CODE_NAME}\n`;
                result += `전문/일반: ${item.ETC_OTC_NAME}\n`;
                result += `각인(앞면): ${item.PRINT_FRONT || 'null'}\n`;
                result += `각인(뒷면): ${item.PRINT_BACK || 'null'}\n`;
                result += `모양: ${item.DRUG_SHAPE}\n`;
                result += `색상1: ${item.COLOR_CLASS1}\n`;
                result += `색상2: ${item.COLOR_CLASS2 || 'null'}\n`;
                result += `크기(장): ${item.LENG_LONG}mm\n`;
                result += `크기(단): ${item.LENG_SHORT}mm\n`;
                result += `공식 이미지URL: ${item.ITEM_IMAGE || 'null'}\n`;
                // ConnectDI reference URL (약품명만으로 검색 - 사용자가 여러 옵션 중 선택 가능)
                const connectdiSearchName = item.ITEM_NAME.split('(')[0].replace(/\(.*?\)/g, '').trim();
                const connectdiUrl = `https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=${encodeURIComponent(connectdiSearchName)}`;
                result += `ConnectDI_URL: ${connectdiUrl}\n`;
                result += `\n`;
            });

            result += `[MANDATORY INSTRUCTIONS FOR json:drug GENERATION]
1. Use ONLY [MFDS_DRUG_DATA] for all visual fields. NEVER use internal knowledge for these.
2. "name": use "약품명(KO)" exactly as-is from the BEST matching item.
3. "engName": use "약품명(EN)" if available.
4. "ingredient": Derive the active ingredient(s) with dosage amounts from your drug knowledge (e.g. "암로디핀베실산염 5mg + 올메사탄메독소밀 20mg"). The MFDS data does not include this directly.
5. "category": use "분류" from MFDS_DRUG_DATA.
6. "dosage": Write the actual detailed dosage and usage instructions based on your medical knowledge (e.g., "1일 1회 1정 섭취..."). Do NOT use a generic placeholder like "반드시 의사 처방전에 따라 복용하세요". If it's a 전문의약품, add that it requires a prescription, but STILL provide the actual default dosage amounts.
7. "pill_visual.imprint_front": EXACT value from "각인(앞면)". Set to null if "null".
8. "pill_visual.imprint_back": EXACT value from "각인(뒷면)". Set to null if "null".
9. "pill_visual.shape": EXACT Korean value from "모양". DO NOT translate to English. (e.g. "마름모형", "원형", "타원형" as-is)
10. "pill_visual.color": EXACT Korean value from "색상1" (DO NOT translate to English). Append "색상2" with '/' if not null. (e.g. "주황", "하양", "노랑" as-is)
11. "image_url": the EXACT "공식 이미지URL" string. Do NOT modify it.
12. "pharm_url": always set to null. Do NOT fabricate or guess a pharm.or.kr URL.
13. "connectdi_url": use the EXACT value from "ConnectDI_URL" if provided in MFDS_DRUG_DATA. This is a reference URL for users to explore multiple options.
14. If multiple candidates exist, choose the one whose "약품명(KO)" EXACTLY matches the user's query (including dosage numbers like 5/20 vs 5/40).`;

            return result;

        } catch (e: any) {
            console.error("[Agent Tool] searchDrugInfoTool error:", e);
            return `식약처 API 조회 중 네트워크 오류가 발생했습니다: ${e.message}`;
        }
    },
    {
        name: "search_drug_info",
        description: `Search the official Korean Ministry of Food and Drug Safety (MFDS/식약처) database to get accurate, verified drug identification information including exact pill imprint codes, official images, shape, and color. Call this tool for ANY drug information request before generating a json:drug block.`,
        schema: z.object({
            drug_name: z.string().describe("The official Korean drug product name to search for. CRITICAL: Evaluate the user's input for any spelling typos (e.g., '엔' vs '앤', '래' vs '레') and AUTO-CORRECT the drug name to its official registered spelling (e.g., '엔지비드서방정' -> '앤지비드서방정', '타이래놀' -> '타이레놀') BEFORE calling this tool. Do not blindly pass misspelled names."),
        }),
    }
);
