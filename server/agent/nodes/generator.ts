import { AgentStateType } from "../state";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError, API_KEYS } from "../../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS } from "../../models";
import { identifyPillTool, searchWebTool } from "../tools";
import { searchDrugInfoTool } from "../drug-info-tool";
import { pharmacyTool } from "../pharmacy-tool";
import { hospitalTool } from "../hospital-tool";
import { vetTool } from "../vet-tool";
import { lawTool } from "../law-tool";
import { movieTool } from "../movie-tool";
import { worldCupTool } from "../worldcup-tool";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { getIntentFocusHint } from "../prompt";
import { classifySearchNeed, shouldSuppressSearchForFollowup, isFollowupReference } from "../intentRules";
import { pillNoMatchMessage, pillLookupErrorMessage, extractPillMatchType, pillCandidateTableMessage } from "./pill-messages";
import { buildSdkContents } from "./sdk-contents";
import { resolveMaxTokens, resolveThinkingConfig } from "./generation-config";

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

        const resolvedModel = state.model || DEFAULT_CHAT_MODEL;

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        // NOTE: gemini-3.5-flash supports Google Search grounding, but it is not available
        // on the free tier. When 3.5 Flash is selected and grounding is needed, fall back
        // to 2.5 Flash for the grounded response.
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        const needsSearchFallback = resolvedModel === SERVER_MODELS.FLASH_3_5;
        let sdkSuccess = false; // declared outside if-block so LangChain fallback check at line ~277 can read it
        // Hoist hasVideoData outside the SDK loop so YouTube fallback block can reference it.
        const hasVideoData = state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) => p.fileData)
        );

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

                    // Google Search is incompatible with multimodal content (images, video, PDF)
                    // Optimization: Disable Google Search for YouTube summaries when transcript OR video data is present
                    const hasTranscript = state.webContent.includes('[TRANSCRIPT]');
                    // hasVideoData is hoisted above the while loop — accessible here via closure

                    // Disable Google Search when image exists anywhere in conversation history.
                    // Gemini API does not support Google Search + image in the same request.
                    // Without this, follow-up turns (e.g. "표로 정리해줘") after an image analysis
                    // would enable Google Search (no image in *current* turn), causing the model
                    // to ignore the image history and return sparse, search-based responses.
                    const historyHasImage = state.messages.some((m: any) =>
                        Array.isArray(m.content) && m.content.some((p: any) =>
                            p.inlineData || (p.fileData && !p.fileData.fileUri?.includes('youtube'))
                        )
                    );

                    // URL_CONTENT 태그 존재 여부로 Google Search 비활성 여부를 결정.
                    // 이전에는 내용 길이 >= 300 조건을 사용했으나, Vercel(해외 IP)에서
                    // 한국 뉴스 사이트(Naver 등)가 짧은 HTML을 반환하면 Google Search가 활성화되어
                    // 전혀 다른 기사를 요약하는 문제가 발생. URL이 제공된 이상 해당 URL 기반으로만 요약해야 함.
                    // [URL_CONTENT:...] 태그 자체가 "URL fetch 시도 완료" 신호이므로 길이 체크 제거.
                    const hasUrlContent = state.webContent.includes('[URL_CONTENT:');

                    // Multi-turn YouTube: 1st response is stored as [VIDEO_ANALYSIS_SUMMARY]
                    // in webContent. Treat it the same as native video data — no Search needed.
                    const hasVideoSummary = state.webContent.includes('[VIDEO_ANALYSIS_SUMMARY');

                    let useGoogleSearch = !hasMultimodalContent && (!historyHasImage || dropImageForSearch);
                    // 1턴: transcript/native video 있으면 Search 비활성
                    // 2턴+: VIDEO_ANALYSIS_SUMMARY가 있으면 Search 비활성 (1차 분석 결과가 컨텍스트)
                    if (isYoutubeRequest && (hasTranscript || hasVideoData || hasVideoSummary)) {
                        useGoogleSearch = false;
                    }
                    if (hasUrlContent) {
                        useGoogleSearch = false;
                    }
                    // Follow-up turns after URL analysis: keep single-pass path
                    // so the model can still access document content from history.
                    const historyHasUrl = state.messages.slice(0, -1)
                        .filter((m: any) => m._getType() === 'human')
                        .some((m: any) => {
                            const text = Array.isArray(m.content)
                                ? (m.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                                : String(m.content);
                            return /https?:\/\/\S+/.test(text);
                        });
                    // Current message URL check: slice(0,-1) misses the current turn, so
                    // 2.5 Flash with Google Search sees the URL and tries to fetch it.
                    // Disable Search when current prompt contains a non-YouTube URL.
                    const currentMsgHasNonYtUrl = (() => {
                        const lastMsg = state.messages[state.messages.length - 1];
                        if (!lastMsg || lastMsg._getType() !== 'human') return false;
                        const text = Array.isArray(lastMsg.content)
                            ? (lastMsg.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                            : String(lastMsg.content);
                        return /https?:\/\/\S+/.test(text) && !/(?:youtube\.com|youtu\.be)/.test(text);
                    })();
                    // Fix A: historyHasUrl을 무조건 off로 두면, 1턴에 URL을 한 번 붙인 뒤
                    // 그 대화 내내 모든 후속 질문의 검색이 영구히 꺼진다. 새 질문이 URL과 무관해도
                    // 검색이 막혀 → 모델이 grounding 툴 없이 검색을 시도하다 [tool_code] print(google_search(...))
                    // 환각을 본문으로 토출한다. 따라서:
                    //  - 현재 메시지 자체에 URL이 있으면(요약 대상) 기존대로 off.
                    //  - history에만 URL이 있으면, 현재 메시지가 직전 답변을 가공·참조하는 follow-up
                    //    (요약/정리/비교/위에서…)이고 새 검색요구가 아닐 때만 off. 새 검색요구면
                    //    grounding을 살려 아래 general 게이트가 판정하도록 위임.
                    if (currentMsgHasNonYtUrl) {
                        useGoogleSearch = false;
                    } else if (historyHasUrl) {
                        const isNewSearchQuery = classifySearchNeed(latestUserText) === 'on';
                        const isUrlFollowup = isFollowupReference(latestUserText);
                        if (isUrlFollowup && !isNewSearchQuery) {
                            useGoogleSearch = false;
                            console.log('[LangGraph] historyHasUrl follow-up reference — Google Search suppressed');
                        } else {
                            console.log(`[LangGraph] historyHasUrl but new query (followup=${isUrlFollowup}, newSearch=${isNewSearchQuery}) — keeping search gate open`);
                        }
                    }
                    // medical_qa: 이미지 없는 경우 Google Search 강제 활성화
                    // LLM 내부 지식 의존 → 실시간 의학 정보 + 출처 기반 답변으로 개선
                    // (이미지가 있으면 Gemini API 제약상 Search 불가 → hasMultimodalContent/historyHasImage 조건 유지)
                    if (state.intent === 'medical_qa' && !hasMultimodalContent && !historyHasImage) {
                        useGoogleSearch = true;
                    }
                    // Renderer intents should produce structured JSON directly. If Google Search is
                    // left on for 3.5, the two-track path turns the request into Stage1 search notes
                    // followed by Stage2 summary, which can drop the visualization block entirely.
                    const rendererIntents = new Set(['astronomy', 'biology', 'chemistry', 'physics', 'data_viz']);
                    const explicitSearchRequested = /(검색|찾아|조사|출처|근거|최신|최근|실시간|뉴스|latest|recent|search|source|cite)/i.test(latestUserText);
                    if (rendererIntents.has(state.intent) && !explicitSearchRequested) {
                        useGoogleSearch = false;
                    }

                    // 첨부 문서 게이트: 추출 텍스트(hwp/docx/xlsx/txt…)는 그 자체가 답변 근거이므로
                    // grounding 기본 off. 문서 요약·검토 요청에 불필요한 웹검색이 붙어 레이턴시/환각이
                    // 늘던 문제 해결. 단, 사용자가 "문서 외 추가 검증"(검색/조사/최신/출처 등)을 명시 요청하면
                    // 게이트를 열어둬 아래 general 게이트(needsSearch)가 판정 → URL 게이트와 동일 철학.
                    // 마커: [EXTRACTED_CONTENT:](현재 턴 첨부) / [PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:](후속 턴).
                    const hasDocContent = state.webContent.includes('[EXTRACTED_CONTENT:')
                        || state.webContent.includes('[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT:');
                    if (hasDocContent && !explicitSearchRequested) {
                        useGoogleSearch = false;
                        console.log('[LangGraph] Doc content present, no explicit external-search request — Google Search suppressed');
                    }

                    // General intent: 라우터의 검색 필요 판정(state.needsSearch)을 반영 (게이트 6·7).
                    // 위 게이트들이 이미 image/url/video/renderer를 off로 확정했으므로,
                    // "순수 general"(useGoogleSearch가 아직 true)일 때만 적용 → 기존 13-intent 분기·tool 로직 전부 보존.
                    // medical_qa/renderer는 intent!=='general'이라 제외, image/url/video는 useGoogleSearch===false라 제외.
                    // 기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (6-2 게이트6/7, 6-3, 9-B)
                    if (state.intent === 'general' && useGoogleSearch) {
                        useGoogleSearch = state.needsSearch; // 게이트7: 라우터 판정 (default-on이라 누락 시 기존과 동일)
                        // 게이트6: 검색결과 멀티턴 가드 — 직전 턴 검색됨 + follow-up 가공형이면 재검색 억제.
                        // prevSearched = 직전 human 메시지 classifySearchNeed==='on' 근사 (9-B A안: grounding 마커 미영속).
                        const humanMsgs = state.messages.filter((m: any) => m._getType() === 'human');
                        const prevHuman = humanMsgs.length >= 2 ? humanMsgs[humanMsgs.length - 2] : undefined;
                        const prevHumanText = prevHuman
                            ? (Array.isArray(prevHuman.content)
                                ? (prevHuman.content as any[]).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
                                : String(prevHuman.content))
                            : '';
                        const prevSearched = prevHumanText ? classifySearchNeed(prevHumanText) === 'on' : false;
                        if (shouldSuppressSearchForFollowup(latestUserText, prevSearched)) {
                            useGoogleSearch = false;
                            console.log('[LangGraph] Multi-turn follow-up guard — Google Search suppressed');
                        }
                        console.log(`[LangGraph] General search gate — needsSearch=${state.needsSearch}, prevSearched=${prevSearched}, useGoogleSearch=${useGoogleSearch}`);
                    }

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
                                if (status === 429 || status === 503 || isStage2Timeout) {
                                    stage2Attempt += 1;
                                    // Daily/project-level quota exhausted — rotating keys won't help
                                    // Skip remaining key retries and go directly to 2.5 fallback
                                    if (isDailyQuotaError(error)) {
                                        console.warn(`[LangGraph] Stage2 daily quota exhausted for ${resolvedModel}. Skipping key rotation → 2.5 fallback.`);
                                        markKeyDailyExhausted(stage2ApiKey);
                                        stage2QuotaExhausted = true;
                                        break;
                                    }
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
                    const isTimeout = err?.status === 504 || err?.message?.includes('DEADLINE_EXCEEDED') || err?.message?.includes('504') || err?.code === 'ERR_STREAM_DESTROYED';
                    // Gemini는 무효 API 키를 401이 아닌 400(API_KEY_INVALID)으로 반환
                    const isAuth = err?.status === 401 || err?.status === 403 || /api key not valid|API_KEY_INVALID/i.test(err?.message ?? '');
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
                        if (isRateLimit) {
                            if (isDailyQuotaError(err)) {
                                markKeyDailyExhausted(sdkApiKey);
                            } else {
                                markKeyRateLimited(sdkApiKey);
                            }
                        }
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

        // LangChain path: drug_id and drug_info intents need custom DB/identification tools.
        // Note: for non-drug intents, this path acts as an unstreamed fallback when SDK fully fails.
        if (!useLangChain && !sdkSuccess) {
            console.error('[LangGraph] SDK path failed for intent:', state.intent, '— falling back to LangChain (no streaming)');
            // YouTube native video analysis uses fileData which LangChain does not support.
            // Falling through would produce hallucinated content instead of the actual video summary.
            // Return a clear error message so the user knows to retry rather than seeing wrong content.
            if (isYoutubeRequest && hasVideoData) {
                const YT_ERR: Record<string, string> = {
                    KOREAN:  'YouTube 영상 분석 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.',
                    ENGLISH: 'YouTube video analysis is temporarily unavailable. Please try again in a moment.',
                    SPANISH: 'El análisis de video de YouTube no está disponible temporalmente. Por favor, inténtelo de nuevo en un momento.',
                    FRENCH:  'L\'analyse vidéo YouTube est temporairement indisponible. Veuillez réessayer dans un instant.',
                };
                const langMatch = systemInstructionBase.match(/YOUR ENTIRE RESPONSE MUST BE IN (\w+) ONLY/);
                const errMsg = langMatch ? (YT_ERR[langMatch[1]] ?? YT_ERR.ENGLISH) : YT_ERR.ENGLISH;
                return { messages: [new AIMessage(errMsg)] };
            }
        }
        let lcApiKey = getNextApiKey() ?? apiKey;
        let lcAttempt = 0;

        while (lcAttempt < API_KEYS.length) {
            try {
                const is3xLcModel = resolvedModel === SERVER_MODELS.FLASH_3_5;
                const llm = new ChatGoogleGenerativeAI({
                    model: resolvedModel,
                    apiKey: lcApiKey,
                    ...(is3xLcModel ? {} : { temperature: 0.2, topP: 0.8, topK: 40 }),
                    // Drug card JSON is compact — 8192 is sufficient and reduces Vercel 60s timeout risk
                    maxOutputTokens: 8192,
                    maxRetries: 0,
                });

                // Fast-pass: Bypass final LLM generation if pharmacyTool / hospitalTool has successfully executed
                const lastMsg = state.messages[state.messages.length - 1];
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
                    if (toolContent.includes('```json:pharmacy')) {
                        console.log('[LangGraph] Fast-passing pharmacyTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "hospital_search" && lastMsg._getType() === "tool" && lastMsg.name === "hospitalTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:hospital')) {
                        console.log('[LangGraph] Fast-passing hospitalTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "vet_search" && lastMsg._getType() === "tool" && lastMsg.name === "vetTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:vet')) {
                        console.log('[LangGraph] Fast-passing vetTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "law_search" && lastMsg._getType() === "tool" && lastMsg.name === "lawTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:law')) {
                        console.log('[LangGraph] Fast-passing lawTool: Bypassing final LLM generation');
                        return { messages: [new AIMessage("")] };
                    }
                }
                if (state.intent === "movie_search" && lastMsg._getType() === "tool" && lastMsg.name === "movieTool") {
                    const toolContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                    if (toolContent.includes('```json:movie')) {
                        console.log('[LangGraph] Fast-passing movieTool: Bypassing final LLM generation');
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
                        // LangChain may return a ToolMessage object — extract .content
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
                        console.log('[LangGraph] Direct identify_pill non-exact result:', pillMatchType);
                        return { messages: [new AIMessage(pillCandidateTableMessage(state.pillData, pillMatchType, pillLookupText))] };
                    }

                    finalInstruction += `\n\n[IDENTIFY_PILL_DATABASE_RESULT]\n${pillLookupText}\n\n[DRUG_ID_RESPONSE_RULES]\n- Do NOT include or reproduce the raw vision extraction JSON.\n- Use the database result above as the only source for the pill candidate list.\n- Generate a json:drug card ONLY when match_type is exact.`;
                }

                let allTools: any[] = [];
                if (state.intent === "drug_id") {
                    // Pill image identification already performed deterministic DB lookup
                    // above. Do not expose additional tools here; otherwise the model can
                    // enter generator → search/identify tool → generator recursion.
                    allTools = directPillLookupDone ? [] : [identifyPillTool, searchWebTool];
                } else if (state.intent === "drug_info") {
                    allTools = [searchDrugInfoTool, searchWebTool];
                } else if (state.intent === "pharmacy_search") {
                    allTools = [pharmacyTool, searchWebTool];
                } else if (state.intent === "hospital_search") {
                    allTools = [hospitalTool, searchWebTool];
                } else if (state.intent === "vet_search") {
                    allTools = [vetTool, searchWebTool];
                } else if (state.intent === "law_search") {
                    allTools = [lawTool];
                } else if (state.intent === "movie_search") {
                    allTools = [movieTool];
                } else if (state.intent === "sports") {
                    allTools = [worldCupTool];
                }

                const llmWithTools = allTools.length === 0 ? llm : llm.bindTools(allTools);

                // Drug image requests are pre-processed by the vision node. Do not pass the
                // original image into the LangChain tool path again: 3.5 may re-run visual
                // extraction and stream raw JSON instead of calling identify_pill.
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

                const messages = [
                    new SystemMessage(finalInstruction),
                    ...safeMessages,
                ];

                const response = await llmWithTools.invoke(messages);
                return { messages: [response] };

            } catch (err: any) {
                const isRateLimit = err?.status === 429 || err?.statusText === 'Too Many Requests';
                // Failed to parse stream: transient Gemini API error — retry with next key
                const isStreamError = typeof err?.message === 'string' && (
                    err.message.includes('Failed to parse stream') ||
                    err.message.includes('INTERNAL') ||
                    err.message.includes('503')
                );
                const isTimeout = err?.status === 504 || err?.message?.includes('DEADLINE_EXCEEDED') || err?.message?.includes('504') || err?.code === 'ERR_STREAM_DESTROYED';
                const isUnavailable = err?.status === 503 || err?.message?.includes('UNAVAILABLE');
                if (isRateLimit || isStreamError || isTimeout || isUnavailable) {
                    if (isRateLimit) {
                        if (isDailyQuotaError(err)) {
                            markKeyDailyExhausted(lcApiKey);
                        } else {
                            markKeyRateLimited(lcApiKey);
                        }
                    }
                    const nextKey = getNextApiKey();
                    if (nextKey && nextKey !== lcApiKey) {
                        lcApiKey = nextKey;
                        lcAttempt++;
                        const reason = isRateLimit ? '429' : isTimeout ? 'timeout/504' : isUnavailable ? '503' : 'stream-error';
                        console.log(`[LangGraph] LangChain retry (attempt ${lcAttempt + 1}) reason:`, reason, err?.message?.slice(0, 80));
                        continue;
                    }
                }
                const isAuth = err?.status === 401 || err?.status === 403 || /api key not valid|API_KEY_INVALID/i.test(err?.message ?? '');
                if (isAuth) markKeyInvalid(lcApiKey);
                console.error('[LangGraph] LangChain path fatal error:', err?.status, err?.message?.slice(0, 120));
                throw err;
            }
        }

        throw new Error('[LangGraph] All API keys exhausted for LangChain path.');
    };
};
