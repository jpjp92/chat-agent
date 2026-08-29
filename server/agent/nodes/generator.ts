import { AgentStateType } from "../state";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError, API_KEYS } from "../../config";
import { DEFAULT_CHAT_MODEL, SERVER_MODELS, modelCaps, isThreeXFlash } from "../../models";
import { AIMessage } from "@langchain/core/messages";
import { getIntentFocusHint, getRendererSections } from "../prompt";
import { type LangName, DEFAULT_LANG_NAME } from "../lang";
import { buildSdkContents } from "./sdk-contents";
import { resolveMaxTokens, resolveThinkingConfig, thinkingRetryLevel, heavyMediaTimeoutAction } from "./generation-config";
import { decideGoogleSearch } from "./search-gate";
import { isTimeoutError, isAuthError, markRateLimitKey } from "./retry";
import { buildCardFollowupFacts, buildHospitalHoursFacts, buildSearchTargetBlock, extractCardEntityNames, findCardEntityAddress, needsHospitalHoursLookup } from "../card-followup";
import { fetchHospitalOpenStatus } from "../hospital-hours";
import { resolveAreaCodesFromAddress } from "../hospital-tool";
import { runLangChainPath } from "./langchain-path";
import { buildDateLadder } from "../weather-followup";
import { applyGeminiCitations } from "../gemini-citations";
import { generateOpenAIChat } from "../../openai/chat";
import { isOpenAIChatModel } from "../../openai/models";
import { withSearchProviderInstruction } from "../search-provider";
import { getLocalFunctionTool } from "../local-tool-registry";

// SDK 호출 1회(attempt)당 상한. 3.5 행/혼잡을 강제 중단하고 2.5로 강등 재시도할 예산을 남긴다.
// 무료티어 3.5는 정상이면 보통 <15s라 건강한 응답은 거의 안 잘림(DEV: 3.5 free-tier throughput).
// 🔴 25s 의 원래 근거는 "25s×2 ≈ 50s < 60s 캡"이었으나 **그 캡은 우리가 건 것이었다**(DEV_260808 §9,
//    Hobby 도 300s). 값은 유지하되 근거는 바뀐다 — 이제 캡 회피가 아니라 **행 감지 UX 가드**다.
//    (일반 텍스트 턴이 25s 넘게 무응답이면 재시도가 사용자에게 더 낫다.)
export const SDK_CALL_TIMEOUT_MS = 25_000;
// YouTube 영상 턴은 프로파일이 정반대 — 영상 토큰이 무거운 단일 heavy 호출이 60s 예산
// 대부분을 정당하게 소모하고(정상 ~30~48s, 메모리 youtube-call-timeout-profile), 폴백 3.5는
// 무료티어 영상에서 오히려 더 느리다. 25s 일률 컷은 정상 분석을 끊어 키 로테이션·3.5 폴백이 각
// 25s씩 쌓여 60s 천장을 초과 → 전부 타임아웃(DEV_260627 회귀).
// 회귀 본질: aa9d701 이전엔 SDK 경로에 per-call 타임아웃이 없어 유튜브가 60s 캡 직전(~59s)까지
// 예산을 다 썼고 잘 됐다. 48s는 정상 상한(~48s)과 겹쳐 살짝 초과한 정상 호출을 잘랐다
// (DEV_260703: 48.38s 로그 = 우리 데드라인 발화). 원래 예산을 충실히 원복 — 57s로 상향.
// 도중 abort 시엔 스트리밍 부분 응답이 복구된다(아래 partial stream 처리).
// 🔴 대상은 YouTube 만이 아니다 — **업로드 영상·대용량 PDF 도 같은 프로파일**이다(DEV_260808 실측:
// 업로드 영상 21s · 400p PDF 21~32s · 6.5MB PDF 최대 54.9s). 25s 일률 컷은 이들도 정상 분석
// 도중에 끊어 키 로테이션을 유발한다 — YouTube 가 겪은 회귀와 같은 구조다.
//
// 🔴 57 → 90 (DEV_260808 §9). 57 은 "60s 캡까지 ~3s 여유"에서 나온 값인데, **그 60s 는 플랫폼
//    한계가 아니라 route.ts 가 스스로 건 값이었다**(Hobby 도 fluid 기본·최대 300s). 캡을 300 으로
//    돌리면 57 이 곧바로 새 병목이 된다 — 6.5MB PDF 실측 최대가 54.9s 라 **여유가 2s 뿐**이었다.
//    90s 로 잡으면 실측 최대의 1.6배이고, 강등 재시도까지 90×2=180s < 300s 로 예산 안에 든다.
export const HEAVY_MEDIA_CALL_TIMEOUT_MS = 90_000;
/** @deprecated 이름이 대상을 좁게 말한다 — HEAVY_MEDIA_CALL_TIMEOUT_MS 를 쓸 것. */
export const YOUTUBE_CALL_TIMEOUT_MS = HEAVY_MEDIA_CALL_TIMEOUT_MS;

/**
 * Generator Node
 * Prepares the final System Message with all dynamic context and invokes the multimodal Chat model.
 * For general intents, uses @google/genai SDK directly to capture groundingMetadata which
 * is lost by @langchain/google-genai's response parsing.
 */
export const createGeneratorNode = (systemInstructionBase: string, isYoutubeRequest: boolean, sendEvent?: (data: any) => void, langName: LangName = DEFAULT_LANG_NAME) => {
    return async (state: AgentStateType) => {
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

        let finalInstruction = systemInstructionBase;

        // Inject Current Date/Time to prevent hallucination
        const now = new Date();
        const tz = state.timeZone || 'Asia/Seoul';
        const currentDateStr = new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
            hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short'
        }).format(now);
        // 🔴 주입만으로는 부족했다. 실측(2026-08-24 00:20 KST): `오늘 나온 AI 뉴스`에 검색 결과
        //    기사 게시일(8/23)을 그대로 "오늘"이라고 답했다. 자정 직후에는 검색 결과 대부분이
        //    전날 자료라 모델이 그쪽을 오늘로 삼는다 — 이 값이 유일한 근거임을 못 박는다.
        finalInstruction = `[CURRENT_SYSTEM_TIME (Timezone: ${tz}): ${currentDateStr}]\n`
            + `- This is the ONLY source for today's date. Never infer it from search results, article publication dates, or your training data.\n`
            + `- Just after midnight most search results are from the previous day. That does NOT change today's date — it is still the value above.\n`
            + `- If the user asks for "today" and the newest material you found is from an earlier date, give that material but say in one short sentence which date it is from and that little has been published yet today. Do not silently present an earlier date's material as today's.\n\n`
            + finalInstruction;

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
        // 대화하도록 지시한다. (표 규칙 [WEATHER FORMATTING]은 이제 weather 의도에만 주입되므로
        //  이 턴엔 애초에 없지만, 히스토리의 이전 카드/표를 따라 그리는 관성은 남아 명시적으로 막는다.)
        if (state.weatherFollowup) {
            // 날짜 대응을 **모델에게 계산시키지 않는다.** 실측(2026-08-17): `내일 서울 비와?`에
            // 카드의 히어로 블록(= 오늘 강수 `19mm·60%`)을 그대로 집어 "내일 60%"라고 답했고,
            // 같은 답변에서 18일을 "모레"라고 불렀다(하루씩 밀림). 프롬프트에 CURRENT_SYSTEM_TIME이
            // 있어도 daily[].date와의 대응은 별개의 계산이라 틀린다 → 대응표를 서버가 만들어 준다.
            finalInstruction += `\n\n[날짜 대응표 — 이번 턴, 이 값이 정답입니다]\n${buildDateLadder(now, tz)}\n- \`json:weather\`의 \`daily[].date\`(YYYY-MM-DD)를 **위 표와 대조해서** 해당 날짜의 값을 쓰세요. 직접 날짜를 계산하지 마세요.\n- 🔴 \`current\`와 강수 히어로 블록은 **오늘** 값입니다. 내일·모레를 물으면 절대 쓰지 말고 \`daily\`에서 그 날짜를 찾으세요.\n- 요청받은 날짜가 \`daily\` 범위 밖이면 예보가 거기까지 없다고 밝히세요.`;
            finalInstruction += `\n\n[날씨 후속 대화 처리 규칙]\n- 화면에는 이미 날씨 카드가 표시되어 있고, 대화 기록의 \`json:weather\` 블록에 그 수치(현재 기온·체감·습도·5일 예보)가 들어 있습니다. 그 데이터를 근거로 사용자의 후속 질문(가장 더운 요일, 우산·빨래·외출 판단, 습도 해석, 옷차림 등)에 대화하듯 간결히 답하세요.\n- \`json:weather\` 블록을 다시 생성하지 마세요(이미 화면에 있음).\n- 5일 예보 표를 다시 그리지 마세요. 필요한 수치만 문장 안에서 인용하세요.\n- 데이터에 없는 정보(미세먼지·자외선·과거 기록·다른 지역 등)는 지어내지 말고 없다고 밝히세요.\n- 사용자가 다른 주제로 넘어가면 날씨 이야기를 계속 끌고 가지 말고 그 주제로 자연스럽게 이어가세요.`;
        }

        // 병원 세부정보가 미등록이라 서버 계산이 실패한 턴. 이 경우에만 검색으로 내려간다 —
        // 실측(2026-08-24, 광진구 표본 30): 세부정보 등록률이 전체 30%, 의원은 3/21뿐이다.
        // 있는 정답(심평원)을 두고 추정하지 않되, 없을 때 침묵하지도 않기 위한 폴백이다.
        let hospitalHoursUnavailable = false;

        if (state.cardFollowup && state.cardContexts?.[state.cardFollowup]) {
            const kind = state.cardFollowup;
            const cardContext = state.cardContexts[kind]!;
            let cardFacts = buildCardFollowupFacts(kind, cardContext, langName);

            // 사용자가 카드의 어느 기관을 지목했는가. 병원 진료시간 조회와 검색 대상 고정에
            // 같은 값을 쓴다 — 두 경로가 다른 기관을 보면 안 된다.
            const namedEntity = extractCardEntityNames(cardContext)
                .find(name => latestUserText.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')));
            const namedAddress = namedEntity ? findCardEntityAddress(cardContext, namedEntity) : '';

            // 병원 "지금 진료하나": 카드(병원기본목록)에는 진료시간이 없다. 심평원 세부정보로
            // 지목된 1건만 조회해 약국과 동일하게 서버가 상태를 확정한다. 실패하면 사실 블록을
            // 붙이지 않고 아래 기본 규칙("자료에 없음 + 전화 확인")이 그대로 적용된다.
            if (needsHospitalHoursLookup(kind, latestUserText)) {
                const named = namedEntity;
                const address = namedAddress;
                const areaCodes = address ? resolveAreaCodesFromAddress(address) : undefined;
                const status = named && areaCodes ? await fetchHospitalOpenStatus(named, areaCodes, now) : null;
                if (status) {
                    cardFacts = `${cardFacts ? `${cardFacts}\n\n` : ''}${buildHospitalHoursFacts(status, langName)}`;
                } else {
                    // 상호를 못 집었거나(이름 없이 물음) 세부정보가 미등록인 경우 모두 여기로 온다.
                    hospitalHoursUnavailable = true;
                }
            }
            // 라우터가 이 턴에만 검색을 열어 준 경우(동물병원 진료 여부). 카드에 그 사실이 없으므로
            // "추측 금지"를 유지하면 답이 막히고, 그냥 풀면 인허가 상태를 영업중으로 단정한다.
            // 검색 근거로 답하되 확정이 아님과 전화 확인을 함께 말하도록 규칙을 갈아끼운다.
            const liveStatusSearch = state.needsSearch === true || hospitalHoursUnavailable;
            // 검색으로 내려가는 턴에는 대상 기관을 값으로 못 박는다. 실측(2026-08-24): 상호만으로
            // 검색해 종로의 동명 동물병원 시간을 가져왔다. 검색어 구성보다 결과 검증이 확실하다.
            const searchTarget = liveStatusSearch
                ? buildSearchTargetBlock(namedEntity ?? '', namedAddress, langName)
                : '';
            if (searchTarget) cardFacts = `${cardFacts ? `${cardFacts}\n\n` : ''}${searchTarget}`;
            finalInstruction += `\n\n[DISPLAYED_CARD_SOURCE: ${kind}]\n${cardContext}${cardFacts ? `\n\n${cardFacts}` : ''}\n\n[표시된 카드 후속 대화 규칙]\n- 위 카드 데이터만 근거로 현재 질문에 자연스러운 텍스트로 답하세요. 카드 JSON을 다시 출력하거나 새 카드를 만들지 마세요.\n${liveStatusSearch ? '- 공식 자료에 이 기관의 진료시간이 없습니다. 이번 턴에 한해 웹 검색 결과를 근거로 답할 수 있습니다.\n- 🔴 진료시간·영업시간은 **검색으로 확인된 것만** 말하세요. 검색 결과에 없으면 기억이나 추측으로 채우지 말고 확인되지 않는다고 말하세요. 상호명에 24시라는 표기가 있다는 것은 근거가 아닙니다.\n- 검색으로 찾았더라도 확정된 정보가 아니라는 점과 방문 전 전화 확인이 필요하다는 점을 반드시 함께 밝히세요.\n- 위 [검색 대상] 블록이 있으면 그 상호와 주소의 기관만 답하세요. 결과 주소가 다르면 동명의 다른 기관이므로 버리세요.\n- 검색 결과로 새 카드를 만들지 말고 문장으로 답하세요.\\n- 카드의 인허가 상태(영업·정상)는 폐업하지 않았다는 뜻일 뿐 지금 진료 중이라는 근거가 아닙니다. 이것만 보고 영업 중이라고 말하지 마세요.' : '- 카드에 없는 거리, 진료과, 영업 여부, 법적 효과나 수치를 추측하지 마세요. 필요한 정보가 없으면 카드에는 없다고 짧게 밝히세요.\\n- 병원·동물병원 카드에는 현재 진료 여부가 없습니다. 인허가 상태(영업·정상)를 영업 중으로 해석하지 말고, 확인하려면 전화가 필요하다고 밝히세요.'}\n- 약국 카드의 현재 영업 여부는 위 [약국 영업 상태] 블록을 최우선으로 따르세요. 카드에 적힌 영업시간만 보고 현재 영업 중이라고 판단하거나 그 블록과 모순되는 답을 하지 마세요.\n- 🔴 위 블록들은 내부 참고 자료입니다. 대괄호 제목, 항목 이름, JSON 키 이름(is_open_now, hours_today 등)을 답변에 그대로 쓰지 말고 자연스러운 한국어로 바꿔 말하세요.\n- 사용자의 추측이 카드 사실과 맞으면 긍정으로, 어긋나면 부정으로 답을 시작하세요. 사실을 확인해 주면서 '아니요'로 시작하지 마세요.\n- 사용자 위치 좌표와 거리 데이터가 없으면 도로명 일치 결과를 '가장 가까운 순서'라고 표현하지 마세요. 정확한 거리 비교에는 상세 위치가 필요하다고 짧게 밝히세요.\n- 사용자가 선택·확인·감사를 표현했다면 같은 목록을 반복하지 말고 한두 문장으로 응답하세요.\n- 법률 카드라면 조문 문언과 시행일을 구분해 설명하고, 개별 사건에 대한 확정적 법률 판단처럼 말하지 마세요.`;
        }

        // 재구성 요청 턴(라우터 follow_up="refine"): "표로 정리해줘"·"요약해줘"·"비교해줘".
        // 이런 턴은 툴도 검색도 없이 도는 경우가 많아 모델이 추가한 내용을 검증할 장치가 없다.
        // 정적 프롬프트의 [REFORMAT REQUESTS] 규칙만으로는 안 먹혔다 — 직전 턴이 **빈 응답**이었는데
        // 제품 4개짜리 표를 만들어낸 사례가 있다(DEV_260815_DEPLOY_CHECK). 해당 턴에만 강하게 못 박는다.
        if (state.reformatTurn) {
            finalInstruction += `\n\n[재구성 요청 처리 규칙 — 이번 턴]\n- 이 턴은 직전 답변을 **다른 형식으로 다시 보여달라**는 요청입니다. 형식만 바꾸고 내용은 그대로 보존하세요.\n- 직전 답변에 없던 항목·제품명·브랜드·제조사·수치·날짜를 **추가하지 마세요.** 표의 행 수가 직전 답변의 항목 수보다 많아지면 잘못된 것입니다.\n- 칸을 채울 정보가 없으면 비워두거나 열을 빼세요. 기억으로 채우지 마세요.\n- **직전 답변이 비어 있거나 실패했다면 재구성할 대상이 없다고 말하세요.** 없는 원본을 상상해서 만들지 마세요.\n- 사용자가 명시적으로 "더 추가해서"·"다른 것도"라고 요청한 경우에만 예외입니다.`;
        }

        // 이번 턴 의도에 필요한 렌더러 스펙만 주입한다(base에는 더 이상 없음 — prompt.ts INTENT_RENDERERS).
        // 순서: base → 렌더러 스펙 → 의도 힌트. base가 앞에 고정돼야 암묵 캐싱 프리픽스가 유지된다.
        const rendererSections = getRendererSections(state.intent, langName);
        if (rendererSections) {
            finalInstruction += `\n\n${rendererSections}`;
        }

        // Inject intent-specific focus hint to guide renderer selection
        const intentHint = getIntentFocusHint(state.intent);
        if (intentHint) {
            finalInstruction += `\n\n${intentHint}`;
        }

        // Intent routing:
        // LangChain path — intents that need custom tools (drug_id, drug_info, pharmacy_search)
        // SDK path — all other intents (Google Search grounding available)
        const LANGCHAIN_INTENTS = ["drug_id", "drug_info", "pharmacy_search", "hospital_search", "vet_search", "law_search", "law_qa", "movie_search", "sports", "weather"];
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
        // 🔴 업로드 첨부(영상·대용량 PDF·오디오)는 Storage 공개 URL 을 fileData 로 보낸다.
        // 3.6 은 **임의 URL fileData 에 429 RESOURCE_EXHAUSTED** 를 낸다(DEV_260808 실측:
        // 같은 키가 직전 텍스트 호출엔 200. YouTube fileData·인라인 이미지는 정상 → urlFileData 축).
        // 이걸 강등하지 않으면 429 가 키 로테이션을 타고 12키 × ~12s ≈ 144s 로 60s 캡을 넘겨
        // 사용자에겐 "응답을 받지 못했습니다"로만 보인다 — 어떤 키로도 성공하지 못하는 실패다.
        const hasUrlFileData = state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) =>
                p.fileData?.fileUri && !/youtube\.com|youtu\.be/.test(p.fileData.fileUri))
        );
        const pinUrlFileData = hasUrlFileData && !selCaps.urlFileData;
        // OpenAI 선택 모델은 텍스트·이미지를 직접 처리한다. 현재 어댑터가 전달하지 않는
        // 영상·오디오·PDF fileData/inline 문서는 기존 검증된 Gemini 2.5 경로로 핀한다.
        const hasOpenAIUnsupportedMedia = isOpenAIChatModel(sel) && state.messages.some((m: any) =>
            Array.isArray(m.content) && m.content.some((p: any) =>
                Boolean(p.fileData) ||
                (p.type === 'image_url' && typeof p.image_url?.url === 'string' &&
                    /^data:(?:application\/pdf|audio\/|video\/)/i.test(p.image_url.url))
            )
        );
        const pinOpenAIUnsupportedMedia = hasOpenAIUnsupportedMedia;
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

        // SDK path: handles all non-tool intents (general, medical_qa, biology, chemistry, physics, astronomy, data_viz)
        // @google/genai SDK natively supports fileData (YouTube) and inlineData (images/PDFs).
        // Google Search grounding is enabled unless multimodal content is present.
        // NOTE: gemini-3.5-flash supports Google Search grounding, but it is not available
        // on the free tier. When 3.5 Flash is selected and grounding is needed, fall back
        // to 2.5 Flash for the grounded response.
        const SEARCH_FALLBACK_MODEL = SERVER_MODELS.FLASH;
        // 검색 턴을 2.5 로 강등하는 조건 — **독립된 두 축의 OR** 다.
        //   ① freeTierSearch=false : 무료티어에서 3.x grounding 이 아예 429 (과금 사실)
        //   ② groundingReliable=false : 검색이 발동해도 모델이 결과를 반영하지 않음 (답변 품질)
        // 🔴 지금 두 축은 3.5·3.6 에서 우연히 같은 값을 낸다. 합쳐 두면, 유료 티어로 올리며
        //    ①만 보고 `freeTierSearch: true` 로 뒤집었을 때 **에러 없이** 3.6 의 2/5 오답이
        //    출처 칩을 달고 나가기 시작한다. 그래서 이름을 나눠 둔다.
        const rmCaps = modelCaps(resolvedModel);
        const needsSearchFallback = !rmCaps.freeTierSearch || !rmCaps.groundingReliable;
        let sdkSuccess = false; // declared outside if-block so LangChain fallback check at line ~277 can read it
        // 영상 턴 primary(2.5)가 데드라인 timeout으로 끝났는지. true면 ~48s 소진이라 키 로테이션·
        // 3.5 폴백을 또 돌릴 60s 예산이 없으므로 모두 차단. if(!useLangChain) 밖 폴백도 읽으므로 hoist.
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
                dropImageForSearch: false,
                isYoutubeRequest,
                hasVideoData,
                latestUserText,
                lastTurnSearched: state.lastTurnSearched,
            });
            // 로컬 함수와 hosted web_search를 한 호출에 섞지 않는다. drug_info의 보조 웹
            // 검색은 기존 도구 내부에서 수행되며, 나머지 로컬 intent는 단일 책임 함수만 강제한다.
            const useWebSearch = !localFunctionTool && searchRequested;
            const resolvedMaxTokens = resolveMaxTokens({
                hasDocumentContent,
                isYoutubeRequest,
                hasMultimodalContent,
                hasUrlContent,
                intent: state.intent,
            });
            const effectiveMaxTokens = useWebSearch && resolvedMaxTokens < 8192 ? 8192 : resolvedMaxTokens;
            console.log('[LangGraph] Starting OpenAI Responses call | model:', resolvedModel, '| useWebSearch:', useWebSearch, '| maxTokens:', effectiveMaxTokens);
            const result = await generateOpenAIChat({
                model: resolvedModel,
                messages: state.messages,
                instructions: finalInstruction,
                useWebSearch,
                maxOutputTokens: effectiveMaxTokens,
                functionTool: localFunctionTool,
            });
            // Responses API는 현재 비스트리밍 호출이다. 텍스트 전송·DB 누적은 route의
            // generator on_chain_end 한 곳에서만 처리해 중복 전송을 막는다.
            return { messages: [new AIMessage(result.text)], groundingSources: result.sources, provider: 'openai' };
        }

        // OpenAI 일반 요청은 Gemini 키와 독립적으로 위에서 완료된다. Gemini SDK·LangChain
        // 도구·멀티모달 capability fallback에 실제로 진입할 때만 Gemini 키를 요구한다.
        const geminiApiKey = getNextApiKey();
        console.log('[LangGraph] Gemini key required:', true, '| available:', !!geminiApiKey, '| intent:', state.intent);
        if (!geminiApiKey) throw new Error("No Gemini API key available");

        if (!useLangChain) {
            const MAX_KEY_RETRIES = API_KEYS.length;
            let sdkApiKey = geminiApiKey;
            let sdkAttempt = 0;
            // When multimodal content (YouTube fileData, PDF URL) causes a 500,
            // retry once without media parts + Google Search enabled.
            let forceTextOnly = false;
            // 503(UNAVAILABLE)은 API 키가 아니라 모델 측 혼잡 → 다음 키도 같은 모델이면 똑같이 503.
            // 3.5-flash가 503이면 throughput 좋은 2.5-flash로 강등해 재시도 (전 키 소진 방지).
            // 한 번 set되면 이후 attempt에서 유지.
            let unavailableDowngrade = false;
            // 🔴 429 를 낸 **서로 다른** 키. 429 는 두 가지가 겹쳐 오는데 응답만으로 구분이 안 된다
            // (무료티어는 quotaMetric·retryDelay 없이 맨 429 만 준다 — DEV_260808 실측):
            //   ⓐ 그 키의 쿼터 소진 → 다른 키로 바꾸면 성공한다 (로테이션이 정답)
            //   ⓑ 모델이 그 요청을 아예 거부 → 어떤 키로도 실패한다 (로테이션은 예산만 태운다)
            // 구분은 **행동으로** 한다: 서로 다른 키 2개가 같은 모델에서 429 면 ⓑ 로 보고 모델을 강등한다.
            // ⓐ 오판 비용은 낮고(2.5 도 잘 답한다), ⓑ 를 놓치면 12키 × ~12s ≈ 144s 로 60s 캡을
            // 확실히 넘겨 사용자에겐 "응답을 받지 못했습니다"로만 보인다.
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
                    const attemptTimeoutMs = isHeavyMediaTurn ? HEAVY_MEDIA_CALL_TIMEOUT_MS : SDK_CALL_TIMEOUT_MS;
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
                        needsSearch: state.needsSearch || hospitalHoursUnavailable,
                        hasMultimodalContent,
                        dropImageForSearch,
                        isYoutubeRequest,
                        hasVideoData,
                        latestUserText,
                        lastTurnSearched: state.lastTurnSearched,
                    });
                    const googleProviderInstruction = withSearchProviderInstruction(
                        finalInstruction,
                        useGoogleSearch ? 'google' : 'none',
                    );

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
                        model: effectiveModel, isYoutubeRequest, hasVideoData, hasUrlContent, isMediaTurn, intent: state.intent,
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
                                systemInstruction: googleProviderInstruction,
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
                        const stage1Grounding = stage1Response.candidates?.[0]?.groundingMetadata;
                        // 🔴 마커를 심기 전에 가짜 번호를 지우면 groundingSupports의 바이트 오프셋이
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
                                    // medical_qa: budget 3000 (출처 정밀). 그 외: budget 0 — 검증결과 dynamic thinking이
                                // Stage1 grounding latency의 주범(~48% 차지)이며 budget0이 출처·표·정확도 동등 (PLAN_THINKING_LATENCY §5-1).
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

                        // If empty and we used a non-minimal thinkingLevel, retry with minimal thinking
                        // 🔴 재시도 목표는 `'minimal'` 리터럴이 아니라 **그 모델의 최저 레벨**이다.
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
                        if (isRateLimit) { markRateLimitKey(sdkApiKey, err); rateLimitedKeys.add(sdkApiKey); }
                        // 무거운 미디어 턴 timeout — **2.5 강등 1회만** 허용하고 그 다음엔 종료한다.
                        //
                        // 🔴 예전엔 무조건 즉시 종료였고 근거는 "또 다른 시도는 60s 캡 초과"였다. 그 60s 는
                        //    이미 사라졌다 — route.ts 는 `maxDuration = 300` 이고, 이 파일 상수 주석도
                        //    "강등 재시도까지 90×2=180s < 300s 로 예산 안에 든다"고 적고 있다(DEV_260808 §9).
                        //    상수는 새 근거로 고쳤는데 **이 분기만 옛 근거로 남아** 있었다.
                        //    2026-08-29 실측(19초 영상 4회): 3.7 은 90s 타임아웃 2회·성공 2회(15.5s·35.8s)로
                        //    간헐적인데, 같은 영상을 2.5 는 17.3s 에 처리했다. 즉 재시도하면 건질 수 있는
                        //    실패를 "일시적으로 불안정합니다" 로 버리고 있었다.
                        //
                        // 로테이션(같은 모델·다른 키)은 여전히 막는다 — 타임아웃은 키 쿼터가 아니라
                        // 모델 측 혼잡이라 키만 바꾸면 90s 를 또 태운다. 바꿀 가치가 있는 건 **모델**이다.
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
                        // 첫 발생에서 throughput 좋은 2.5로 강등(AbortSignal 25s 컷이 production 60s 캡 안에서 재시도 예산 확보).
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
                        // 이 폴백도 fileData 파트를 그대로 싣는다(위 fbContents 조립) — 즉 heavy
                        // media 턴이 여기 도달할 수 있다. 25s 일률이면 §4 와 같은 이유로 정상
                        // 분석을 끊는다. 예산 축을 위와 일치시킨다.
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

        // LangChain path: drug_id/drug_info etc. need custom tools; also the unstreamed
        // fallback when the SDK path fully fails. Fully terminal (returns or throws).
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
};
