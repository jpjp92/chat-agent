import { AgentStateType } from "../state";
import { type LangName, pickByLang } from "../lang";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getNextApiKey, markKeyInvalid, API_KEYS } from "../../config";
import { SERVER_MODELS, isThreeXFlash } from "../../models";
import { identifyPillTool, searchWebTool } from "../tools";
import { searchDrugInfoTool } from "../drug-info-tool";
import { pharmacyTool } from "../pharmacy-tool";
import { hospitalTool } from "../hospital-tool";
import { vetTool } from "../vet-tool";
import { lawTool } from "../law-tool";
import { movieTool } from "../movie-tool";
import { weatherTool } from "../weather-tool";
import { paperTool } from "../paper-tool";
import { arxivTool } from "../arxiv-tool";
import { cardHasResults, pinCardToProse } from "../card-tool-output";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { pillNoMatchMessage, pillLookupErrorMessage, extractPillMatchType, pillCandidateTableMessage, shouldTryPillWebFallback, buildPillWebQuery } from "./pill-messages";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";
import { shouldAddWebSearchToPaperFollowup } from "../search-signals";

// LangChain 호출 1회 상한 — 행(fetch 끊김 시 ~5분) 방지. 25s 넘게 무응답이면 끊고 키 로테이션으로 넘긴다.
const LC_CALL_TIMEOUT_MS = 25_000;

/**
 * LangChain 생성 경로.
 *
 * 로컬 도구가 필요한 인텐트(useLangChain=true)이거나, SDK 경로가 완전히 실패한 뒤의
 * 비스트리밍 폴백(sdkSuccess=false)일 때 들어온다. 처리하는 것:
 * SDK 실패 시 YouTube 가드, fast-pass 카드 우회, 약 직접 조회, 도구
 * 바인딩 + 호출, 키 로테이션 재시도.
 *
 * 제어 흐름은 전부 종단이다: 모든 분기가 `{ messages }` 를 반환하거나 throw 하므로
 * 호출부는 `return await runLangChainPath(...)` 로 부른다.
 *
 * `finalInstruction` 은 여기서만 바뀐다(약 직접 조회가 DB 결과를 붙임).
 * 호출부는 이후 읽지 않으므로 따로 반환하지 않는다.
 */
export const runLangChainPath = async (args: {
    state: AgentStateType;
    finalInstruction: string;
    resolvedModel: string;
    apiKey: string;
    systemInstructionBase: string;
    useLangChain: boolean;
    sdkSuccess: boolean;
    isYoutubeRequest: boolean;
    hasVideoData: boolean;
    langName: LangName;
}): Promise<{ messages: any[] }> => {
    const { state, resolvedModel, apiKey, useLangChain, sdkSuccess, isYoutubeRequest, hasVideoData, langName } = args;
    let finalInstruction = args.finalInstruction;

    // LangChain 경로: drug_id·drug_info 인텐트는 커스텀 DB/식별 도구가 필요하다.
    // 참고: 약 외 인텐트에선 SDK 가 완전히 실패했을 때의 비스트리밍 폴백이다.
    if (!useLangChain && !sdkSuccess) {
        console.error('[LangGraph] SDK path failed for intent:', state.intent, '— falling back to LangChain (no streaming)');
        // YouTube 영상 분석은 LangChain 이 지원하지 않는 fileData 를 쓴다.
        // 그대로 내려가면 실제 영상 요약이 아니라 지어낸 내용이 나온다.
        // 잘못된 내용 대신 다시 시도하라는 분명한 오류 문구를 돌려준다.
        if (isYoutubeRequest && hasVideoData) {
            // 언어는 langName 으로 직접 받는다(server/agent/lang.ts) — 시스템 프롬프트 본문에서 역추출하지 않는다.
            const YT_ERR: Record<LangName, string> = {
                Korean:  'YouTube 영상 분석 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.',
                English: 'YouTube video analysis is temporarily unavailable. Please try again in a moment.',
                Spanish: 'El análisis de video de YouTube no está disponible temporalmente. Por favor, inténtelo de nuevo en un momento.',
                French:  'L\'analyse vidéo YouTube est temporairement indisponible. Veuillez réessayer dans un instant.',
            };
            return { messages: [new AIMessage(pickByLang(YT_ERR, langName))] };
        }
    }
    let lcApiKey = getNextApiKey() ?? apiKey;
    let lcAttempt = 0;

    while (lcAttempt < API_KEYS.length) {
        try {
            // 모델 선택 원칙: LangChain 경로 인텐트는 전부 외부 API 도구 기반(MFDS·약국·병원·동물병원·
            // 법령·영화)이라 핵심은 API 데이터지 모델 추론이 아니다 → 빠른 2.5-flash 를 쓴다.
            // (느린 기본 모델로 돌리면 도구 응답 전반이 느려진다 → DEV_260530)
            //   · fast-pass(출력 폐기, 카드=툴 JSON): thinking 완전 off(budget 0) — 순수 tool-router.
            //   · drug_info/drug_id(카드·산문 합성): 2.5 기본 thinking 유지.
            //   · 비-도구 호출(=SDK 완전 실패 폴백)만 resolvedModel 보존, 3.x 면 thinking LOW 캡.
            const FAST_PASS_INTENTS = new Set(["pharmacy_search", "hospital_search", "vet_search", "movie_search", "law_search", "weather"]);
            const SYNTH_TOOL_INTENTS = new Set(["drug_id", "drug_info", "law_qa", "paper_search", "arxiv_search"]);
            // 산문은 모델이, 카드는 도구 출력이 그대로 간다.
            const PINNED_CARD_INTENTS = { paper_search: "paper", arxiv_search: "paper" } as const;
            const isToolIntent = FAST_PASS_INTENTS.has(state.intent) || SYNTH_TOOL_INTENTS.has(state.intent);
            const pathModel = isToolIntent ? SERVER_MODELS.FLASH : resolvedModel;
            const is3xLcModel = isThreeXFlash(pathModel);
            console.log(`[LangGraph] LangChain path: intent=${state.intent} → model=${pathModel}${isToolIntent ? ' (tool intent)' : ''}`);
            const llm = new ChatGoogleGenerativeAI({
                model: pathModel,
                apiKey: lcApiKey,
                ...(is3xLcModel
                    ? { thinkingConfig: { thinkingLevel: "LOW" as const } }
                    : { temperature: 0.2, topP: 0.8, topK: 40, ...(FAST_PASS_INTENTS.has(state.intent) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }),
                // 약 카드 JSON 은 짧다 — 8192 면 충분하고 생성 시간도 줄인다
                maxOutputTokens: 8192,
                maxRetries: 0,
            });

            // Fast-pass: 약국·병원 도구 등이 성공했으면 최종 LLM 생성을 건너뛴다
            const lastMsg = state.messages[state.messages.length - 1];
            // 논문 종합 단계 웹검색 판정용 — 최신 human 발화. ToolMessage 이후에는 lastMsg 가
            // 도구 결과라 마지막 메시지로는 사용자의 요청을 알 수 없다.
            const latestUserTextForTools = (() => {
                const h = [...state.messages].reverse().find((m: any) => m._getType() === 'human');
                if (!h) return '';
                return Array.isArray(h.content)
                    ? (h.content as any[]).filter((p: any) => p?.type === 'text').map((p: any) => p.text ?? '').join('')
                    : String(h.content ?? '');
            })();
            if (state.intent === "drug_id" && lastMsg._getType() === "tool" && lastMsg.name === "identify_pill") {
                const toolContent = (() => {
                    if (typeof lastMsg.content === 'string') return lastMsg.content;
                    if (Array.isArray(lastMsg.content)) return (lastMsg.content as any[]).map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
                    return '';
                })();
                if (toolContent.includes('약학정보원 DB에서 일치하는 약품을 찾지 못했습니다')) {
                    console.log('[LangGraph] Fast-passing identify_pill no-match result');
                    return {
                        messages: [new AIMessage(pillNoMatchMessage(state.pillData))]
                    };
                }
                if (toolContent.includes('약학정보원 DB 조회 중 오류가 발생했습니다')) {
                    console.log('[LangGraph] Fast-passing identify_pill lookup-error result');
                    return {
                        messages: [new AIMessage(pillLookupErrorMessage)]
                    };
                }
            }
            if (state.intent === "pharmacy_search" && lastMsg._getType() === "tool" && lastMsg.name === "pharmacyTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:pharmacy') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing pharmacyTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }
            if (state.intent === "hospital_search" && lastMsg._getType() === "tool" && lastMsg.name === "hospitalTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:hospital') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing hospitalTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }
            if (state.intent === "vet_search" && lastMsg._getType() === "tool" && lastMsg.name === "vetTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:vet') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing vetTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }
            if (state.intent === "law_search" && lastMsg._getType() === "tool" && lastMsg.name === "lawTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:law') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing lawTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }
            if (state.intent === "movie_search" && lastMsg._getType() === "tool" && lastMsg.name === "movieTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:movie') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing movieTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }
            if (state.intent === "weather" && lastMsg._getType() === "tool" && lastMsg.name === "weatherTool") {
                const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (toolContent.includes('```json:weather') && cardHasResults(toolContent)) {
                    console.log('[LangGraph] Fast-passing weatherTool: Bypassing final LLM generation');
                    return { messages: [new AIMessage("")] };
                }
            }

            let directPillLookupDone = false;
            if (state.intent === "drug_id" && state.pillData && lastMsg._getType() !== "tool") {
                console.log('[LangGraph] Direct identify_pill lookup from vision data');
                const pillLookupResult = await identifyPillTool.invoke({
                    imprint_front: state.pillData.imprint_front ?? "",
                    imprint_back: state.pillData.imprint_back ?? "",
                    color: state.pillData.color ?? "",
                    shape: state.pillData.shape ?? "",
                });
                const pillLookupText = (() => {
                    if (typeof pillLookupResult === 'string') return pillLookupResult;
                    // LangChain 이 ToolMessage 객체를 돌려줄 수 있다 — .content 추출
                    const c = (pillLookupResult as any)?.content;
                    if (typeof c === 'string') return c;
                    if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
                    return String(pillLookupResult ?? '');
                })();
                directPillLookupDone = true;

                if (pillLookupText.includes('약학정보원 DB에서 일치하는 약품을 찾지 못했습니다')) {
                    console.log('[LangGraph] Direct identify_pill no-match result');
                    return { messages: [new AIMessage(pillNoMatchMessage(state.pillData))] };
                }
                if (pillLookupText.includes('약학정보원 DB 조회 중 오류가 발생했습니다')) {
                    console.log('[LangGraph] Direct identify_pill lookup-error result');
                    return { messages: [new AIMessage(pillLookupErrorMessage)] };
                }
                const pillMatchType = extractPillMatchType(pillLookupText);
                if (pillMatchType && pillMatchType !== 'exact') {
                    // ── 웹 폴백 ──────────────────────────────────────────────────
                    // 각인을 읽었는데 식약처 DB 에 없을 때만. 식약처는 각인 텍스트를 8.7% 만
                    // 제공하지만 웹(약학정보원·드러그인포)은 각인으로 색인돼 있다 →
                    // **그 필드에 한해 더 나은 소스**로 간다. pill-messages.ts 상단 주석 참조.
                    //
                    // 모델에 검색 **도구**를 주지 않는다. `allTools` 가 `directPillLookupDone`
                    //    일 때 `[]` 인 이유가 generator → search → generator 재귀 방지이므로,
                    //    검색은 여기서 **결정론적으로** 한 번 돌리고 결과만 넘긴다.
                    let pillWebText = '';
                    // 각 경계마다 로그를 남긴다 — 게이트에서 막힌 건지 검색이 빈 건지
                    //    구분되지 않으면 "웹 폴백이 안 된다"는 관측만 남고 원인을 못 좁힌다.
                    const willSearch = shouldTryPillWebFallback(pillMatchType, state.pillData);
                    console.log('[LangGraph] Pill web fallback gate:', JSON.stringify({
                        matchType: pillMatchType,
                        imprint_front: state.pillData?.imprint_front ?? null,
                        imprint_back: state.pillData?.imprint_back ?? null,
                        willSearch,
                    }));
                    if (willSearch) {
                        const q = buildPillWebQuery(state.pillData);
                        try {
                            const r = await searchWebTool.invoke({ query: q });
                            const t = typeof r === 'string' ? r : String((r as any)?.content ?? '');
                            console.log('[LangGraph] Pill web fallback search:', JSON.stringify({
                                q, len: t.length, hasUrl: /https?:\/\//.test(t), head: t.slice(0, 120),
                            }));
                            // 출처 URL 이 없는 결과는 쓰지 않는다 — 근거 없이 약 이름을 말하면
                            // 그게 정확히 "시각적 유사성을 기반으로…" 날조 자리다.
                            if (t && /https?:\/\//.test(t)) pillWebText = t;
                            else console.log('[LangGraph] Pill web fallback: 출처 URL 없는 결과 — 폐기');
                        } catch (e: any) {
                            console.warn('[LangGraph] Pill web fallback 실패:', e?.message);
                        }
                    }

                    if (!pillWebText) {
                        console.log('[LangGraph] Direct identify_pill non-exact result:', pillMatchType);
                        return { messages: [new AIMessage(pillCandidateTableMessage(state.pillData, pillMatchType, pillLookupText))] };
                    }

                    // 웹 결과가 있으면 즉시 반환하지 않고 모델이 종합하게 한다.
                    // ①(문구 정직성)이 여기서 무너지지 않도록 **말해야 할 사실을 규칙으로 못 박는다.**
                    console.log('[LangGraph] Pill web fallback engaged:', pillMatchType);
                    finalInstruction += `\n\n[MFDS_IMPRINT_NOT_FOUND]\n`
                        + `사용자 알약의 각인은 "${(state.pillData?.imprint_front ?? '').trim()}" 이고, 식품의약품안전처 DB 에서 이 각인으로 등록된 약품을 찾지 못했다.\n`
                        + `식약처 DB 는 전체 품목의 약 8.7% 에만 각인 텍스트를 제공한다(정보 부재이지 무각인이 아니다).\n\n`
                        + `[MFDS_COLOR_SHAPE_CANDIDATES]\n${pillLookupText}\n\n`
                        + `[PROVIDED_WEB_DATA]\n${pillWebText}\n\n`
                        + `[DRUG_ID_WEB_FALLBACK_RULES]\n`
                        + `- 첫 문장에서 반드시 밝힐 것: 식약처 DB 에서 해당 각인을 찾지 못했고, 아래는 웹 검색 결과라는 사실.\n`
                        + `- 약품명을 제시할 때는 반드시 [PROVIDED_WEB_DATA] 의 출처 링크를 함께 달 것. 링크를 댈 수 없는 약품명은 쓰지 말 것.\n`
                        + `- [PROVIDED_WEB_DATA] 에 근거가 없으면 "웹에서도 확정하지 못했다"고 말할 것. 학습 지식으로 채우지 말 것.\n`
                        + `- 시각적 유사성이나 추측으로 약품명을 만들어내지 말 것.\n`
                        + `- [MFDS_COLOR_SHAPE_CANDIDATES] 는 각인을 쓰지 않은 색상·모양 기준 참고 후보다. 각인 기준 결과인 것처럼 쓰지 말 것.\n`
                        + `- json:drug 카드는 만들지 말 것.\n`
                        + `- 마지막에 약사 또는 의사 확인을 권고할 것.\n`;
                    directPillLookupDone = true;
                }

                finalInstruction += `\n\n[IDENTIFY_PILL_DATABASE_RESULT]\n${pillLookupText}\n\n[DRUG_ID_RESPONSE_RULES]\n- Do NOT include or reproduce the raw vision extraction JSON.\n- Use the database result above as the only source for the pill candidate list.\n- Generate a json:drug card ONLY when match_type is exact.`;
            }

            let allTools: any[] = [];
            if (state.intent === "drug_id") {
                // 약 이미지 식별은 위에서 이미 결정론 DB 조회를 했다.
                // 여기서 도구를 더 노출하지 않는다 — 그러면 모델이
                // generator → 검색/식별 도구 → generator 재귀에 빠질 수 있다.
                allTools = directPillLookupDone ? [] : [identifyPillTool, searchWebTool];
            } else if (state.intent === "drug_info") {
                allTools = [searchDrugInfoTool, searchWebTool];
            } else if (state.intent === "pharmacy_search") {
                allTools = [pharmacyTool];
            } else if (state.intent === "hospital_search") {
                allTools = [hospitalTool];
            } else if (state.intent === "vet_search") {
                allTools = [vetTool];
            } else if (state.intent === "law_search" || state.intent === "law_qa") {
                allTools = [lawTool];
            } else if (state.intent === "movie_search") {
                allTools = [movieTool];
            } else if (state.intent === "paper_search" || state.intent === "arxiv_search") {
                // 조회는 논문 도구 **단독·강제**로 끝내고, ToolMessage 이후 종합 단계에서만 웹 검색을 더한다.
                // 1차에 둘 다 주면 아래 forceDomainTool(allTools.length===1)이 풀려 모델이 논문 도구를 안 부를 수 있다.
                // OpenAI 의 withExplicitSearchFollowup 과 같은 구조 — 라우터가 미끄러져도 사용자의 명시 검색 요청이
                // 사라지지 않게 하는 2차 방어다 → DEV_260902 §9.3
                const paperCardTool = state.intent === "paper_search" ? paperTool : arxivTool;
                allTools = shouldAddWebSearchToPaperFollowup(state.intent, lastMsg._getType() === 'tool', latestUserTextForTools)
                    ? [paperCardTool, searchWebTool]
                    : [paperCardTool];
            } else if (state.intent === "weather") {
                allTools = [weatherTool];
            }

            // 로컬 카드 intent의 첫 턴은 반드시 해당 도구를 호출한다. 자동 선택에 맡기면
            // Gemini가 도로명 검색처럼 실제로 지원하는 요청도 자체 판단으로 거절할 수 있다.
            // ToolMessage 이후에는 강제하지 않아 law_qa 같은 합성 경로의 재귀 호출을 막는다.
            const forceDomainTool = isToolIntent && allTools.length === 1 && lastMsg._getType() !== 'tool';
            const llmWithTools = allTools.length === 0
                ? llm
                : llm.bindTools(allTools, forceDomainTool
                    ? { tool_choice: allTools[0].name, allowedFunctionNames: [allTools[0].name] }
                    : undefined);

            // 약 이미지 요청은 vision 노드가 전처리한다. 원본 이미지를 LangChain 도구 경로에
            // 다시 넘기지 않는다: 3.x 가 시각 추출을 다시 돌려 identify_pill 을 부르는 대신
            // 원문 JSON 을 스트리밍할 수 있다.
            const safeMessages = state.messages.map((msg: any) => {
                if (msg._getType() === 'human' && Array.isArray(msg.content)) {
                    const safeParts = (msg.content as any[]).filter((p: any) =>
                        p.type === 'text' || (state.intent !== 'drug_id' && p.type === 'image_url')
                    );
                    if (safeParts.length === msg.content.length) return msg;
                    return new HumanMessage({ content: safeParts.length > 0 ? safeParts : [{ type: 'text', text: '' }] });
                }
                return msg;
            });

            // `[ACTIVE_WEB_SEARCH]` 를 여기 붙이지 않는다 — 붙이면 지시가 정면으로 반대가 된다.
            //
            // SDK(Gemini 직접)·OpenAI 경로는 `withSearchProviderInstruction()` 으로 그 블록을 덧붙이지만,
            // 이 경로의 검색은 hosted 기능이 아니라 **바인딩된 함수 `search_web`**(DuckDuckGo)다.
            // `SEARCH_PROVIDER_PROFILES` 에 그 프로필이 없어 고르면 `'none'` → `enabled=false` 가 되고,
            // base 의 `[TOOL AVAILABILITY]` 가 "도구 호출을 하지 마라"가 되는데 이 경로는 바로 그 도구를
            // 부르라고 바인딩된(단일 도구 1차 턴은 `tool_choice` 로 강제) 경로다.
            //
            // 블록 없이도 인용 마커 출력·0건 턴 무날조가 정상임을 확인했다 → DEV_260928 §9-1
            // 붙이려면 **먼저** `SearchProvider` 에 바인딩 함수용 프로필(`enabled=true` + `tool=search_web`)을
            // 추가해야 하고, 응답이 바뀌는 변경이라 전후 측정을 동반한다(TODO §5-b).
            const messages = [
                new SystemMessage(finalInstruction),
                ...safeMessages,
            ];

            // 행 방지: fetch 끊김/혼잡 시 ~5분 매달림 대신 25s에 abort. DEV_260627 §3.
            const response = await llmWithTools.invoke(messages, { signal: AbortSignal.timeout(LC_CALL_TIMEOUT_MS) });

            // 카드형 합성 intent 의 최종 답변에서는 카드를 도구 출력으로 고정한다.
            // 모델이 카드 JSON 을 다시 쓰게 두면 3개 중 1개만 제대로 냈다(card-tool-output 주석 참조).
            const pinned = PINNED_CARD_INTENTS[state.intent as keyof typeof PINNED_CARD_INTENTS];
            if (pinned && !(response as any)?.tool_calls?.length) {
                const toolMsg = [...state.messages].reverse()
                    .find((m: any) => m._getType?.() === 'tool' && String(m.content ?? '').includes(`\`\`\`json:${pinned}`));
                if (toolMsg) {
                    const text = typeof response.content === 'string' ? response.content : '';
                    response.content = pinCardToProse(text, String(toolMsg.content), pinned);
                }
            }
            return { messages: [response] };

        } catch (err: any) {
            const isRateLimit = err?.status === 429 || err?.statusText === 'Too Many Requests';
            // Failed to parse stream: 일시적 Gemini API 오류 — 다음 키로 재시도
            const isStreamError = typeof err?.message === 'string' && (
                err.message.includes('Failed to parse stream') ||
                err.message.includes('INTERNAL') ||
                err.message.includes('503')
            );
            const isTimeout = isTimeoutError(err);
            const isUnavailable = err?.status === 503 || err?.message?.includes('UNAVAILABLE');
            if (isRateLimit || isStreamError || isTimeout || isUnavailable) {
                if (isRateLimit) markRateLimitKey(lcApiKey, err);
                const nextKey = getNextApiKey();
                if (nextKey && nextKey !== lcApiKey) {
                    lcApiKey = nextKey;
                    lcAttempt++;
                    const reason = isRateLimit ? '429' : isTimeout ? 'timeout/504' : isUnavailable ? '503' : 'stream-error';
                    console.log(`[LangGraph] LangChain retry (attempt ${lcAttempt + 1}) reason:`, reason, err?.message?.slice(0, 80));
                    continue;
                }
            }
            const isAuth = isAuthError(err);
            if (isAuth) markKeyInvalid(lcApiKey);
            console.error('[LangGraph] LangChain path fatal error:', err?.status, err?.message?.slice(0, 120));
            throw err;
        }
    }

    throw new Error('[LangGraph] All API keys exhausted for LangChain path.');
};
