import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { getNextApiKey } from "../config.js";

const MFDS_API_ENDPOINT = process.env.MFDS_API_ENDPOINT || '';
const MFDS_API_KEY = process.env.MFDS_API_KEY || '';

/**
 * Uses Gemini Vision to read actual imprint text from an MFDS drug image.
 * Called when MFDS API returns "마크" (logo) instead of actual text.
 */
async function extractImprintViaVision(imageUrl: string, side: 'front' | 'back'): Promise<string | null> {
    try {
        const apiKey = getNextApiKey();
        if (!apiKey) return null;

        // Download the image
        const imgRes = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'curl/8.5.0',
                'Referer': 'https://nedrug.mfds.go.kr/',
            }
        });
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
 * Perform a background fetch to pharm.or.kr to resolve the idx for the given exact drug name.
 */
async function getPharmOrKrDetailUrl(drugName: string): Promise<string | null> {
    const body = new URLSearchParams({
        s_anal: '',
        s_anal_flag: '0',
        _page: '1',
        s_drug_name: drugName,
        s_upso_name: '',
        s_upso_name2: '',
        s_mark_code: '',
        s_drug_form_etc: '',
        s_drug_shape_etc: '',
        new_sb_name1: '',
        new_sb_name2: '',
    });

    try {
        const res = await fetch('https://www.pharm.or.kr/search/drugidfy/list.asp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://www.pharm.or.kr/search/drugidfy/search.asp',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            body: body.toString()
        });

        if (!res.ok) return null;

        const html = await res.text();
        if (html.includes('검색결과가 없') || !html.includes('change_bgcolor')) return null;

        // Extract rows
        const rowBlocks = html.split(/<tr\s+onmouseover="change_bgcolor/i).slice(1);
        if (rowBlocks.length === 0) return null;

        // Try to find the exact match (or contains match) to avoid selecting "다파진정5mg" when "다파진정10mg" is requested
        let matchIdx = null;
        for (const block of rowBlocks) {
            const rowHtml = '<tr onmouseover="change_bgcolor' + block;
            const nameMatch = rowHtml.match(/<!--품목명[\s\S]*?-->([\s\S]*?)<!--신청사/i);
            const verifiedName = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim() : '';

            if (verifiedName === drugName || verifiedName.includes(drugName)) {
                const m = rowHtml.match(/show\.asp\?idx=(\d+)/);
                if (m) {
                    matchIdx = m[1];
                    break;
                }
            }
        }

        // if not found by exact string, fallback to the very first result found
        if (!matchIdx) {
            const match = rowBlocks[0].match(/show\.asp\?idx=(\d+)/);
            if (match && match[1]) matchIdx = match[1];
        }

        if (matchIdx) {
            return `https://www.pharm.or.kr/search/drugidfy/show.asp?idx=${matchIdx}`;
        }
        return null;
    } catch {
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

            // 1. Kick off Pharm.or.kr search IMMEDIATELY in the background (Parallel processing)
            const pharmUrlPromise = getPharmOrKrDetailUrl(drug_name);

            // MFDS Search Helper
            const fetchMFDS = async (nameToSearch: string) => {
                const encodedName = encodeURIComponent(nameToSearch);
                const url = `${MFDS_API_ENDPOINT}?serviceKey=${MFDS_API_KEY}&numOfRows=5&pageNo=1&type=json&item_name=${encodedName}`;
                const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0', 'Referer': 'https://www.data.go.kr' } });
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
                // Strategy 3: Base name only as fallback (e.g. "딜라트렌정")
                const baseNameMatch = drug_name.match(/^([가-힣a-zA-Z]+)/);
                if (baseNameMatch && baseNameMatch[1] && baseNameMatch[1] !== searchName) {
                    searchName = baseNameMatch[1];
                    console.log(`[Agent Tool] MFDS Strategy 3 (Base name): ${searchName}`);
                    items = await fetchMFDS(searchName);
                }
            }

            if (!Array.isArray(items) || items.length === 0) {
                return `식약처 DB에서 "${drug_name}"에 해당하는 약품 정보를 찾지 못했습니다.`;
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

            // Resolve the parallel Pharm.or.kr fetch
            let pharmUrl = await pharmUrlPromise;
            if (!pharmUrl && items.length > 0) {
                // Fallback to the first MFDS candidate's name, stripped of generic name part
                const baseName = items[0].ITEM_NAME.split('(')[0].trim();
                pharmUrl = await getPharmOrKrDetailUrl(baseName);
            }
            if (pharmUrl) {
                console.log(`[Agent Tool] Found Pharm URL: ${pharmUrl}`);
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
                if (pharmUrl) {
                    result += `Pharm_URL: ${pharmUrl}\n`;
                }
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
12. "pharm_url": use the EXACT value from "Pharm_URL" if provided in MFDS_DRUG_DATA.
13. If multiple candidates exist, choose the one whose "약품명(KO)" EXACTLY matches the user's query (including dosage numbers like 5/20 vs 5/40).`;

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
