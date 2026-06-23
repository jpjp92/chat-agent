import { AgentStateType } from "../state";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError, API_KEYS } from "../../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS } from "../../models";
import { AIMessage } from "@langchain/core/messages";
import { getIntentFocusHint } from "../prompt";
import { buildSdkContents } from "./sdk-contents";
import { resolveMaxTokens, resolveThinkingConfig } from "./generation-config";
import { decideGoogleSearch } from "./search-gate";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";
import { runLangChainPath } from "./langchain-path";

/**
 * Generator Node
 * Prepares the final System Message with all dynamic context and invokes the multimodal Chat model.
 * For general intents, uses @google/genai SDK directly to capture groundingMetadata which
 * is lost by @langchain/google-genai's response parsing.
 */
export const createGeneratorNode = (systemInstructionBase: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void) => {
    return async (state: AgentStateType) => {
        console.log('[LangGraph] Entering Generator Node');
        const apiKey = getNextApiKey();
        console.log('[LangGraph] API key available:', !!apiKey, '| intent:', state.intent, '| model:', state.model);
        if (!apiKey) throw new Error("No API key available");

        const extractTextContent = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content
                    .map((part: any) => part?.type === 'text' ? part.text || '' : '')
                    .join('\n');
            }
            return '';
        };

        const latestUserText = (() => {
            const lastHuman = [...state.messages].reverse().find(msg => msg._getType() === 'human');
            return lastHuman ? extractTextContent(lastHuman.content) : '';
        })();

        let finalInstruction = systemInstructionBase;

        // Inject Current Date/Time to prevent hallucination
        const now = new Date();
        const tz = state.timeZone || 'Asia/Seoul';
        const currentDateStr = new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
            hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short'
        }).format(now);
        finalInstruction = `[CURRENT_SYSTEM_TIME (Timezone: ${tz}): ${currentDateStr}]\n\n` + finalInstruction;

        // Inject Dynamic Contexts
        if (state.webContent) {
            finalInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${state.webContent}`;
        }
        if (state.contextInfo) {
            finalInstruction += `\n\n${state.contextInfo}`;
        }
        // 영화 후속 질문(라우터가 movieFollowup으로 판정한 턴만): 화면 상영표 요약을 컨텍스트로 주입.
        // 데이터에 답이 없으면 솔직히 말하고 검색/지점조회를 안내(json:movie 카드는 재생성하지 말 것).
        if (state.movieFollowup && state.movieContext) {
            finalInstruction += `\n\n${state.movieContext}\n\n[영화 상영표 후속 질문 처리 규칙]\n- 위 "현재 화면에 표시된 영화 상영시간표" 데이터를 근거로 사용자의 후속 질문(비교·필터·"~만 상영"·가장 빠른/늦은 회차 등)에 간결히 답하세요.\n- 데이터에 없는 정보(줄거리·평점·예매율·관객수·장르·다른 지역/지점 등)는 절대 지어내지 마세요. 대신 "상영표에는 그 정보가 없어요"라고 밝힌 뒤, 반드시 마지막에 "웹에서 검색해 드릴까요?"라고 사용자에게 물어보세요. (사용자가 동의하면 다음 턴에 자동으로 웹 검색이 수행됩니다.)\n- json:movie 카드 블록을 다시 생성하지 마세요(이미 화면에 있음). 텍스트로만 답하세요.`;
        }

        // Inject intent-specific focus hint to guide renderer selection
        const intentHint = getIntentFocusHint(state.intent);
        if (intentHint) {
            finalInstruction += `\n\n${intentHint}`;
        }

        // Intent routing:
        // LangChain path — intents that need custom tools (drug_id, drug_info, pharmacy_search)
        // SDK path — all other intents (Google Search grounding available)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports"];
        const useLangChain = LANGCHAIN_INTENTS.includes(state.intent);

        // hasVideoData: fileData(영상)가 실제로 전송되는 턴인지. 모델 핀과 ~625줄 YouTube
        // 폴백 블록이 함께 참조하므로 SDK 루프 밖으로 hoist.
        const hasVideoData = state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) => p.fileData)
        );

        // YouTube는 영상 토큰이 무거워 60s 천장에 가장 위태로운 경로 — 영상을 실제 읽는 턴만
        // thinking 없는 2.5로 고정한다(DEFAULT_CHAT_MODEL 3.5 전환(2026-05-30) 이전 원래 설계).
        // 멀티턴 후속 질문(URL은 history에만 있고 영상 미재전송 → hasVideoData=false)은 영상
        // 토큰이 없어 60s 위험이 낮으므로 일반 대화 정책(3.5)으로 복귀시킨다. 아래 ~625줄 폴백
        // 블록도 isYoutubeRequest && hasVideoData 조건이라 영상 턴에서만 2.5→3.5 폴백이 동작.
        const resolvedModel = (isYoutubeRequest && hasVideoData)
            ? SERVER_MODELS.FLASH
            : (state.model || DEFAULT_CHAT_MODEL);
        if (isYoutubeRequest && hasVideoData) {
            // L23 로그는 state.model(클라 선택)을 찍어 오해 소지 — 핀 실제값을 명시.
            console.log(`[LangGraph] YouTube video turn → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        }

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        // NOTE: gemini-3.5-flash supports Google Search grounding, but it is not available
        // on the free tier. When 3.5 Flash is selected and grounding is needed, fall back
        // to 2.5 Flash for the grounded response.
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        const needsSearchFallback = resolvedModel === SERVER_MODELS.FLASH_3_5;
        let sdkSuccess = false; // declared outside if-block so LangChain fallback check at line ~277 can read it

        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = apiKey; // start with the key already chosen above
            let sdkAttempt = 0;
            // When multimodal content (YouTube fileData, PDF URL) causes a 500,
            // retry once without media parts + Google Search enabled.
            let forceTextOnly = false;

            // [이미지+검색 할루시네이션 가드] 현재 턴엔 이미지가 없고 history에만 이미지가 있는데
            // 사용자가 명시적으로 검색/팩트체크를 요청하면, 이번 요청에서 미디어를 빼고 실제
            // Google Search grounding을 켠다. Gemini는 inline 이미지+Search 동시 불가 → 이미지를
            // 보내면 parts 루프에서 hasMultimodalContent=true가 되어 검색이 막히고, 모델이 가짜
            // 출처([1]·URL·"참고 자료")를 지어내기 때문(근본 원인). 이미지 내용은 직전 assistant
            // 답변에 텍스트로 전사돼 있어 텍스트만으로도 팩트체크가 가능하다.
            const _lastHumanMsg = [...state.messages].reverse().find((m: any) => m._getType() === 'human');
            const _currentTurnHasImage = Array.isArray(_lastHumanMsg?.content) && (_lastHumanMsg!.content as any[]).some((p: any) =>
                p.type === 'image_url' || p.inlineData?.mimeType?.startsWith?.('image/') || p.fileData?.mimeType?.startsWith?.('image/')
            );
            const _historyHasImageForGuard = state.messages.some((m: any) =>
                Array.isArray(m.content) && (m.content as any[]).some((p: any) =>
                    p.type === 'image_url' || p.inlineData?.mimeType?.startsWith?.('image/') || p.fileData?.mimeType?.startsWith?.('image/')
                )
            );
            const _explicitSearchForGuard = state.needsSearch === true
                || /(검색|찾아|조사|출처|근거|최신|최근|실시간|뉴스|팩트체크|팩트 체크|사실확인|사실 확인|확인해|검증|웹에서|온라인에서|인터넷에서|실제로.*있|연구가.*있|논문|latest|recent|search|source|cite|fact.?check|verify|online)/i.test(latestUserText);
            const dropImageForSearch = state.intent === 'general' && !_currentTurnHasImage && _historyHasImageForGuard && _explicitSearchForGuard;
            if (dropImageForSearch) {
                forceTextOnly = true;
                console.log('[LangGraph] 이미지+검색 가드: history 이미지 제외 + Google Search 활성화 (명시적 팩트체크 요청)');
            }

            while (sdkAttempt < MAX_KEY_RETRIES) {
                // Declare outside try so catch block can read them for duplicate-guard
                let responseText = "";
                let groundingSources: any[] = [];
                let stage1FallbackText = "";
                // Track whether this attempt included multimodal parts (readable in catch)
                let hadMultimodalContent = false;

                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });

                    // Build contents from state messages
                    // Correctly maps all multimodal parts (text, image, pdf, video/YouTube) to SDK format
                    const { sdkContents, hasMultimodalContent, hasDocumentContent } = buildSdkContents(state.messages, forceTextOnly);
                    // hadMultimodalContent (declared outside try for the catch-block 500 retry)
                    // mirrors hasMultimodalContent — set here so the catch path can read it.
                    if (hasMultimodalContent) hadMultimodalContent = true;

                    // Google Search gate — decide grounding (multimodal/youtube/url/renderer/doc/general).
                    // Returns useGoogleSearch + side-values consumed downstream (token budget / diagnostic logs).
                    const { useGoogleSearch, hasUrlContent, historyHasImage, rendererIntents, explicitSearchRequested } = decideGoogleSearch({
                        webContent: state.webContent,
                        messages: state.messages,
                        intent: state.intent,
                        needsSearch: state.needsSearch,
                        hasMultimodalContent,
                        dropImageForSearch,
                        isYoutubeRequest,
                        hasVideoData,
                        latestUserText,
                    });

                    // Intent-based token budget: short-output paths get reduced limits to fit within Vercel 60s
                    const resolvedMaxTokens = resolveMaxTokens({
                        hasDocumentContent, isYoutubeRequest, hasMultimodalContent, hasUrlContent, intent: state.intent,
                    });
                    // Google Search grounding이 활성화되면 검색 결과 + 설명이 추가되어 토큰이 더 필요.
                    // 멀티턴에서도 히스토리가 쌓인 상태에서 grounding 응답이 길어질 수 있으므로 최소 8192 보장.
                    const effectiveMaxTokens = (useGoogleSearch && resolvedMaxTokens < 8192) ? 8192 : resolvedMaxTokens;

                    if ((hasMultimodalContent || historyHasImage) && !isYoutubeRequest) {
                        console.log('[LangGraph] Image in conversation — Google Search disabled', { hasMultimodalContent, historyHasImage });
                    }
                    if (hasUrlContent) {
                        console.log('[LangGraph] URL content provided — Google Search disabled to use full article text');
                    }
                    if (rendererIntents.has(state.intent) && !explicitSearchRequested) {
                        console.log('[LangGraph] Renderer intent — Google Search disabled to preserve structured visualization output');
                    }

                    console.log('[LangGraph] Starting SDK stream | model:', resolvedModel, '| useGoogleSearch:', useGoogleSearch, '| maxTokens:', effectiveMaxTokens, '| contentsLen:', sdkContents.length);
                    // gemini-3.5-flash Search grounding is not available on the free tier.
                    // Fall back to 2.5 Flash for grounded calls; non-search calls keep the selected model.
                    const effectiveModel = (useGoogleSearch && needsSearchFallback)
                        ? SEARCH_FALLBACK_MODEL
                        : resolvedModel;
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] 3.5 Flash + Google Search → falling back to', SEARCH_FALLBACK_MODEL, 'for grounding');
                    }

                    // Multi-turn detection (shared by thinkingConfig and Stage2 synthesis)
                    const isMultiTurn = sdkContents.length > 1;

                    // Thinking config — model-aware branching:
                    // 3.5-flash uses thinkingLevel enum (thinkingBudget deprecated):
                    //   - YouTube native video: "minimal" — disable thinking to stay within Vercel 60s
                    //   - Renderer intents (astronomy/data_viz/etc): "minimal" — structured JSON output;
                    //     "low" budget can be exhausted by JSON reasoning → empty response
                    //   - Multi-turn: "medium" — follow-up turns need more reasoning to honor user format requests
                    //   - 1st turn: "low" — prevents 60s timeout on first complex queries
                    // 2.5-flash keeps thinkingBudget (thinkingLevel may be unsupported):
                    //   - YouTube: budget 0 (disable — thinkingBudget>0 causes 503 with fileData on 2.5-flash)
                    //   - medical_qa: budget 3000 (cap)
                    //   - Others: undefined (model default)
                    const is3xModel = effectiveModel === SERVER_MODELS.FLASH_3_5;
                    const thinkingConfig = resolveThinkingConfig({
                        is3xModel, isYoutubeRequest, hasVideoData, intent: state.intent,
                    });

                    // Two-track path for 3.5 + Google Search:
                    // 1) 2.5-flash with Google Search for grounded facts
                    // 2) 3.5-flash with minimal thinking for final synthesis
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] Two-track enabled: stage1(2.5+search) -> stage2(3.5+minimal)');

                        const stage1Response = await genai.models.generateContent({
                            model: SEARCH_FALLBACK_MODEL,
                            contents: sdkContents,
                            config: {
                                systemInstruction: finalInstruction,
                                tools: [{ googleSearch: {} }],
                                temperature: 0.2,
                                topP: 0.8,
                                topK: 40,
                                maxOutputTokens: effectiveMaxTokens,
                                // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — 검증결과 dynamic thinking이
                                // Stage1 grounding latency의 주범(~48% 차지)이며 budget0이 출처·표·정확도 동등 (PLAN_THINKING_LATENCY §5-1).
                                thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 },
                            }
                        });

                        const stage1Parts = stage1Response.candidates?.[0]?.content?.parts ?? [];
                        let stage1Text = (stage1Response.text ?? stage1Parts
                            .filter((p: any) => !p.thought)
                            .map((p: any) => p.text || "")
                            .join(""))
                            .replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '')
                            .trim();

                        const stage1Grounding = stage1Response.candidates?.[0]?.groundingMetadata;
                        if (stage1Grounding?.groundingChunks) {
                            groundingSources = stage1Grounding.groundingChunks
                                .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                .filter(Boolean);
                        }

                        // 2.5 + Search가 간헐적으로 grounding은 수행하되 텍스트를 비우는 경우가 있다.
                        // 즉시 throw하면 LangChain 폴백(tool bind → 또 빈 응답)으로 떨어지므로,
                        // 키를 교체해 stage1을 1회 재시도한다.
                        if (!stage1Text) {
                            console.warn('[LangGraph] Two-track stage1 empty — retrying once with next key');
                            const s1RetryKey = getNextApiKey() ?? sdkApiKey;
                            const s1Retry = await new GoogleGenAI({ apiKey: s1RetryKey }).models.generateContent({
                                model: SEARCH_FALLBACK_MODEL,
                                contents: sdkContents,
                                config: {
                                    systemInstruction: finalInstruction,
                                    tools: [{ googleSearch: {} }],
                                    temperature: 0.2,
                                    topP: 0.8,
                                    topK: 40,
                                    maxOutputTokens: effectiveMaxTokens,
                                    // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — 검증결과 dynamic thinking이
                                // Stage1 grounding latency의 주범(~48% 차지)이며 budget0이 출처·표·정확도 동등 (PLAN_THINKING_LATENCY §5-1).
                                thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 },
                                }
                            });
                            const s1rParts = s1Retry.candidates?.[0]?.content?.parts ?? [];
                            stage1Text = (s1Retry.text ?? s1rParts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || "")
                                .join(""))
                                .replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '')
                                .trim();
                            const s1rGrounding = s1Retry.candidates?.[0]?.groundingMetadata;
                            if (s1rGrounding?.groundingChunks) {
                                groundingSources = s1rGrounding.groundingChunks
                                    .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                    .filter(Boolean);
                            }
                            if (stage1Text) {
                                console.log('[LangGraph] Two-track stage1 retry succeeded');
                            }
                        }
                        if (!stage1Text) {
                            throw new Error('Two-track stage1 returned empty grounded text');
                        }
                        stage1FallbackText = stage1Text;

                        // Keep synthesis input compact to reduce timeout risk.
                        if (stage1Text.length > 8000) {
                            stage1Text = stage1Text.slice(0, 8000);
                        }

                        const synthesisInstruction = [
                            `[USER_REQUEST]\n${latestUserText}\n`,
                            '[GROUNDING_NOTES_FROM_STAGE1]',
                            stage1Text,
                            '',
                            '[SYNTHESIS_RULES]',
                            '- Use ONLY the grounded notes above as factual source.',
                            '- Do not add new external facts.',
                            "- Do NOT mention the process or source handoff. Do not use source-context phrases (\"제시된 정보를 바탕으로\", \"제시된 내용을 바탕으로\", \"제공된 정보를 바탕으로\", \"Based on the provided information\", \"Based on the sources\", \"Según la información proporcionada\", \"D'après les informations fournies\", etc.) as boilerplate openers or formulaic transitions — these add no information and read as mechanical filler. Such phrases are only acceptable when they carry genuine meaning mid-sentence. Start directly with the answer content.",
                            '- Start directly with the answer content.',
                            ...(isMultiTurn
                                ? [
                                    "- This is a follow-up turn in an ongoing conversation. Respond naturally and conversationally — do NOT use a fixed section structure (no \"One-line summary\", no rigid headings).",
                                    "- Match the tone and depth the conversation has established. Answer the user's specific follow-up directly.",
                                    '- Use formatting (bullet points, bold, short paragraphs) only when it genuinely aids clarity.',
                                ]
                                : [
                                    '- Use this structure, translating section labels into the target response language:',
                                    '  1. A short "One-line summary" section with exactly one sentence.',
                                    '  2. A "Key content" section with concrete, organized subsections.',
                                    '  3. A "Considerations" section only if there are meaningful tradeoffs, limitations, risks, or adoption notes.',
                                    '- Keep headings concise and avoid generic meta headings such as "Summary of provided information".',
                                ]),
                            '- IMPORTANT: For weather forecasts, daily/weekly schedules, comparisons, or any multi-row structured data, you MUST use a markdown table. Never use bullet points for data that has consistent columns across multiple rows.',
                            '- Preserve useful structure, clarity, and brevity.',
                            '- If evidence is insufficient, state that clearly.',
                        ].join('\n');

                        let stage2ApiKey = sdkApiKey;
                        let stage2Attempt = 0;
                        let stage2QuotaExhausted = false;
                        // 503(모델 전체 폭주)은 키 로테이션 무의미 — 짧은 백오프로 소수 재시도 후 2.5 폴백.
                        let stage2OverloadAttempts = 0;
                        const MAX_OVERLOAD_RETRIES = 2;

                        while (stage2Attempt < MAX_KEY_RETRIES) {
                            try {
                                const stage2Genai = new GoogleGenAI({ apiKey: stage2ApiKey });
                                const stage2Response = await stage2Genai.models.generateContent({
                                    // Stage2 synthesis must run on the originally selected model (3.5),
                                    // not on effectiveModel (2.5 used only for Stage1 grounding).
                                    model: resolvedModel,
                                    contents: [{ role: 'user', parts: [{ text: synthesisInstruction }] }],
                                    config: {
                                        maxOutputTokens: effectiveMaxTokens,
                                        thinkingConfig: { thinkingLevel: 'minimal' as any },
                                    },
                                });

                                responseText = stage2Response.text || '';
                                break;
                            } catch (error: any) {
                                const status = error?.status ?? error?.code;
                                const isStage2Timeout = status === 504 || error?.message?.includes('DEADLINE_EXCEEDED') || error?.message?.includes('504') || error?.code === 'ERR_STREAM_DESTROYED';
                                // Daily/project-level quota exhausted — rotating keys won't help (429-family RESOURCE_EXHAUSTED)
                                if (isDailyQuotaError(error)) {
                                    console.warn(`[LangGraph] Stage2 daily quota exhausted for ${resolvedModel}. Skipping key rotation → 2.5 fallback.`);
                                    markKeyDailyExhausted(stage2ApiKey);
                                    stage2QuotaExhausted = true;
                                    break;
                                }
                                // 503 = 모델 전체 폭주(high demand). 어느 키든 같은 3.5라 키 로테이션 무의미.
                                // 일시 blip 흡수용 짧은 백오프로 동일 키 소수 재시도 후, 즉시 2.5 폴백.
                                if (status === 503) {
                                    stage2OverloadAttempts += 1;
                                    if (stage2OverloadAttempts > MAX_OVERLOAD_RETRIES) {
                                        console.warn(`[LangGraph] Stage2 503 (model overloaded) — ${MAX_OVERLOAD_RETRIES}회 백오프 후에도 폭주. 키 로테이션 건너뛰고 2.5 폴백.`);
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    const backoffMs = 400 * stage2OverloadAttempts;
                                    console.warn(`[LangGraph] Stage2 503 (high demand) attempt ${stage2OverloadAttempts}/${MAX_OVERLOAD_RETRIES} — ${backoffMs}ms 백오프 후 재시도(로테이션 무의미).`);
                                    await new Promise(r => setTimeout(r, backoffMs));
                                    continue;
                                }
                                // 429(키별 레이트리밋) / timeout — 키 로테이션이 유효
                                if (status === 429 || isStage2Timeout) {
                                    stage2Attempt += 1;
                                    const reason = isStage2Timeout ? 'timeout/504' : `quota(${status})`;
                                    console.warn(`[LangGraph] Stage2 error (${reason}) attempt ${stage2Attempt}/${MAX_KEY_RETRIES}. Rotating API key.`);
                                    if (stage2Attempt >= MAX_KEY_RETRIES) {
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    const nextStage2Key = getNextApiKey();
                                    if (!nextStage2Key) {
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
                                    stage2ApiKey = nextStage2Key;
                                    continue;
                                }
                                throw error;
                            }
                        }

                        if (stage2QuotaExhausted) {
                            console.warn('[LangGraph] Stage2 exhausted all API keys. Falling back to 2.5 synthesis.');
                            let fallbackSuccess = false;
                            for (let retryIdx = 0; retryIdx < MAX_KEY_RETRIES; retryIdx++) {
                                try {
                                    const fallbackKey = getNextApiKey() ?? sdkApiKey;
                                    const fallbackGenai = new GoogleGenAI({ apiKey: fallbackKey });
                                    const fallbackResponse = await fallbackGenai.models.generateContent({
                                        model: SEARCH_FALLBACK_MODEL,
                                        contents: [{ role: 'user', parts: [{ text: synthesisInstruction }] }],
                                        config: {
                                            temperature: 0.2,
                                            topP: 0.8,
                                            topK: 40,
                                            maxOutputTokens: effectiveMaxTokens,
                                            // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — 검증결과 dynamic thinking이
                                // Stage1 grounding latency의 주범(~48% 차지)이며 budget0이 출처·표·정확도 동등 (PLAN_THINKING_LATENCY §5-1).
                                thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 },
                                        },
                                    });
                                    responseText = fallbackResponse.text || stage1Text;
                                    fallbackSuccess = true;
                                    console.log('[LangGraph] Stage2 fallback to 2.5 succeeded');
                                    break;
                                } catch (fallbackError: any) {
                                    const fbStatus = fallbackError?.status ?? fallbackError?.code;
                                    const isFbTimeout = fbStatus === 504 || fallbackError?.message?.includes('DEADLINE_EXCEEDED') || fallbackError?.code === 'ERR_STREAM_DESTROYED';
                                    if (fbStatus === 429 || fbStatus === 503 || fbStatus === 504 || isFbTimeout) {
                                        console.warn(`[LangGraph] Stage2 fallback retry ${retryIdx + 1}/${MAX_KEY_RETRIES} failed with ${isFbTimeout ? 'timeout' : fbStatus}`);
                                        continue;
                                    }
                                    console.error('[LangGraph] Stage2 fallback fatal error:', fallbackError.message);
                                    break;
                                }
                            }
                            
                            // If all fallback attempts failed, use stage1Text as fallback
                            if (!fallbackSuccess) {
                                console.warn('[LangGraph] Stage2 fallback exhausted. Using Stage1 grounded text as response.');
                                responseText = stage1Text;
                            }
                        }

                        if (!responseText && stage1FallbackText) {
                            console.warn('[LangGraph] Stage2 returned empty text. Using Stage1 grounded text as safe fallback.');
                            responseText = stage1FallbackText;
                        }
                    } else {
                        // thinkingLevel may exhaust the thinking budget → only thought parts returned → empty text.
                        // Retry once with "minimal" thinking before giving up.
                        let singlePassResponse = await genai.models.generateContent({
                            model: effectiveModel,
                            contents: sdkContents,
                            config: {
                                systemInstruction: finalInstruction,
                                ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                ...(is3xModel ? {} : { temperature: 0.2, topP: 0.8, topK: 40 }),
                                maxOutputTokens: effectiveMaxTokens,
                                ...(thinkingConfig ? { thinkingConfig: thinkingConfig as any } : {}),
                            }
                        });

                        let singleParts = singlePassResponse.candidates?.[0]?.content?.parts ?? [];
                        responseText = (singlePassResponse.text || singleParts
                            .filter((p: any) => !p.thought)
                            .map((p: any) => p.text || '')
                            .join('')).trim();

                        // If empty and we used a non-minimal thinkingLevel, retry with minimal thinking
                        if (!responseText && is3xModel && thinkingConfig && (thinkingConfig as any).thinkingLevel && (thinkingConfig as any).thinkingLevel !== 'minimal') {
                            const candidate0 = singlePassResponse.candidates?.[0];
                            const finishReason = candidate0?.finishReason;
                            const thoughtOnlyParts = singleParts.filter((p: any) => p.thought).length;
                            console.warn('[LangGraph] Empty response - finishReason:', finishReason, '| thoughtParts:', thoughtOnlyParts, '| thinkingLevel:', (thinkingConfig as any).thinkingLevel, '— retrying with minimal thinking');
                            singlePassResponse = await genai.models.generateContent({
                                model: effectiveModel,
                                contents: sdkContents,
                                config: {
                                    systemInstruction: finalInstruction,
                                    ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                    maxOutputTokens: effectiveMaxTokens,
                                    thinkingConfig: { thinkingLevel: 'minimal' } as any,
                                }
                            });
                            singleParts = singlePassResponse.candidates?.[0]?.content?.parts ?? [];
                            responseText = (singlePassResponse.text || singleParts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || '')
                                .join('')).trim();
                        }

                        const singleGrounding = singlePassResponse.candidates?.[0]?.groundingMetadata;
                        if (singleGrounding?.groundingChunks) {
                            groundingSources = singleGrounding.groundingChunks
                                .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                .filter(Boolean);
                        }

                        if (!responseText) {
                            const candidate0 = singlePassResponse.candidates?.[0];
                            const finishReason = candidate0?.finishReason;
                            const safetyRatings = candidate0?.safetyRatings;
                            console.error('[LangGraph] Empty response - finishReason:', finishReason, '| safetyRatings:', JSON.stringify(safetyRatings));
                            if (finishReason === 'SAFETY') {
                                throw Object.assign(new Error('Content blocked by safety filters'), { safetyBlock: true });
                            }
                            // MALFORMED_FUNCTION_CALL: 3.5-flash가 멀티턴에서 함수호출 토큰을 잘못 뱉고
                            // 빈 텍스트로 끝나는 케이스. minimal thinking 재시도도 동일하게 실패하므로
                            // 더 견고한 2.5-flash로 1회 폴백한다 (tool 없이; useGoogleSearch면 grounding 유지).
                            if (finishReason === 'MALFORMED_FUNCTION_CALL' && effectiveModel !== SEARCH_FALLBACK_MODEL) {
                                console.warn('[LangGraph] MALFORMED_FUNCTION_CALL on', effectiveModel, '— retrying on', SEARCH_FALLBACK_MODEL);
                                const mfRetry = await genai.models.generateContent({
                                    model: SEARCH_FALLBACK_MODEL,
                                    contents: sdkContents,
                                    config: {
                                        systemInstruction: finalInstruction,
                                        ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                        temperature: 0.2,
                                        topP: 0.8,
                                        topK: 40,
                                        maxOutputTokens: effectiveMaxTokens,
                                        thinkingConfig: { thinkingBudget: 0 },
                                    }
                                });
                                const mfParts = mfRetry.candidates?.[0]?.content?.parts ?? [];
                                responseText = (mfRetry.text || mfParts
                                    .filter((p: any) => !p.thought)
                                    .map((p: any) => p.text || '')
                                    .join('')).trim();
                                const mfGrounding = mfRetry.candidates?.[0]?.groundingMetadata;
                                if (mfGrounding?.groundingChunks) {
                                    groundingSources = mfGrounding.groundingChunks
                                        .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                        .filter(Boolean);
                                }
                                if (responseText) {
                                    console.log('[LangGraph] MALFORMED fallback to', SEARCH_FALLBACK_MODEL, 'succeeded');
                                }
                            }
                        }
                    }

                    // Fix B: tool_code 환각 방어 가드.
                    // Gemini Flash는 검색 의도가 강한데 grounding 툴이 안 붙어있으면
                    // "[tool_code] print(google_search(...))[/tool_code]" 같은 내부 호출 코드를
                    // 본문 텍스트로 토출한다(프롬프트 금지 지시만으로는 막히지 않음).
                    // 감지 시 Google Search를 켜고 1회 재시도, 그래도 남으면 해당 블록을 제거한다.
                    const TOOL_CODE_RE = /\[tool_code\]|print\s*\(\s*google_search/i;
                    const stripToolCode = (t: string): string => t
                        .replace(/\[tool_code\][\s\S]*?\[\/tool_code\]/gi, '')
                        .replace(/```(?:tool_code|python|tool)?[\s\S]*?google_search[\s\S]*?```/gi, '')
                        .replace(/^.*print\s*\(\s*google_search[\s\S]*?\)\s*$/gim, '')
                        .replace(/\[\/?tool_code\]/gi, '')
                        .trim();
                    if (responseText && TOOL_CODE_RE.test(responseText)) {
                        console.warn('[LangGraph] tool_code hallucination detected — retrying with Google Search grounding');
                        try {
                            const groundModel = needsSearchFallback ? SEARCH_FALLBACK_MODEL : effectiveModel;
                            const groundRetry = await genai.models.generateContent({
                                model: groundModel,
                                contents: sdkContents,
                                config: {
                                    systemInstruction: finalInstruction,
                                    tools: [{ googleSearch: {} }],
                                    temperature: 0.2,
                                    topP: 0.8,
                                    topK: 40,
                                    maxOutputTokens: effectiveMaxTokens,
                                    thinkingConfig: { thinkingBudget: 0 },
                                }
                            });
                            const grParts = groundRetry.candidates?.[0]?.content?.parts ?? [];
                            const grText = (groundRetry.text || grParts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || '')
                                .join(''))
                                .replace(/\s?\[\d+(?:,\s*\d+)*\]/g, '')
                                .trim();
                            const grGrounding = groundRetry.candidates?.[0]?.groundingMetadata;
                            if (grGrounding?.groundingChunks) {
                                groundingSources = grGrounding.groundingChunks
                                    .map((c: any) => c.web ? { title: c.web.title, uri: c.web.uri } : null)
                                    .filter(Boolean);
                            }
                            if (grText && !TOOL_CODE_RE.test(grText)) {
                                console.log('[LangGraph] tool_code grounding retry succeeded');
                                responseText = grText;
                            } else {
                                responseText = stripToolCode(responseText);
                                console.warn('[LangGraph] tool_code grounding retry inconclusive — stripped hallucinated block');
                            }
                        } catch (grErr: any) {
                            responseText = stripToolCode(responseText);
                            console.warn('[LangGraph] tool_code grounding retry errored — stripped block:', grErr?.message);
                        }
                    }

                    if (!responseText) {
                        throw new Error('SDK returned empty response text');
                    }

                    if (sendEvent && responseText) sendEvent({ text: responseText });
                    if (groundingSources.length > 0) {
                        console.log(`[LangGraph] Two-track grounding sources: ${groundingSources.length}`);
                    }

                    sdkSuccess = true;
                    const aiMsg = new AIMessage(responseText);
                    return { messages: [aiMsg], groundingSources };

                } catch (err: any) {
                    // If text was already streamed to the client, do NOT retry — would cause duplicate output
                    if (responseText) {
                        console.warn('[LangGraph] Error after partial stream (err:', err?.status, ') — returning partial response to avoid duplication');
                        if (sendEvent) sendEvent({ cutOff: true });
                        sdkSuccess = true;
                        return { messages: [new AIMessage(responseText)], groundingSources };
                    }
                    const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
                    const isUnavailable = err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('UNAVAILABLE');
                    const isTimeout = isTimeoutError(err);
                    const isAuth = isAuthError(err);
                    if (isAuth) {
                        markKeyInvalid(sdkApiKey);
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.warn(`[LangGraph] SDK invalid/unauthorized key: retrying with next key (attempt ${sdkAttempt + 1})`);
                            continue;
                        }
                    } else if (isRateLimit || isUnavailable || isTimeout) {
                        if (isRateLimit) markRateLimitKey(sdkApiKey, err);
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.log(`[LangGraph] Retrying SDK call with next key (attempt ${sdkAttempt + 1}) reason:`, isRateLimit ? '429' : isTimeout ? 'timeout/504' : '503');
                            continue;
                        }
                    } else if (err?.status === 500 && hadMultimodalContent && !forceTextOnly) {
                        // Multimodal 500: video/image inaccessible or transient server error.
                        // Retry once without media parts — Google Search will auto-enable (hasMultimodalContent=false).
                        forceTextOnly = true;
                        sdkAttempt++;
                        console.warn('[LangGraph] SDK 500 on multimodal — retrying text-only with Google Search enabled');
                        continue;
                    }
                    // Safety block — don't retry, propagate immediately
                    if (err?.safetyBlock) throw err;
                    // Non-retryable error or no more keys
                    console.error('[LangGraph] SDK call failed:', err?.status, err?.message || err);
                    break;
                }
            }
        }

        // YouTube fallback: primary model (2.5-flash) exhausted → retry with 3.5-flash
        if (!useLangChain && !sdkSuccess && isYoutubeRequest && hasVideoData && resolvedModel !== SERVER_MODELS.FLASH_3_5) {
            console.log('[LangGraph] YouTube fallback: all', resolvedModel, 'keys failed — retrying with', SERVER_MODELS.FLASH_3_5);
            try {
                const fbKey = getNextApiKey() ?? apiKey;
                const fbGenai = new GoogleGenAI({ apiKey: fbKey });
                const fbContents: any[] = [];
                for (const msg of state.messages) {
                    if (msg._getType() === 'human') {
                        const contentVal = msg.content;
                        if (Array.isArray(contentVal)) {
                            const parts: any[] = [];
                            for (const part of contentVal as any[]) {
                                if (part.type === 'text') parts.push({ text: part.text || '' });
                                else if (part.fileData?.fileUri) parts.push({ fileData: { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType } });
                            }
                            if (parts.length === 0) parts.push({ text: '' });
                            fbContents.push({ role: 'user', parts });
                        } else {
                            fbContents.push({ role: 'user', parts: [{ text: String(contentVal) }] });
                        }
                    } else if (msg._getType() === 'ai') {
                        fbContents.push({ role: 'model', parts: [{ text: String(msg.content) }] });
                    }
                }
                const fbResponse = await fbGenai.models.generateContent({
                    model: SERVER_MODELS.FLASH_3_5,
                    contents: fbContents,
                    config: {
                        systemInstruction: finalInstruction,
                        temperature: 0.2, topP: 0.8, topK: 40,
                        maxOutputTokens: 8192,
                        thinkingConfig: { thinkingLevel: 'minimal' as any },
                    }
                });
                const fbText = fbResponse.text ?? '';
                if (fbText) {
                    console.log('[LangGraph] YouTube 3.5-flash fallback succeeded');
                    if (sendEvent) sendEvent({ text: fbText });
                    sdkSuccess = true;
                    return { messages: [new AIMessage(fbText)] };
                }
            } catch (fbErr: any) {
                console.error('[LangGraph] YouTube 3.5-flash fallback failed:', fbErr?.status, fbErr?.message);
            }
        }

        // LangChain path: drug_id/drug_info etc. need custom tools; also the unstreamed
        // fallback when the SDK path fully fails. Fully terminal (returns or throws).
        return await runLangChainPath({
            state,
            finalInstruction,
            resolvedModel,
            apiKey,
            systemInstructionBase,
            useLangChain,
            sdkSuccess,
            isYoutubeRequest,
            hasVideoData,
        });
    };
};
