import { AgentStateType } from "../state";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError, API_KEYS } from "../../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS, modelCaps, isThreeXFlash } from "../../models";
import { AIMessage } from "@langchain/core/messages";
import { getIntentFocusHint } from "../prompt";
import { buildSdkContents } from "./sdk-contents";
import { resolveMaxTokens, resolveThinkingConfig } from "./generation-config";
import { decideGoogleSearch } from "./search-gate";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";
import { runLangChainPath } from "./langchain-path";

// SDK 호출 1회(attempt)당 상한. Vercel 60s 하드캡 아래에서 3.5 행/혼잡을 강제 중단하고
// 2.5로 강등 재시도할 예산을 남기기 위해 25s. (25s×2 attempt ≈ 50s < 60s)
// 무료티어 3.5는 정상이면 보통 <15s라 건강한 응답은 거의 안 잘림(DEV: 3.5 free-tier throughput).
export const SDK_CALL_TIMEOUT_MS = 25_000;
// YouTube 영상 턴은 프로파일이 정반대 — 영상 토큰이 무거운 단일 heavy 호출이 60s 예산
// 대부분을 정당하게 소모하고(정상 ~30~48s, 메모리 youtube-call-timeout-profile), 폴백 3.5는
// 무료티어 영상에서 오히려 더 느리다. 25s 일률 컷은 정상 분석을 끊어 키 로테이션·3.5 폴백이 각
// 25s씩 쌓여 60s 천장을 초과 → 전부 타임아웃(DEV_260627 회귀).
// 회귀 본질: aa9d701 이전엔 SDK 경로에 per-call 타임아웃이 없어 유튜브가 60s 캡 직전(~59s)까지
// 예산을 다 썼고 잘 됐다. 48s는 정상 상한(~48s)과 겹쳐 살짝 초과한 정상 호출을 잘랐다
// (DEV_260703: 48.38s 로그 = 우리 데드라인 발화). 원래 예산을 충실히 원복 — 57s로 상향.
// abort 후 graceful 반환·supabase 저장 오버헤드는 ~0.4s(로그 관측)라 57s면 60s 캡까지 ~3s
// (오버헤드의 7배) 여유가 남고, 도중 abort 시엔 스트리밍 부분 응답이 복구된다(아래 partial
// stream 처리). maxDuration(60s, 무료티어 상향 불가)은 무관 — 우리가 건 데드라인이 병목이었다.
export const YOUTUBE_CALL_TIMEOUT_MS = 57_000;

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

        // 날씨 후속 대화(라우터가 weatherFollowup으로 판정한 턴): 카드는 이미 화면에 있고 그 수치가
        // 히스토리의 json:weather 블록에 그대로 들어 있다. 카드/5일 표를 다시 그리지 말고 그 데이터로
        // 대화하도록 지시 — base 프롬프트의 [WEATHER FORMATTING]("ALWAYS 표 구조")를 이 턴만 무력화한다.
        if (state.weatherFollowup) {
            finalInstruction += `\n\n[날씨 후속 대화 처리 규칙]\n- 화면에는 이미 날씨 카드가 표시되어 있고, 대화 기록의 \`json:weather\` 블록에 그 수치(현재 기온·체감·습도·5일 예보)가 들어 있습니다. 그 데이터를 근거로 사용자의 후속 질문(가장 더운 요일, 우산·빨래·외출 판단, 습도 해석, 옷차림 등)에 대화하듯 간결히 답하세요.\n- \`json:weather\` 블록을 다시 생성하지 마세요(이미 화면에 있음).\n- [WEATHER FORMATTING]의 5일 예보 표 규칙은 이 턴에 적용되지 않습니다. 표를 다시 그리지 말고, 필요한 수치만 문장 안에서 인용하세요.\n- 데이터에 없는 정보(미세먼지·자외선·과거 기록·다른 지역 등)는 지어내지 말고 없다고 밝히세요.\n- 사용자가 다른 주제로 넘어가면 날씨 이야기를 계속 끌고 가지 말고 그 주제로 자연스럽게 이어가세요.`;
        }

        // Inject intent-specific focus hint to guide renderer selection
        const intentHint = getIntentFocusHint(state.intent);
        if (intentHint) {
            finalInstruction += `\n\n${intentHint}`;
        }

        // Intent routing:
        // LangChain path — intents that need custom tools (drug_id, drug_info, pharmacy_search)
        // SDK path — all other intents (Google Search grounding available)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports", "weather"];
        const useLangChain = LANGCHAIN_INTENTS.includes(state.intent);

        // hasVideoData: fileData(영상)가 실제로 전송되는 턴인지. 모델 핀과 ~625줄 YouTube
        // 폴백 블록이 함께 참조하므로 SDK 루프 밖으로 hoist.
        const hasVideoData = state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) => p.fileData)
        );
        // 영상을 실제 읽는 YouTube 턴 — 예산형 단일 데드라인(YOUTUBE_CALL_TIMEOUT_MS) 대상.
        const isYtVideoTurn = isYoutubeRequest && hasVideoData;

        // 영상 입력 토큰 절감 — YouTube 영상은 기본 해상도로 ~31만 토큰이라 인제스트가 93s+로 60s 캡을
        // 초과했다(DEV_260703 실측). LOW 해상도는 프레임당 토큰을 대폭 줄여 ~11만 토큰·~23s(무료)로 캡
        // 안에 들어온다(요약은 화질 무관). ← 유튜브 요약 실패의 근본 해결.
        const videoMediaResolution: any = isYtVideoTurn ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {};

        // YouTube는 영상 토큰이 무거워 60s 천장에 가장 위태로운 경로 — 영상을 실제 읽는 턴만
        // thinking 없는 2.5로 고정한다(DEFAULT_CHAT_MODEL 3.5 전환(2026-05-30) 이전 원래 설계).
        // 멀티턴 후속 질문(URL은 history에만 있고 영상 미재전송 → hasVideoData=false)은 영상
        // 토큰이 없어 60s 위험이 낮으므로 일반 대화 정책(3.5)으로 복귀시킨다. 아래 ~625줄 폴백
        // 블록도 isYoutubeRequest && hasVideoData 조건이라 영상 턴에서만 2.5→3.5 폴백이 동작.
        // URL 본문이 주입된 턴은 "주어진 기사 요약"이라 Search OFF + 모델 추론보다 본문이 답을 결정.
        // 3.5 무료티어는 throughput이 나빠 20~30s를 끄는데(메모리 35-flash-free-tier-throughput),
        // 외부 도구 인텐트와 같은 논리로 throughput 좋은 2.5에 고정해 지연을 줄인다.
        const hasUrlContentForModel = (state.webContent || '').includes('[URL_CONTENT:');
        // 핀 판정 기준 = 사용자 선택 모델(sel). 영상/URL 핀은 그 모델이 무료티어에서 느릴 때만 2.5 강등.
        // 3.6 은 영상(fastMultimodal)·긴입력(fastLongInput) 모두 빠르므로 핀 안 됨(직접 처리). 3.5 는 붕괴 → 핀.
        const sel = state.model || DEFAULT_CHAT_MODEL;
        const selCaps = modelCaps(sel);
        const pinYoutube = isYoutubeRequest && hasVideoData && !selCaps.fastMultimodal;
        const pinUrl = hasUrlContentForModel && !selCaps.fastLongInput;
        const resolvedModel = (pinYoutube || pinUrl) ? SERVER_MODELS.FLASH : sel;
        if (pinYoutube) {
            // L23 로그는 state.model(클라 선택)을 찍어 오해 소지 — 핀 실제값을 명시.
            console.log(`[LangGraph] YouTube video turn → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        } else if (pinUrl) {
            console.log(`[LangGraph] URL summary turn → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        }

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        // NOTE: gemini-3.5-flash supports Google Search grounding, but it is not available
        // on the free tier. When 3.5 Flash is selected and grounding is needed, fall back
        // to 2.5 Flash for the grounded response.
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        // 무료티어 Google Search grounding 미지원 모델(3.5·3.6 → 429)이면 2.5 로 grounding 강등.
        const needsSearchFallback = !modelCaps(resolvedModel).freeTierSearch;
        let sdkSuccess = false; // declared outside if-block so LangChain fallback check at line ~277 can read it
        // 영상 턴 primary(2.5)가 데드라인 timeout으로 끝났는지. true면 ~48s 소진이라 키 로테이션·
        // 3.5 폴백을 또 돌릴 60s 예산이 없으므로 모두 차단. if(!useLangChain) 밖 폴백도 읽으므로 hoist.
        let ytPrimaryTimedOut = false;

        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = apiKey; // start with the key already chosen above
            let sdkAttempt = 0;
            // When multimodal content (YouTube fileData, PDF URL) causes a 500,
            // retry once without media parts + Google Search enabled.
            let forceTextOnly = false;
            // 503(UNAVAILABLE)은 API 키가 아니라 모델 측 혼잡 → 다음 키도 같은 모델이면 똑같이 503.
            // 3.5-flash가 503이면 throughput 좋은 2.5-flash로 강등해 재시도 (전 키 소진 방지).
            // 한 번 set되면 이후 attempt에서 유지.
            let unavailableDowngrade = false;

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
                // Track whether this attempt included multimodal parts (readable in catch)
                let hadMultimodalContent = false;

                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });
                    // 이 attempt의 모든 SDK 서브콜을 한 데드라인으로 묶음 — 행/혼잡 시 catch의 timeout 강등 경로로.
                    // 영상 턴만 예산형 긴 데드라인(48s) — 25s는 정상 영상 분석을 끊는다(DEV_260627 회귀).
                    const attemptTimeoutMs = isYtVideoTurn ? YOUTUBE_CALL_TIMEOUT_MS : SDK_CALL_TIMEOUT_MS;
                    const attemptSignal = AbortSignal.timeout(attemptTimeoutMs);

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

                    // 이미지·영상 미디어 턴은 2.5로 고정(PDF/문서 제외). 무료티어 3.5 멀티모달은
                    // throughput 한계로 이미지 ~56s·영상 더 느림 → 60s 캡 초과(웹 타임아웃). 2.5는 ~5s.
                    // hasMultimodalContent는 isRecent 윈도우(최근 3턴) 미디어를 반영 → 멀티턴 후속도 자동 커버,
                    // 미디어가 윈도우 밖으로 밀려 텍스트로 강등되면 3.5 복귀. (DEV_260626 §2 측정 패밀리)
                    const isMediaTurn = hasMultimodalContent && !hasDocumentContent;
                    // 3.x Search grounding 은 무료티어 미지원 → 검색 콜은 2.5 로 강등(needsSearchFallback).
                    // 이미지/영상 미디어 턴은 멀티모달이 느린 모델(3.5)만 2.5 로 핀; 3.6 은 fastMultimodal 이라 직접 처리.
                    // 503 다운그레이드가 걸리면 검색 여부와 무관하게 2.5로 강등.
                    const pinMedia = isMediaTurn && !modelCaps(resolvedModel).fastMultimodal;
                    const effectiveModel = ((useGoogleSearch && needsSearchFallback) || unavailableDowngrade || pinMedia)
                        ? SEARCH_FALLBACK_MODEL
                        : resolvedModel;
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph]', resolvedModel, '+ Google Search → falling back to', SEARCH_FALLBACK_MODEL, 'for grounding (free-tier)');
                    }
                    if (pinMedia) {
                        console.log('[LangGraph] Image/video turn → pinning to', SEARCH_FALLBACK_MODEL, '(free-tier', resolvedModel, 'multimodal exceeds 60s cap)');
                    }
                    console.log('[LangGraph] Starting SDK stream | model:', effectiveModel, '| useGoogleSearch:', useGoogleSearch, '| maxTokens:', effectiveMaxTokens, '| contentsLen:', sdkContents.length);

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
                    const is3xModel = isThreeXFlash(effectiveModel);
                    const thinkingConfig = resolveThinkingConfig({
                        is3xModel, isYoutubeRequest, hasVideoData, hasUrlContent, isMediaTurn, intent: state.intent,
                    });

                    // 3.5 + Google Search → 2.5 single-pass grounding (Stage2 3.5 재합성 제거, DEV_260624 §6).
                    // 무료티어 3.5 grounding은 429라 2.5로 검색하고, 그 결과를 그대로 최종 답으로 사용.
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] Grounding via 2.5 single-pass (Stage2 3.5 synthesis removed)');

                        const stage1Response = await genai.models.generateContent({
                            model: SEARCH_FALLBACK_MODEL,
                            contents: sdkContents,
                            config: {
                                abortSignal: attemptSignal,
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
                            console.warn('[LangGraph] Grounding stage1 empty — retrying once with next key');
                            const s1RetryKey = getNextApiKey() ?? sdkApiKey;
                            const s1Retry = await new GoogleGenAI({ apiKey: s1RetryKey }).models.generateContent({
                                model: SEARCH_FALLBACK_MODEL,
                                contents: sdkContents,
                                config: {
                                    abortSignal: attemptSignal,
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
                                console.log('[LangGraph] Grounding stage1 retry succeeded');
                            }
                        }
                        if (!stage1Text) {
                            throw new Error('Stage1 grounding returned empty grounded text');
                        }

                        // Stage2(3.5 재합성) 제거 — Stage1(2.5+search)이 finalInstruction로 완결 답변 생성.
                        // DEV_260624 §6: 2.5 single-pass가 two-track 대비 ~40% 빠르고 품질 동등,
                        // production의 throttled 3.5 무료티어(§3)를 회피. weather 표 등 포맷은 base 프롬프트가 담당.
                        responseText = stage1Text;
                    } else {
                        // thinkingLevel may exhaust the thinking budget → only thought parts returned → empty text.
                        // Retry once with "minimal" thinking before giving up.
                        let singlePassResponse = await genai.models.generateContent({
                            model: effectiveModel,
                            contents: sdkContents,
                            config: {
                                abortSignal: attemptSignal,
                                systemInstruction: finalInstruction,
                                ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                ...(is3xModel ? {} : { temperature: 0.2, topP: 0.8, topK: 40 }),
                                maxOutputTokens: effectiveMaxTokens,
                                ...videoMediaResolution,
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
                                    abortSignal: attemptSignal,
                                    systemInstruction: finalInstruction,
                                    ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                    maxOutputTokens: effectiveMaxTokens,
                                    ...videoMediaResolution,
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
                                        abortSignal: attemptSignal,
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
                                    abortSignal: attemptSignal,
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
                        console.log(`[LangGraph] Grounding sources: ${groundingSources.length}`);
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
                        // 영상 턴 timeout은 이미 ~48s 소진 → 또 다른 48s 시도/3.5 폴백은 60s 캡 초과.
                        // 로테이션·폴백 모두 차단하고 즉시 종료(누적 타임아웃 폭주 방지).
                        if (isYtVideoTurn && isTimeout) {
                            ytPrimaryTimedOut = true;
                            console.warn('[LangGraph] YouTube video timeout after', YOUTUBE_CALL_TIMEOUT_MS, 'ms — no budget for retry/fallback, stopping');
                            break;
                        }
                        // 503/timeout on 3.5 = 모델 측 혼잡(키 무관) → 키만 돌리면 같은 3.5에 또 막힘.
                        // 첫 발생에서 throughput 좋은 2.5로 강등(AbortSignal 25s 컷이 production 60s 캡 안에서 재시도 예산 확보).
                        const justDowngraded = (isUnavailable || isTimeout) && !unavailableDowngrade && isThreeXFlash(resolvedModel);
                        if (justDowngraded) {
                            unavailableDowngrade = true;
                            console.log(`[LangGraph] ${isTimeout ? 'timeout' : '503'} on 3.5-flash — downgrading retries to 2.5-flash (better free-tier throughput)`);
                        }
                        const nextKey = getNextApiKey();
                        if (nextKey && nextKey !== sdkApiKey) {
                            sdkApiKey = nextKey;
                            sdkAttempt++;
                            console.log(`[LangGraph] Retrying SDK call (attempt ${sdkAttempt + 1}) reason:`, isRateLimit ? '429' : isTimeout ? 'timeout' : '503', '| model:', unavailableDowngrade ? '2.5(downgraded)' : resolvedModel);
                            continue;
                        }
                        // 다른 키가 없어도 방금 2.5로 강등했으면 같은 키로 재시도(모델이 바뀌므로 의미 있음).
                        if (justDowngraded) {
                            sdkAttempt++;
                            console.log(`[LangGraph] Retrying on 2.5-flash (same key, attempt ${sdkAttempt + 1}) — downgrade after ${isTimeout ? 'timeout' : '503'}`);
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
        // ytPrimaryTimedOut: primary가 48s를 다 써 timeout이면 3.5 폴백(더 느림)은 60s 캡 초과 →
        // 빠른 실패(429/500/빈응답)에서만 폴백, timeout에서는 스킵.
        // primary 가 2.5 로 핀된 경우(느린 멀티모달 모델 선택)에만 3.5 최후 폴백. 3.6 은 직접 처리라 제외.
        if (!useLangChain && !sdkSuccess && isYtVideoTurn && !ytPrimaryTimedOut && resolvedModel === SERVER_MODELS.FLASH) {
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
                        abortSignal: AbortSignal.timeout(SDK_CALL_TIMEOUT_MS),
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
