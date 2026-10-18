import { AgentStateType } from "../state";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyInvalid, isPaidKey, API_KEYS } from "../../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS, modelCaps, isThreeXFlash } from "../../models";
import { AIMessage } from "@langchain/core/messages";
import { type LangName, DEFAULT_LANG_NAME } from "../lang";
import { buildSdkContents } from "./sdk-contents";
import { resolveMaxTokens, resolveThinkingConfig, thinkingRetryLevel, heavyMediaTimeoutAction } from "./generation-config";
import { decideGoogleSearch } from "./search-gate";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";
import { needsHospitalHoursLookup } from "../card-followup";
import { assemblePrompt, resolveCardEntity } from "../prompt-assembly";
import { hasVideoPart } from "../video-turn";
import { fetchHospitalOpenStatus } from "../hospital-hours";
import { resolveAreaCodesFromAddress } from "../hospital-tool";
import { runLangChainPath } from "./langchain-path";
import { applyGeminiCitations } from "../gemini-citations";
import { generateOpenAIChat } from "../../openai/chat";
import { hasOpenAIUnsupportedMedia, hasOpenAIPdf, isOpenAIFileFetchError } from "../../openai/media";
import { isOpenAIChatModel } from "../../openai/models";
import { withSearchProviderInstruction } from "../search-provider";
import { getLocalFunctionTool } from "../local-tool-registry";
import { withExplicitSearchFollowup, shouldDropImageForSearch } from "../search-signals";
import { emitStatus } from "../status-event";

// SDK 호출 1회(attempt)당 상한 — 행 감지 UX 가드. 일반 텍스트 턴이 25s 넘게 무응답이면
// 끊고 2.5 로 강등 재시도하는 편이 사용자에게 낫다. 건강한 응답은 보통 <15s 라 거의 안 잘린다 → DEV_260808 §9
export const SDK_CALL_TIMEOUT_MS = 25_000;
// 무거운 미디어 턴(YouTube·업로드 영상·대용량 PDF) 전용 상한 — 일반 턴과 프로파일이 정반대다.
// 영상 토큰이 무거운 단일 호출이 수십 초를 정당하게 쓴다(YouTube ~30~48s, 6.5MB PDF 최대 ~55s).
// 일반 턴의 25s 를 일률 적용하면 정상 분석이 끊겨 키 로테이션·폴백이 쌓인다 → DEV_260627·DEV_260703
// 90s = 측정 최대의 약 1.6배이고, 강등 재시도까지 90×2=180s < maxDuration 300s 로 예산 안에 든다 → DEV_260808 §9
// 도중 abort 시엔 스트리밍 부분 응답이 복구된다(아래 partial stream 처리).
export const HEAVY_MEDIA_CALL_TIMEOUT_MS = 90_000;

/**
 * Generator 노드
 * 동적 컨텍스트를 모두 담은 최종 시스템 메시지를 만들고 멀티모달 챗 모델을 호출한다.
 * 일반 인텐트는 @google/genai SDK 를 직접 써서 groundingMetadata 를 받는다
 * (@langchain/google-genai 의 응답 파싱은 이 값을 버린다).
 */
export const createGeneratorNode = (
    systemInstructionBase: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void,
    langName: LangName = DEFAULT_LANG_NAME,
    /** 9단계 A/B 전용 손잡이 — 프로덕션은 넘기지 않으므로 항상 기본값(현재 동작). */
    experiment: { timeBlockAt?: 'start' | 'end' | 'both' } = {},
) => {
    // 이름을 붙여 둔다 — GPT 가 PDF 링크를 못 받으면 같은 노드를 2.5 로 한 번 다시 부른다(openAIPdfFallback).
    const generate = async (state: AgentStateType): Promise<any> => {
        console.log('[LangGraph] Entering Generator Node');
        console.log('[LangGraph] Selected provider model | intent:', state.intent, '| model:', state.model);

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

        // 현재 날짜·시간 주입 — 환각 방지
        const now = new Date();
        const tz = state.timeZone || 'Asia/Seoul';
        // 날짜 표기 형식 실험(`dateFormat`)은 효과가 판정되지 않아 제거했다 — 원인이 문구가 아니다.
        // 다시 시도하기 전에 DEV_260928 §13-4 를 먼저 읽을 것.
        const currentDateStr = new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
            hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short'
        }).format(now);

        // **사실 수집은 여기, 규칙 조립은 prompt-assembly.ts** (PLAN_PROMPT_LAYERING §7-6).
        // 조립 함수가 네트워크를 타면 골든 테스트가 외부 API 에 좌우되므로 심평원 조회는 여기서 한다.
        // 기관 지목은 **한 번만** 구해 조회와 조립에 함께 넘긴다(두 경로가 다른 기관을 보면 안 된다).
        const followupCardContext = state.cardFollowup ? state.cardContexts?.[state.cardFollowup] : undefined;
        const cardEntity = followupCardContext
            ? resolveCardEntity(followupCardContext, latestUserText)
            : { namedEntity: undefined, namedAddress: '' };
        let hospitalStatus: Awaited<ReturnType<typeof fetchHospitalOpenStatus>> | null = null;
        // 이건 규칙이 아니라 **사실**이라 호출부에 남는다 — 아래 검색 게이트 두 곳이 읽는다.
        //    (조립부도 같은 값을 내부에서 판정한다. 조건이 같으므로 두 값은 항상 일치한다 —
        //     `needsHospitalHoursLookup` 이 참인데 조회 결과가 없으면 참.)
        let hospitalHoursUnavailable = false;
        if (state.cardFollowup && followupCardContext && needsHospitalHoursLookup(state.cardFollowup, latestUserText)) {
            const areaCodes = cardEntity.namedAddress ? resolveAreaCodesFromAddress(cardEntity.namedAddress) : undefined;
            hospitalStatus = cardEntity.namedEntity && areaCodes
                ? await fetchHospitalOpenStatus(cardEntity.namedEntity, areaCodes, now)
                : null;
            // 상호를 못 집었거나(이름 없이 물음) 세부정보가 미등록인 경우 모두 여기로 온다.
            if (!hospitalStatus) hospitalHoursUnavailable = true;
        }

        const finalInstruction = assemblePrompt({
            timeBlockAt: experiment.timeBlockAt,
            base: systemInstructionBase, state, langName, latestUserText,
            now, tz, currentDateStr, cardEntity, hospitalStatus,
        });

        // 인텐트 라우팅:
        // LangChain 경로 — 커스텀 도구가 필요한 인텐트 (아래 LANGCHAIN_INTENTS)
        // SDK 경로 — 나머지 전부 (Google Search grounding 가능)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search", "law_qa", "movie_search", "paper_search", "arxiv_search", "weather"];
        const useLangChain = LANGCHAIN_INTENTS.includes(state.intent);

        // hasVideoData: fileData(영상)가 실제로 전송되는 턴인지. 모델 핀과 ~625줄 YouTube
        // 폴백 블록이 함께 참조하므로 SDK 루프 밖으로 hoist.
        // 판정은 `video-turn.ts` 한 곳에만 둔다 — `route.ts` 도 같은 값을 써서 영상
        //    프롬프트 블록을 켠다. 인라인으로 두 벌이면 한쪽만 고쳐진다.
        const hasVideoData = hasVideoPart(state.messages);
        // 영상을 실제 읽는 YouTube 턴 — 예산형 단일 데드라인(YOUTUBE_CALL_TIMEOUT_MS) 대상.
        const isYtVideoTurn = isYoutubeRequest && hasVideoData;

        // 영상 입력 토큰 절감 — YouTube 영상은 기본 해상도로 ~31만 토큰이라 인제스트가 90s+ 걸린다.
        // LOW 해상도는 프레임당 토큰을 크게 줄여 ~11만 토큰·~23s(무료)로 끝난다(요약은 화질 무관) → DEV_260703
        const videoMediaResolution: any = isYtVideoTurn ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {};

        // YouTube 는 영상 토큰이 무거워 가장 느린 경로 — 영상을 실제 읽는 턴만 thinking 없는 2.5로 고정한다.
        // 멀티턴 후속 질문(URL은 history에만 있고 영상 미재전송 → hasVideoData=false)은 영상
        // 토큰이 없어 느려질 위험이 낮으므로 일반 대화 정책으로 복귀시킨다. 아래 폴백 블록도
        // isYoutubeRequest && hasVideoData 조건이라 영상 턴에서만 2.5→3.5 폴백이 동작한다.
        // URL 본문이 주입된 턴은 "주어진 기사 요약"이라 Search OFF + 본문이 답을 결정한다.
        // 선택 모델이 무료티어에서 긴 입력에 느리면(`fastLongInput=false`) 2.5에 고정해 지연을 줄인다.
        const hasUrlContentForModel = (state.webContent || '').includes('[URL_CONTENT:');
        // 핀 판정 기준 = 사용자 선택 모델(sel). 영상/URL 핀은 그 모델이 무료티어에서 느릴 때만 2.5 강등.
        // 3.6 은 영상(fastMultimodal)·긴입력(fastLongInput) 모두 빠르므로 핀 안 됨(직접 처리). 3.5 는 붕괴 → 핀.
        const sel = state.model || DEFAULT_CHAT_MODEL;
        const selCaps = modelCaps(sel);
        const pinYoutube = isYoutubeRequest && hasVideoData && !selCaps.fastMultimodal;
        const pinUrl = hasUrlContentForModel && !selCaps.fastLongInput;
        // 업로드 첨부(영상·대용량 PDF·오디오)는 Storage 공개 URL 을 fileData 로 보낸다.
        // 3.x 는 **임의 URL fileData 에 429 RESOURCE_EXHAUSTED** 를 낸다(YouTube fileData·인라인 이미지는 정상
        // → `urlFileData` 축). 강등하지 않으면 429 가 키 로테이션을 타고 12키 × ~12s ≈ 144s 를 태운 끝에
        // "응답을 받지 못했습니다"로 끝난다 — 어떤 키로도 성공하지 못하는 실패다 → DEV_260808
        const hasUrlFileData = state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) =>
                p.fileData?.fileUri && !/youtube\.com|youtu\.be/.test(p.fileData.fileUri))
        );
        // GPT 는 이 축과 무관하다 — PDF 는 input_file 로 직접 받고(media.ts), 영상·오디오는 아래 핀이 잡는다.
        const pinUrlFileData = hasUrlFileData && !selCaps.urlFileData && !isOpenAIChatModel(sel);
        // OpenAI 선택 모델은 텍스트·이미지·PDF 를 직접 처리한다(PDF 는 Responses input_file — DEV_261011).
        // Responses 가 받지 않는 영상·오디오만 기존 검증된 Gemini 2.5 경로로 핀한다.
        const pinOpenAIUnsupportedMedia = isOpenAIChatModel(sel) && hasOpenAIUnsupportedMedia(state.messages);
        // 예산형 단일 데드라인 대상 — 영상 토큰이 무거운 단일 heavy 호출이라 25s 로는 정상 응답이 끊긴다.
        const isHeavyMediaTurn = isYtVideoTurn || hasUrlFileData;
        const resolvedModel = (pinYoutube || pinUrlFileData || pinOpenAIUnsupportedMedia || (pinUrl && !isOpenAIChatModel(sel)))
            ? SERVER_MODELS.FLASH
            : sel;
        if (pinYoutube) {
            // L23 로그는 state.model(클라 선택)을 찍어 오해 소지 — 핀 실제값을 명시.
            console.log(`[LangGraph] YouTube video turn → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        } else if (pinUrl) {
            console.log(`[LangGraph] URL summary turn → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        } else if (pinUrlFileData) {
            console.log(`[LangGraph] Uploaded media (URL fileData) → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        } else if (pinOpenAIUnsupportedMedia) {
            console.log(`[LangGraph] OpenAI unsupported media → model pinned to ${resolvedModel} (was state.model=${state.model})`);
        }

        // SDK 경로: 도구 없는 인텐트 전부 (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK 는 fileData(YouTube)·inlineData(이미지/PDF)를 기본 지원한다.
        // 멀티모달 내용이 없으면 Google Search grounding 을 켠다.
        // 검색 턴 강등 모델 — 무료 키에서 검색이 안 되거나 grounding 이 불안정한 모델은
        // 검색이 필요할 때 2.5 Flash 로 답한다(아래 searchFallbackFor·rmCaps 가 판정).
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        // 검색 턴을 2.5 로 강등하는 조건 — **독립된 두 축의 OR** 다.
        //   ① freeTierSearch=false : 무료티어에서 3.x grounding 이 아예 429 (과금 사실)
        //   ② groundingReliable=false : 검색이 발동해도 모델이 결과를 반영하지 않음 (답변 품질)
        // 지금 두 축은 3.5·3.6 에서 우연히 같은 값을 낸다. 합쳐 두면, 유료 티어로 올리며
        //    ①만 보고 `freeTierSearch: true` 로 뒤집었을 때 **에러 없이** 3.6 의 2/5 오답이
        //    출처 칩을 달고 나가기 시작한다. 그래서 이름을 나눠 둔다.
        const rmCaps = modelCaps(resolvedModel);
        // ①은 **키에 달렸다** — 유료 키면 3.x 검색이 된다(PLAN_GEMINI_PAID_FIRST_261004 §6). 그래서 시도마다
        // 지금 키로 다시 판단한다: 회원 유료 키가 실패해 무료 키로 내려가면 모델도 2.5 로 같이 내려간다.
        const searchFallbackFor = (apiKey: string) =>
            (!rmCaps.freeTierSearch && !isPaidKey(apiKey)) || !rmCaps.groundingReliable;
        let sdkSuccess = false; // if 블록 밖에 선언 — 아래 LangChain 폴백 판정이 읽는다
        // 영상 턴 primary(2.5)가 데드라인 timeout으로 끝났는지. true면 heavy 상한을 다 쓴 것이고, 더 느린
        // 3.5 폴백·키 로테이션은 같은 영상을 또 오래 붙잡을 뿐이라 모두 차단한다. if(!useLangChain) 밖 폴백도 읽으므로 hoist.
        let ytPrimaryTimedOut = false;

        // OpenAI 선택 경로. 일반 생성과 검색뿐 아니라 intent가 확정된 로컬 도구도 같은
        // 선택 모델에서 Responses function calling으로 실행한다. drug_id와 영상·오디오 등
        // 미지원 modality만 레지스트리에 없거나 위에서 Gemini로 핀되어 capability fallback된다.
        const localFunctionTool = getLocalFunctionTool(state.intent);
        if ((!useLangChain || localFunctionTool) && isOpenAIChatModel(resolvedModel)) {
            const { hasMultimodalContent, hasDocumentContent } = buildSdkContents(state.messages, false);
            const { useGoogleSearch: searchRequested, hasUrlContent } = decideGoogleSearch({
                webContent: state.webContent,
                messages: state.messages,
                intent: state.intent,
                needsSearch: state.needsSearch || hospitalHoursUnavailable,
                hasMultimodalContent,
                // OpenAI 는 input_image 와 web_search 를 함께 보낼 수 있다 — `provider: 'openai'` 로
                // 이미지 첨부 직후 턴에도 명시 검색 요청이 막히지 않게 한다(→ DEV_260902 §9.1).
                provider: 'openai',
                isYoutubeRequest,
                hasVideoData,
                latestUserText,
                lastTurnSearched: state.lastTurnSearched,
            });
            // 로컬 함수와 hosted web_search를 한 호출에 섞지 않는다. drug_info의 보조 웹
            // 검색은 기존 도구 내부에서 수행되며, 나머지 로컬 intent는 단일 책임 함수만 강제한다.
            const useWebSearch = !localFunctionTool && searchRequested;
            if (useWebSearch) await emitStatus('searching');
            // 논문 카드 + 명시 검색 요청이면 종합 단계에 웹 검색을 붙인다(판정은 레지스트리에).
            const functionTool = withExplicitSearchFollowup(localFunctionTool, latestUserText);
            const resolvedMaxTokens = resolveMaxTokens({
                hasDocumentContent,
                isYoutubeRequest,
                hasMultimodalContent,
                hasUrlContent,
                intent: state.intent,
            });
            const effectiveMaxTokens = useWebSearch && resolvedMaxTokens < 8192 ? 8192 : resolvedMaxTokens;
            console.log('[LangGraph] Starting OpenAI Responses call | model:', resolvedModel, '| useWebSearch:', useWebSearch, '| maxTokens:', effectiveMaxTokens);
            let result;
            try {
                result = await generateOpenAIChat({
                    model: resolvedModel,
                    messages: state.messages,
                    instructions: finalInstruction,
                    useWebSearch,
                    maxOutputTokens: effectiveMaxTokens,
                    functionTool,
                });
            } catch (error: any) {
                // OpenAI 가 PDF 링크를 못 받아 왔다(봇 차단·로그인 필요·만료 — 400 "Error while downloading file.").
                // 이 턴만 Gemini 2.5 로 다시 부른다. 2.5 는 지금까지 PDF 를 받아 온 검증된 경로다.
                const openAIPdfFallback = isOpenAIFileFetchError(error) && hasOpenAIPdf(state.messages);
                if (!openAIPdfFallback) throw error;
                console.warn(`[LangGraph] OpenAI PDF fetch failed (${error.message}) — retrying this turn on ${SERVER_MODELS.FLASH}`);
                return generate({ ...state, model: SERVER_MODELS.FLASH });
            }
            // Responses API는 현재 비스트리밍 호출이다. 텍스트 전송·DB 누적은 route의
            // generator on_chain_end 한 곳에서만 처리해 중복 전송을 막는다.
            return { messages: [new AIMessage(result.text)], groundingSources: result.sources, provider: 'openai' };
        }

        // OpenAI 일반 요청은 Gemini 키와 독립적으로 위에서 완료된다. Gemini SDK·LangChain
        // 도구·멀티모달 capability fallback에 실제로 진입할 때만 Gemini 키를 요구한다.
        const geminiApiKey = getNextApiKey();
        console.log('[LangGraph] Gemini key required:', true, '| available:', !!geminiApiKey, '| key:', isPaidKey(geminiApiKey) ? 'paid' : 'free', '| intent:', state.intent);
        if (!geminiApiKey) throw new Error("No Gemini API key available");

        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = geminiApiKey;
            let sdkAttempt = 0;
            // 멀티모달 내용(YouTube fileData, PDF URL)이 500 을 내면
            // 미디어 없이 Google Search 를 켜고 한 번 재시도한다.
            let forceTextOnly = false;
            // 503(UNAVAILABLE)은 API 키가 아니라 모델 측 혼잡 → 다음 키도 같은 모델이면 똑같이 503.
            // 3.5-flash가 503이면 throughput 좋은 2.5-flash로 강등해 재시도 (전 키 소진 방지).
            // 한 번 set되면 이후 attempt에서 유지.
            let unavailableDowngrade = false;
            // 429 를 낸 **서로 다른** 키. 429 는 두 가지가 겹쳐 오는데 응답만으로 구분이 안 된다
            // (무료티어는 quotaMetric·retryDelay 없이 맨 429 만 준다):
            //   ⓐ 그 키의 쿼터 소진 → 다른 키로 바꾸면 성공한다 (로테이션이 정답)
            //   ⓑ 모델이 그 요청을 아예 거부 → 어떤 키로도 실패한다 (로테이션은 예산만 태운다)
            // 구분은 **행동으로** 한다: 서로 다른 키 2개가 같은 모델에서 429 면 ⓑ 로 보고 모델을 강등한다.
            // ⓐ 오판 비용은 낮고(2.5 도 잘 답한다), ⓑ 를 놓치면 12키 × ~12s ≈ 144s 를 태운 끝에
            // "응답을 받지 못했습니다"로 끝난다 → DEV_260808
            const rateLimitedKeys = new Set<string>();

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
            // 판정은 search-signals 로 나가 있다 — 하니스가 프로덕션 함수를 그대로 실행하기 위해서다.
            // `medical_qa` 도 대상이다: tier 100 검색 강제 ON 인 의도라, 400 에 눌리면 이미지 직후 턴 동안
            // "출처 기반 답변" 정책이 무효가 된다 → DEV_260902 §9.2
            const dropImageForSearch = shouldDropImageForSearch({
                intent: state.intent,
                currentTurnHasImage: _currentTurnHasImage,
                historyHasImage: _historyHasImageForGuard,
                explicitSearchSignal: _explicitSearchForGuard,
            });
            if (dropImageForSearch) {
                forceTextOnly = true;
                console.log('[LangGraph] 이미지+검색 가드: history 이미지 제외 + Google Search 활성화 (명시적 팩트체크 요청)');
            }

            while (sdkAttempt < MAX_KEY_RETRIES) {
                // try 밖에 선언 — catch 의 중복 출력 가드가 읽는다
                let responseText = "";
                let groundingSources: any[] = [];
                // 이번 시도에 멀티모달 파트가 있었는지 (catch 에서 읽음)
                let hadMultimodalContent = false;

                try {
                    const genai = new GoogleGenAI({ apiKey: sdkApiKey });
                    const needsSearchFallback = searchFallbackFor(sdkApiKey);
                    // 이 attempt의 모든 SDK 서브콜을 한 데드라인으로 묶음 — 행/혼잡 시 catch의 timeout 강등 경로로.
                    // 무거운 미디어 턴만 긴 데드라인(HEAVY_MEDIA_CALL_TIMEOUT_MS) — 25s는 정상 영상 분석을 끊는다.
                    const attemptTimeoutMs = isHeavyMediaTurn ? HEAVY_MEDIA_CALL_TIMEOUT_MS : SDK_CALL_TIMEOUT_MS;
                    const attemptSignal = AbortSignal.timeout(attemptTimeoutMs);

                    // state 메시지로 contents 구성
                    // 멀티모달 파트(텍스트·이미지·PDF·영상/YouTube)를 SDK 형식으로 매핑
                    const { sdkContents, hasMultimodalContent, hasDocumentContent } = buildSdkContents(state.messages, forceTextOnly);
                    // hadMultimodalContent(catch 의 500 재시도용으로 try 밖에 선언)는
                    // hasMultimodalContent 를 따른다 — catch 경로가 읽도록 여기서 설정.
                    if (hasMultimodalContent) hadMultimodalContent = true;

                    // Google Search 게이트 — grounding 여부 판정 (multimodal/youtube/url/renderer/doc/general).
                    // useGoogleSearch 와 아래에서 쓰는 부가 값(토큰 상한·진단 로그)을 돌려준다.
                    const { useGoogleSearch, hasUrlContent, rendererIntents, explicitSearchRequested } = decideGoogleSearch({
                        webContent: state.webContent,
                        messages: state.messages,
                        intent: state.intent,
                        needsSearch: state.needsSearch || hospitalHoursUnavailable,
                        hasMultimodalContent,
                        isYoutubeRequest,
                        hasVideoData,
                        latestUserText,
                        lastTurnSearched: state.lastTurnSearched,
                    });
                    if (useGoogleSearch) await emitStatus('searching');
                    const googleProviderInstruction = withSearchProviderInstruction(
                        finalInstruction,
                        useGoogleSearch ? 'google' : 'none',
                    );

                    // 인텐트별 출력 토큰 상한(generation-config.ts)
                    const resolvedMaxTokens = resolveMaxTokens({
                        hasDocumentContent, isYoutubeRequest, hasMultimodalContent, hasUrlContent, intent: state.intent,
                    });
                    // Google Search grounding이 활성화되면 검색 결과 + 설명이 추가되어 토큰이 더 필요.
                    // 멀티턴에서도 히스토리가 쌓인 상태에서 grounding 응답이 길어질 수 있으므로 최소 8192 보장.
                    const effectiveMaxTokens = (useGoogleSearch && resolvedMaxTokens < 8192) ? 8192 : resolvedMaxTokens;

                    if (hasMultimodalContent && !isYoutubeRequest) {
                        console.log('[LangGraph] Image in conversation — Google Search disabled', { hasMultimodalContent, dropImageForSearch });
                    }
                    if (hasUrlContent) {
                        console.log('[LangGraph] URL content provided — Google Search disabled to use full article text');
                    }
                    if (rendererIntents.has(state.intent) && !explicitSearchRequested) {
                        console.log('[LangGraph] Renderer intent — Google Search disabled to preserve structured visualization output');
                    }

                    // 이미지·영상 미디어 턴은 2.5로 고정(PDF/문서 제외) — 무료티어 3.5 멀티모달은 throughput 이 낮아
                    // 이미지 ~56s·영상은 더 느리고, 2.5는 ~5s 다.
                    // hasMultimodalContent는 isRecent 윈도우(최근 3턴) 미디어를 반영 → 멀티턴 후속도 자동 커버,
                    // 미디어가 윈도우 밖으로 밀려 텍스트로 강등되면 선택 모델로 복귀한다 → DEV_260626 §2
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

                    // Thinking config — 모델별 분기(상세는 generation-config.ts):
                    // 3.x 는 thinkingLevel enum (thinkingBudget deprecated):
                    //   - YouTube native video: "minimal" — 사고를 꺼서 영상 분석 시간을 줄인다
                    //   - 렌더러 인텐트(astronomy/data_viz 등): "minimal" — 구조화 JSON 출력,
                    //     "low" 는 JSON 추론에 예산이 소진돼 빈 응답이 났다
                    //   - 멀티턴: "medium" — 후속 턴은 사용자 형식 요청을 지키려면 추론이 더 필요
                    //   - 첫 턴: "low" — 복잡한 첫 질문의 지연을 줄인다
                    // 2.5-flash 는 thinkingBudget 유지 (thinkingLevel 미지원일 수 있음):
                    //   - YouTube: budget 0 (끔 — 2.5-flash 에서 fileData 와 thinkingBudget>0 이면 503)
                    //   - medical_qa: budget 3000 (상한)
                    //   - 나머지: undefined (모델 기본값)
                    const is3xModel = isThreeXFlash(effectiveModel);
                    const thinkingConfig = resolveThinkingConfig({
                        model: effectiveModel, isYoutubeRequest, hasVideoData, hasUrlContent, isMediaTurn, intent: state.intent,
                    });

                    // 검색 강등 턴 → 2.5 single-pass grounding. 무료티어 3.x grounding 은 429 라 2.5로 검색하고,
                    // 그 결과를 그대로 최종 답으로 쓴다(재합성 단계 없음) → DEV_260624 §6
                    if (useGoogleSearch && needsSearchFallback) {
                        console.log('[LangGraph] Grounding via 2.5 single-pass (Stage2 3.5 synthesis removed)');

                        const stage1Response = await genai.models.generateContent({
                            model: SEARCH_FALLBACK_MODEL,
                            contents: sdkContents,
                            config: {
                                abortSignal: attemptSignal,
                                systemInstruction: googleProviderInstruction,
                                tools: [{ googleSearch: {} }],
                                temperature: 0.2,
                                topP: 0.8,
                                topK: 40,
                                maxOutputTokens: effectiveMaxTokens,
                                // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — dynamic thinking 이 grounding 지연의
                                // 주된 원인이고 budget 0 이 출처·표·정확도에서 동등하다 (PLAN_THINKING_LATENCY §5-1).
                                thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 },
                            }
                        });

                        const stage1Parts = stage1Response.candidates?.[0]?.content?.parts ?? [];
                        const stage1Grounding = stage1Response.candidates?.[0]?.groundingMetadata;
                        // 마커를 심기 전에 가짜 번호를 지우면 groundingSupports의 바이트 오프셋이
                        //    어긋난다. applyGeminiCitations가 삽입 → 정리 순서를 함께 처리한다.
                        const stage1Cited = applyGeminiCitations((stage1Response.text ?? stage1Parts
                            .filter((p: any) => !p.thought)
                            .map((p: any) => p.text || "")
                            .join("")), stage1Grounding);
                        let stage1Text = stage1Cited.text.trim();
                        if (stage1Cited.sources.length > 0) groundingSources = stage1Cited.sources;

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
                                    systemInstruction: googleProviderInstruction,
                                    tools: [{ googleSearch: {} }],
                                    temperature: 0.2,
                                    topP: 0.8,
                                    topK: 40,
                                    maxOutputTokens: effectiveMaxTokens,
                                    // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — dynamic thinking 이 grounding 지연의
                                    // 주된 원인이고 budget 0 이 출처·표·정확도에서 동등하다 (PLAN_THINKING_LATENCY §5-1).
                                thinkingConfig: state.intent === 'medical_qa' ? { thinkingBudget: 3000 } : { thinkingBudget: 0 },
                                }
                            });
                            const s1rParts = s1Retry.candidates?.[0]?.content?.parts ?? [];
                            const s1rGrounding = s1Retry.candidates?.[0]?.groundingMetadata;
                            const s1rCited = applyGeminiCitations((s1Retry.text ?? s1rParts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || "")
                                .join("")), s1rGrounding);
                            stage1Text = s1rCited.text.trim();
                            if (s1rCited.sources.length > 0) groundingSources = s1rCited.sources;
                            if (stage1Text) {
                                console.log('[LangGraph] Grounding stage1 retry succeeded');
                            }
                        }
                        if (!stage1Text) {
                            throw new Error('Stage1 grounding returned empty grounded text');
                        }

                        // 2.5+search 가 finalInstruction 으로 완결 답변을 만든다(재합성 없음 — 더 빠르고 품질 동등,
                        // DEV_260624 §6). weather 표 등 포맷은 base 프롬프트가 담당한다.
                        responseText = stage1Text;
                    } else {
                        // thinkingLevel 이 사고 예산을 다 쓰면 thought 파트만 오고 텍스트가 빈다.
                        // 포기하기 전에 "minimal" 로 한 번 재시도한다.
                        let singlePassResponse = await genai.models.generateContent({
                            model: effectiveModel,
                            contents: sdkContents,
                            config: {
                                abortSignal: attemptSignal,
                                systemInstruction: googleProviderInstruction,
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

                        // 비었고 minimal 이 아닌 thinkingLevel 을 썼으면 minimal 로 재시도
                        // 재시도 목표는 `'minimal'` 리터럴이 아니라 **그 모델의 최저 레벨**이다.
                        // 3.7 은 minimal 을 400 으로 거부하므로 리터럴이면 복구 시도가 곧 에러가 된다.
                        const retryLevel = thinkingRetryLevel(effectiveModel, (thinkingConfig as any)?.thinkingLevel);
                        if (!responseText && retryLevel) {
                            const candidate0 = singlePassResponse.candidates?.[0];
                            const finishReason = candidate0?.finishReason;
                            const thoughtOnlyParts = singleParts.filter((p: any) => p.thought).length;
                            console.warn('[LangGraph] Empty response - finishReason:', finishReason, '| thoughtParts:', thoughtOnlyParts, '| thinkingLevel:', (thinkingConfig as any).thinkingLevel, `— retrying with thinkingLevel=${retryLevel}`);
                            singlePassResponse = await genai.models.generateContent({
                                model: effectiveModel,
                                contents: sdkContents,
                                config: {
                                    abortSignal: attemptSignal,
                                    systemInstruction: googleProviderInstruction,
                                    ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                                    maxOutputTokens: effectiveMaxTokens,
                                    ...videoMediaResolution,
                                    thinkingConfig: { thinkingLevel: retryLevel } as any,
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
                            const singleCited = applyGeminiCitations(responseText, singleGrounding);
                            responseText = singleCited.text;
                            groundingSources = singleCited.sources.length > 0
                                ? singleCited.sources
                                : singleGrounding.groundingChunks
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
                                        systemInstruction: googleProviderInstruction,
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
                                    systemInstruction: withSearchProviderInstruction(finalInstruction, 'google'),
                                    tools: [{ googleSearch: {} }],
                                    temperature: 0.2,
                                    topP: 0.8,
                                    topK: 40,
                                    maxOutputTokens: effectiveMaxTokens,
                                    thinkingConfig: { thinkingBudget: 0 },
                                }
                            });
                            const grParts = groundRetry.candidates?.[0]?.content?.parts ?? [];
                            const grGrounding = groundRetry.candidates?.[0]?.groundingMetadata;
                            const grCited = applyGeminiCitations((groundRetry.text || grParts
                                .filter((p: any) => !p.thought)
                                .map((p: any) => p.text || '')
                                .join('')), grGrounding);
                            const grText = grCited.text.trim();
                            if (grCited.sources.length > 0) groundingSources = grCited.sources;
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
                    // 이미 클라이언트로 텍스트를 보냈으면 재시도하지 않는다 — 출력이 중복된다
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
                        if (isRateLimit) { markRateLimitKey(sdkApiKey, err); rateLimitedKeys.add(sdkApiKey); }
                        // 무거운 미디어 턴 timeout — **2.5 강등 1회만** 허용하고 그 다음엔 종료한다.
                        // maxDuration 300s 안에 90×2 가 들어가므로 강등 재시도로 건질 수 있는 실패를 버리지 않는다 → DEV_260808 §9
                        // 로테이션(같은 모델·다른 키)은 막는다 — 타임아웃은 키 쿼터가 아니라 모델 측 혼잡이라 키만 바꾸면
                        // 90s 를 또 태운다. 바꿀 가치가 있는 건 **모델**이다.
                        if (isHeavyMediaTurn && isTimeout) {
                            const action = heavyMediaTimeoutAction({
                                alreadyDowngraded: unavailableDowngrade,
                                resolvedModel,
                                fallbackModel: SEARCH_FALLBACK_MODEL,
                            });
                            if (action === 'stop') {
                                ytPrimaryTimedOut = true;
                                console.warn('[LangGraph] heavy media timeout after', HEAVY_MEDIA_CALL_TIMEOUT_MS, 'ms on', unavailableDowngrade ? SEARCH_FALLBACK_MODEL : resolvedModel, '— already downgraded, stopping');
                                break;
                            }
                            unavailableDowngrade = true;
                            sdkAttempt++;
                            console.warn('[LangGraph] heavy media timeout after', HEAVY_MEDIA_CALL_TIMEOUT_MS, 'ms on', resolvedModel, `— downgrading to ${SEARCH_FALLBACK_MODEL} for one retry (budget ${HEAVY_MEDIA_CALL_TIMEOUT_MS * 2}ms < maxDuration 300s)`);
                            continue;
                        }
                        // 503/timeout on 3.5 = 모델 측 혼잡(키 무관) → 키만 돌리면 같은 3.5에 또 막힘.
                        // 첫 발생에서 throughput 좋은 2.5로 강등(AbortSignal 25s 컷으로 행을 끊고 바로 재시도).
                        // 429 가 서로 다른 키 2개에서 났다 = 키 쿼터가 아니라 모델이 거부하는 요청(위 ⓑ).
                        // 키가 1개뿐인 환경(로컬 하니스 등)에선 로테이션 자체가 불가능하므로 1회로 판정한다.
                        const modelWide429 = isRateLimit && rateLimitedKeys.size >= Math.min(2, API_KEYS.length);
                        const justDowngraded = (isUnavailable || isTimeout || modelWide429) && !unavailableDowngrade && isThreeXFlash(resolvedModel);
                        if (justDowngraded) {
                            unavailableDowngrade = true;
                            const why = modelWide429 ? `429 on ${rateLimitedKeys.size} distinct keys (model-wide, not key quota)` : isTimeout ? 'timeout' : '503';
                            console.log(`[LangGraph] ${why} on ${resolvedModel} — downgrading retries to 2.5-flash`);
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
                        // 멀티모달 500: 영상·이미지에 접근 못 하거나 일시적 서버 오류.
                        // 미디어 없이 한 번 재시도 — Google Search 가 자동으로 켜진다 (hasMultimodalContent=false).
                        forceTextOnly = true;
                        sdkAttempt++;
                        console.warn('[LangGraph] SDK 500 on multimodal — retrying text-only with Google Search enabled');
                        continue;
                    }
                    // 안전 차단 — 재시도 없이 바로 전파
                    if (err?.safetyBlock) throw err;
                    // 재시도 불가 오류이거나 남은 키 없음
                    console.error('[LangGraph] SDK call failed:', err?.status, err?.message || err);
                    break;
                }
            }
        }

        // YouTube 폴백: primary 모델(2.5-flash) 실패 → 3.5-flash 로 재시도
        // ytPrimaryTimedOut: primary가 heavy 상한을 다 써 timeout이면 3.5 폴백(더 느림)도 끝나기 어렵다 →
        // 빠른 실패(429/500/빈응답)에서만 폴백, timeout에서는 스킵.
        // primary 가 2.5 로 핀된 경우(느린 멀티모달 모델 선택)에만 3.5 최후 폴백. 3.6 은 직접 처리라 제외.
        if (!useLangChain && !sdkSuccess && isYtVideoTurn && !ytPrimaryTimedOut && resolvedModel === SERVER_MODELS.FLASH) {
            console.log('[LangGraph] YouTube fallback: all', resolvedModel, 'keys failed — retrying with', SERVER_MODELS.FLASH_3_5);
            try {
                const fbKey = getNextApiKey() ?? geminiApiKey;
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
                        // 이 폴백도 fileData 파트를 그대로 싣는다(위 fbContents 조립) — 즉 무거운 미디어 턴이 여기 도달할 수 있다.
                        // 25s 일률이면 정상 분석을 끊으므로 데드라인 축을 위와 일치시킨다.
                        abortSignal: AbortSignal.timeout(isHeavyMediaTurn ? HEAVY_MEDIA_CALL_TIMEOUT_MS : SDK_CALL_TIMEOUT_MS),
                        systemInstruction: withSearchProviderInstruction(finalInstruction, 'none'),
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

        // LangChain 경로: drug_id/drug_info 등 커스텀 도구가 필요한 인텐트, 그리고 SDK 경로가
        // 완전히 실패했을 때의 비스트리밍 폴백. 여기서 반드시 반환하거나 throw 한다.
        return await runLangChainPath({
            state,
            finalInstruction,
            resolvedModel,
            apiKey: geminiApiKey,
            systemInstructionBase,
            useLangChain,
            sdkSuccess,
            isYoutubeRequest,
            hasVideoData,
            langName,
        });
    };
    return generate;
};
