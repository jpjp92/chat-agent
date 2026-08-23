import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { HumanMessage } from "@langchain/core/messages";
import {
    API_KEYS,
    getNextApiKey,
    isDailyQuotaError,
    markKeyDailyExhausted,
    markKeyRateLimited,
} from "../config";
import { SERVER_MODELS } from "../models";
import { searchWebTool } from "./tools";
import {
    buildDrugFallbackInstruction,
    shouldQueryMfdsProductDatabase,
    type DrugSearchUnavailable,
} from "./drug-fallback-policy";

export { buildDrugFallbackInstruction } from "./drug-fallback-policy";
export type { DrugQueryKind, DrugSearchUnavailable } from "./drug-fallback-policy";

const MFDS_API_ENDPOINT = process.env.MFDS_API_ENDPOINT || '';
const MFDS_API_KEY = process.env.MFDS_API_KEY || '';

/**
 * 검색 leg의 결과. **`empty`(검색했는데 결과 없음)와 `unavailable`(검색이 실행조차 안 됨)을
 * 반드시 구분한다.** 예전에는 둘 다 `null`이라, 429로 검색이 안 돌았는데도
 * "검색해도 없다"로 처리돼 모델이 훈련 지식으로 제품명을 지어냈다(DEV_260815_DEPLOY_CHECK).
 */
// 약품 웹 검색은 무료티어 Google Search가 실제로 동작하는 2.5 Flash로 고정한다.
// DEFAULT_CHAT_MODEL(현재 3.6)은 MODEL_CAPS상 freeTierSearch=false라 이 fallback에서 429가 난다.
export const DRUG_SEARCH_MODEL = SERVER_MODELS.FLASH;

type DrugSearchOutcome =
    | { status: 'ok'; text: string }
    | { status: 'empty' }
    | ({ status: 'unavailable' } & DrugSearchUnavailable);

const isQuotaError = (e: any): boolean =>
    e?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(e?.message ?? '');

/**
 * Uses Gemini SDK with Google Search grounding to retrieve drug info.
 * Called for ingredient/class questions and when an MFDS product lookup has no result.
 */
async function searchDrugViaGoogleSearch(drugName: string): Promise<DrugSearchOutcome> {
    if (API_KEYS.length === 0) {
        return { status: 'unavailable', kind: 'error', reason: 'API 키 없음' };
    }
    const attemptedKeys = new Set<string>();
    let lastQuotaReason = '웹 검색 할당량 소진(429)';

    while (attemptedKeys.size < API_KEYS.length) {
        const apiKey = getNextApiKey();
        if (!apiKey || attemptedKeys.has(apiKey)) break;
        attemptedKeys.add(apiKey);

        try {
            const genai = new GoogleGenAI({ apiKey });
            const response = await genai.models.generateContent({
                model: DRUG_SEARCH_MODEL,
                contents: [{ role: 'user', parts: [{ text: `사용자 입력 "${drugName}"은 오타나 음역 차이가 있을 수 있습니다. 검색 결과를 근거로 대한민국 허가 문서의 공식 한글 성분명을 먼저 확인하고, 허가된 주요 효능과 핵심 안전성 정보를 정리하세요. 입력과 공식 명칭이 다르면 둘의 관계를 명시하세요. 적응증별 정확한 용량은 근거에서 명확히 확인되는 경우에만 포함하세요.` }] }],
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
            if (!isQuotaError(e)) {
                return { status: 'unavailable', kind: 'error', reason: (e?.message ?? 'unknown').slice(0, 80) };
            }

            lastQuotaReason = '웹 검색 할당량 소진(429)';
            if (isDailyQuotaError(e)) markKeyDailyExhausted(apiKey);
            else markKeyRateLimited(apiKey);
        }
    }

    return { status: 'unavailable', kind: 'quota', reason: lastQuotaReason };
}

/** Google grounding과 DDG를 순서대로 조회하되, 일부 검색이 실제 실행됐다면 전체 장애로 과장하지 않는다. */
async function searchDrugReferences(drugName: string): Promise<DrugSearchOutcome> {
    let aSearchCompleted = false;
    let unavailable: DrugSearchUnavailable | null = null;

    const googleResult = await searchDrugViaGoogleSearch(drugName);
    if (googleResult.status === 'ok') return googleResult;
    if (googleResult.status === 'empty') aSearchCompleted = true;
    if (googleResult.status === 'unavailable') {
        unavailable = { kind: googleResult.kind, reason: googleResult.reason };
    }

    try {
        const webResult = await searchWebTool.invoke({ query: `${drugName} 대한민국 공식 성분명 허가사항 효능 주의사항` });
        if (webResult.includes('오류가 발생했습니다')) {
            unavailable = unavailable ?? { kind: 'error', reason: 'DuckDuckGo 오류' };
        } else if (webResult.includes('웹 검색 결과가 없습니다')) {
            aSearchCompleted = true;
        } else {
            return { status: 'ok', text: webResult };
        }
    } catch (e: any) {
        unavailable = unavailable ?? { kind: 'error', reason: (e?.message ?? 'DuckDuckGo 예외').slice(0, 80) };
    }

    return aSearchCompleted
        ? { status: 'empty' }
        : { status: 'unavailable', ...(unavailable ?? { kind: 'error' as const, reason: '검색 공급자 사용 불가' }) };
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
    async ({ drug_name, query_kind }) => {
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

            // 성분명·약물계열 질문은 제품명(item_name) 전용인 MFDS 알약식별 DB를 조회하지 않는다.
            // 성분명이나 음역 변형을 제품 미등재로 오판해 불필요한 실패 안내를 붙이지 않는다.
            let searchName = drug_name.replace(/\s/g, '');
            let items: any[] = [];
            if (shouldQueryMfdsProductDatabase(query_kind)) {
                // Strategy 1: Spaceless original input (Works for "딜라트렌정25mg")
                items = await fetchMFDS(searchName);
            }

            if (shouldQueryMfdsProductDatabase(query_kind) && (!Array.isArray(items) || items.length === 0)) {
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

            if (shouldQueryMfdsProductDatabase(query_kind) && (!Array.isArray(items) || items.length === 0)) {
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
                const evidencePrefix = query_kind === 'product'
                    ? `[MFDS_NOT_FOUND] "${drug_name}"의 정확한 제품 레코드를 식약처 알약식별 DB에서 확인하지 못했습니다. json:drug 블록을 생성하지 말고 아래 외부 검색 근거만 사용해 마크다운으로 설명하세요. 내부 조회 상태를 사용자에게 설명하지 마세요.\n\n`
                    : `[DRUG_REFERENCE_DATA] "${drug_name}"은 제품명 조회가 아닌 성분명 또는 약물 계열 질문입니다. json:drug 블록을 생성하지 말고 아래 외부 검색 근거로 일반 의학 정보를 마크다운으로 설명하세요. 국내 공식 표기가 사용자 표현과 다르면 첫 문장에서 짧게 교정하세요. 사용자가 용량을 묻지 않았다면 적응증별 세부 용량을 나열하지 마세요.\n\n`;

                const referenceResult = await searchDrugReferences(drug_name);
                if (referenceResult.status === 'ok') {
                    return evidencePrefix + referenceResult.text;
                }

                const searchUnavailable = referenceResult.status === 'unavailable'
                    ? { kind: referenceResult.kind, reason: referenceResult.reason }
                    : null;
                if (searchUnavailable) {
                    console.warn(`[Agent Tool] Drug search unavailable for "${drug_name}": ${searchUnavailable.kind} — ${searchUnavailable.reason}`);
                }
                return buildDrugFallbackInstruction(drug_name, searchUnavailable, query_kind);
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
        description: `Look up drug information. Set query_kind="product" only for a specific marketed product/trade name (for example 타이레놀정500mg or 린버크서방정) so the tool can query the MFDS pill database and generate a verified product card. Set query_kind="ingredient_or_class" for an active ingredient, generic substance, mechanism, or drug class (for example 아세트아미노펜 or JAK 억제제); this skips product identification and searches for official terminology and general reference data without a product card. Preserve a possibly misspelled ingredient term so the search evidence, rather than model memory, determines its official spelling.`,
        schema: z.object({
            drug_name: z.string().describe("The Korean drug product name, active ingredient, generic substance, or drug class to look up. For query_kind=product, correct spelling to the official marketed product name before calling. For query_kind=ingredient_or_class, preserve the recognized ingredient/class name rather than inventing a product name."),
            query_kind: z.enum(['product', 'ingredient_or_class']).describe('Whether drug_name is a specific marketed product name or an active ingredient/drug class. This field is required.'),
        }),
    }
);
