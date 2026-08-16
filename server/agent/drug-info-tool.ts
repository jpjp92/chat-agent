import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { HumanMessage } from "@langchain/core/messages";
import { getNextApiKey } from "../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS } from "../models";
import { searchWebTool } from "./tools";

const MFDS_API_ENDPOINT = process.env.MFDS_API_ENDPOINT || '';
const MFDS_API_KEY = process.env.MFDS_API_KEY || '';

/**
 * 검색 leg의 결과. **`empty`(검색했는데 결과 없음)와 `unavailable`(검색이 실행조차 안 됨)을
 * 반드시 구분한다.** 예전에는 둘 다 `null`이라, 429로 검색이 안 돌았는데도
 * "검색해도 없다"로 처리돼 모델이 훈련 지식으로 제품명을 지어냈다(DEV_260815_DEPLOY_CHECK).
 */
export type DrugSearchUnavailable = { kind: 'quota' | 'error'; reason: string };

type DrugSearchOutcome =
    | { status: 'ok'; text: string }
    | { status: 'empty' }
    | ({ status: 'unavailable' } & DrugSearchUnavailable);

const isQuotaError = (e: any): boolean =>
    e?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(e?.message ?? '');

/**
 * MFDS에도 없고 웹 검색도 실패했을 때 모델에게 줄 지시문.
 *
 * 순수 함수로 빼 둔 이유: 이 문자열이 **환각의 직접 원인**이었기 때문이다.
 * 예전 판본은 "훈련 데이터의 의학 지식을 활용해 상세히 안내하세요. 절대로 '찾을 수 없습니다'라고
 * 답하지 마세요"였고, 429로 검색이 안 돈 턴에서 실존하지 않는 제품명이 나왔다
 * (오라메디 인공타액액 / Ortho-Saliva / 아쿠아 오랄 스프레이).
 * 시스템 프롬프트의 약 정보 방어(prompt.ts L280·L282)보다 툴 출력이 모델에 가까워서 이게 이겼다.
 *
 * 네트워크 없이 검사할 수 있어야 회귀가 잡힌다 → scripts/test-drug-fallback.mts
 *
 * 두 상황의 **어조를 다르게** 둔다. 이 문자열은 모델이 읽고 사용자에게 옮기는 프레임이라
 * 단정적으로 쓰면 그대로 단정적인 답변이 된다:
 *   · 할당량 소진 → 우리 쪽 사정이다. 그렇게 말한다("지금은 검색을 못 했다").
 *   · 결과 없음   → "쓸만한 게 없다"는 판단조가 아니라 "추가로 확인된 게 없다"는 사실 서술.
 *     검색에 안 걸렸다고 정보가 없는 것은 아니다.
 *
 * @param unavailable 검색이 **실행되지 못한** 사유. null이면 검색은 됐고 추가 정보가 없었다.
 */
export const buildDrugFallbackInstruction = (drugName: string, unavailable: DrugSearchUnavailable | null): string => {
    // 상표명은 검색으로만 확인 가능한 사실이다. 검색이 없으면 쓸 수 없다.
    const noBrandRule = `\n\n🔴 제품명·브랜드명·제조사는 **절대 나열하지 마세요.** 상표명은 검색으로만 확인되는 사실이며 지금은 확인할 수 없습니다. 사용자가 "대표 제품"을 물으면 제형(스프레이·젤·액상 등)별 분류로 답하고, 구체적 제품은 약사에게 확인하도록 안내하세요. 확인되지 않는 것은 모른다고 답해도 됩니다.`;

    const head = unavailable
        ? (unavailable.kind === 'quota'
            ? `[MFDS_NOT_FOUND] 식약처 알약식별 DB에 "${drugName}"이(가) 없고(비알약 제형 등), **웹 검색 할당량이 소진되어 이번 턴에는 검색을 수행하지 못했습니다.** 정보가 없는 것이 아니라 지금 조회를 못 한 상황입니다.`
            : `[MFDS_NOT_FOUND] 식약처 알약식별 DB에 "${drugName}"이(가) 없고(비알약 제형 등), **웹 검색을 수행하지 못했습니다** (${unavailable.reason}).`)
        : `[MFDS_NOT_FOUND] 식약처 알약식별 DB는 알약·정제만 관리하므로 "${drugName}"은(는) 등록 대상이 아닙니다 (파스·연고·크림·시럽·패치 등). 웹 검색에서는 추가로 확인된 정보가 없었습니다.`;

    return `${head}\n\n⚠️ CRITICAL INSTRUCTION: json:drug 블록을 생성하지 마세요. 일반적인 의학 지식 범위에서만 성분·효능·용법·주의사항을 마크다운(헤딩·불릿)으로 설명하세요.${noBrandRule}`;
};

/**
 * Uses Gemini SDK with Google Search grounding to retrieve drug info.
 * Called when MFDS returns no results (non-pill products like patches, ointments).
 */
async function searchDrugViaGoogleSearch(drugName: string): Promise<DrugSearchOutcome> {
    const apiKey = getNextApiKey();
    if (!apiKey) return { status: 'unavailable', kind: 'error', reason: 'API 키 없음' };
    try {
        const genai = new GoogleGenAI({ apiKey });
        const response = await genai.models.generateContent({
            model: DEFAULT_CHAT_MODEL,
            contents: [{ role: 'user', parts: [{ text: `${drugName} 의약품의 성분, 효능, 용법, 용량, 주의사항을 알려주세요.` }] }],
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.1,
            },
        });
        const text = response.text?.trim();
        if (!text || text.length < 50) return { status: 'empty' };

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
                return { status: 'ok', text: `${text}\n\n[WEB_SOURCE_URLS]\n${urlLines}` };
            }
        }
        // Fallback: if grounding chunks are empty but search queries exist, use a Google search URL
        const queries = gm?.webSearchQueries as string[] | undefined;
        if (queries && queries.length > 0) {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queries[0])}`;
            return { status: 'ok', text: `${text}\n\n[WEB_SOURCE_URLS]\n${searchUrl} | Google 검색: ${queries[0]}` };
        }
        return { status: 'ok', text };
    } catch (e: any) {
        console.error(`[Agent Tool] Google Search drug info error:`, e.message);
        // 쿼터 소진은 "결과 없음"이 아니다 — 검색이 아예 안 돌았다.
        return isQuotaError(e)
            ? { status: 'unavailable', kind: 'quota', reason: '웹 검색 할당량 소진(429)' }
            : { status: 'unavailable', kind: 'error', reason: (e?.message ?? 'unknown').slice(0, 80) };
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
            // 각인 1~2자 판독엔 3.5 품질 불필요 — 2.5-flash로 고정해 Vision fan-out(최대 10콜)
            // 지연을 복원한다. 기본 모델 3.5 전환(2026-05-30) 후 이 fan-out이 Vercel 60s를 초과해
            // drug_info 무응답이 발생했음.
            model: SERVER_MODELS.FLASH,
            apiKey: apiKey,
            // temperature 0: 로고형 각인이 실행마다 다른 글자로 흔들리던 비결정성 제거
            temperature: 0,
            // OCR은 토큰 1개만 출력 — thinking 불필요. budget 0으로 호출당 지연 최소화.
            thinkingConfig: { thinkingBudget: 0 },
        });

        const sideLabel = side === 'front' ? '앞면(왼쪽)' : '뒤면(오른쪽)';
        const prompt = `이 의약품 식별 사진의 ${sideLabel} 알약에 새겨진 각인을 판독하세요.

규칙:
- 명확하게 읽히는 숫자·알파벳·특수문자(-)만 보이는 그대로 대문자로 출력하세요.
- 회사 로고·도형·심볼처럼 글자가 아니거나, 어떤 문자인지 명확하지 않으면 절대 글자로 추측하지 말고 "마크"를 출력하세요. (방향에 따라 M/W처럼 달리 보이는 애매한 기호도 "마크")
- 각인이 전혀 없으면 "없음"을 출력하세요.
- 판독 결과만 출력하고, 설명이나 부가 텍스트는 절대 포함하지 마세요.`;

        const message = new HumanMessage({
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } }
            ]
        });

        const response = await model.invoke([message]);
        const text = typeof response.content === "string" ? response.content.trim() : "";

        // "없음"(각인 없음)·"마크"(로고/애매한 기호)는 override하지 않고 DB placeholder 유지.
        // 명확한 숫자·문자만 override해 "틀린 글자 단정"을 방지.
        if (!text || text === '없음' || text === '마크') return null;
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
                    items = await fetchMFDS(oldSpelling);
                }
            }

            if (!Array.isArray(items) || items.length === 0) {
                const notFoundPrefix = `[MFDS_NOT_FOUND] 식약처 알약식별 DB에 "${drug_name}"이(가) 없습니다 (파스·연고·크림·시럽 등 비알약 제형이거나 미등재).\n\n⚠️ CRITICAL INSTRUCTION: json:drug 블록을 생성하지 마세요. 아래 검색 결과를 바탕으로 성분·효능·용법을 마크다운(헤딩·불릿)으로 상세히 안내하세요. 응답 본문에 URL이나 출처는 포함하지 마세요.\n\n`;

                // 검색 leg가 "실행되지 못했는지"를 추적한다 — 결과 없음과 다르게 다뤄야 한다.
                let searchUnavailable: DrugSearchUnavailable | null = null;

                // 1st: Google Search grounding (most reliable)
                const googleResult = await searchDrugViaGoogleSearch(drug_name);
                if (googleResult.status === 'ok') {
                    return notFoundPrefix + googleResult.text;
                }
                if (googleResult.status === 'unavailable') searchUnavailable = { kind: googleResult.kind, reason: googleResult.reason };

                // 2nd: DuckDuckGo fallback
                try {
                    const webResult = await searchWebTool.invoke({ query: `${drug_name} 성분 효능 용법 용량` });
                    if (webResult.includes('오류가 발생했습니다')) {
                        searchUnavailable = searchUnavailable ?? { kind: 'error', reason: 'DuckDuckGo 오류' };
                    } else if (!webResult.includes('웹 검색 결과가 없습니다')) {
                        return notFoundPrefix + webResult;
                    }
                } catch (e: any) {
                    searchUnavailable = searchUnavailable ?? { kind: 'error', reason: (e?.message ?? 'DuckDuckGo 예외').slice(0, 80) };
                }

                // ── 3rd: 검색이 전부 실패했다 (지시문은 buildDrugFallbackInstruction 참조) ──
                if (searchUnavailable) {
                    console.warn(`[Agent Tool] Drug search unavailable for "${drug_name}": ${searchUnavailable.kind} — ${searchUnavailable.reason}`);
                }
                return buildDrugFallbackInstruction(drug_name, searchUnavailable);
            }

            // For each item, if imprint is "마크" on front or back, use Gemini Vision to read it
            const MARK_VALUES = ['마크', '마크(로고)', 'mark', 'MARK', '각인'];
            const needsVision = items.some((item: any) => {
                const front = typeof item.PRINT_FRONT === 'string' ? item.PRINT_FRONT.trim() : '';
                const back = typeof item.PRINT_BACK === 'string' ? item.PRINT_BACK.trim() : '';
                return MARK_VALUES.includes(front) || MARK_VALUES.includes(back);
            });

            if (needsVision) {
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
                result += `품목일련번호(ITEM_SEQ): ${item.ITEM_SEQ || 'null'}\n`;
                // nedrug 식약처 공식 상세 페이지 직링크
                const mfdsDetailUrl = item.ITEM_SEQ
                    ? `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${item.ITEM_SEQ}`
                    : 'null';
                result += `MFDS_DETAIL_URL: ${mfdsDetailUrl}\n`;
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
13. "mfds_url": use the EXACT value from "MFDS_DETAIL_URL" if provided in MFDS_DRUG_DATA. This is the official 식약처 nedrug detail page link for the "자세히" button. Set to null if "null".
14. "connectdi_url": use the EXACT value from "ConnectDI_URL" if provided in MFDS_DRUG_DATA. This is a source chip reference URL.
15. If multiple candidates exist, choose the one whose "약품명(KO)" EXACTLY matches the user's query (including dosage numbers like 5/20 vs 5/40).`;

            return result;

        } catch (e: any) {
            console.error("[Agent Tool] searchDrugInfoTool error:", e);
            return '식약처 API 조회 중 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
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
