import { AgentStateType, IntentType } from "../state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError } from "../../config";
import { ROUTER_MODEL } from "../../models";
import { classifyIntentByRules, hasMedicalIntentKeyword, classifySearchNeed } from "../intentRules";

// 영화 카드가 떠 있을 때 "새 카드 요청"이 아닌 "표시된 상영표에 대한 질문"을 가려내는 패턴.
// (movie_search로 분류된 메시지에만 적용 — 이미 영화 맥락이므로 물음표 단독도 후속 신호로 충분)
const MOVIE_FOLLOWUP_QUESTION = /있어|없어|있나|비교|차이|만\s|중에|중에서|제일|가장|어느|어디서|어떤|뭐가|뭐야|몇\s*시|언제|추천|골라|빠른|늦은|장르|평점|좌석|남았|매진/;
// 물음표 단독은 약한 신호다 — "신촌은 어때?"(새 지역 요청)까지 후속 질문으로 삼켜 카드가 안 뜨던 원인.
// 어휘 신호가 없이 물음표뿐이면 회색지대로 넘긴다(LLM 판정 → 없으면 기존대로 후속 간주).
const MOVIE_QUESTION_MARK = /[?？]/;
// general로 분류됐지만 영화 카드 후속인지 판정(물음표 단독 제외 — "오늘 날씨 어때?" 오발 방지).
// 강한 신호: 영화 도메인 어휘 — 이게 있으면 규칙만으로 후속 확정.
const MOVIE_STRONG_TERMS = /영화|상영|cgv|롯데|메가박스|씨지브이|회차|시간대|상영관|좌석|매진|예매|평점|장르/i;
// 약한 신호: 일반 대화에도 흔한 비교/최상급 어휘("가장 가까운 지하철역은?"). 단독이면 회색지대 →
// LLM follow_up 판정에 맡기고, 판정이 없을 때만 기존 결정론 동작(후속으로 간주)으로 폴백한다.
const MOVIE_WEAK_TERMS = /비교|중에|제일|가장|빠른|늦은/;
// 상영표에 없는 정보(줄거리·평점 등)를 웹 검색으로 전환하는 경로:
//  ① 사용자가 직접 검색 요청  ② 직전 봇 응답이 "검색해 드릴까요?" 제안이고 사용자가 동의
const EXPLICIT_SEARCH_REQUEST = /검색|찾아\s*봐|찾아봐|구글|google|웹에서|인터넷|서치/i;
const SEARCH_OFFER_MARKER = /검색해\s*(드릴까요|드릴게요|볼까요)|웹에서\s*(검색|찾아)|검색해서\s*(찾|알려|안내)/;
// 주의: 한글 뒤에는 \b(워드 경계)가 매칭되지 않으므로 lookahead로 토큰 끝을 확인.
const AFFIRM = /^\s*(응+|어+|네+|예+|그래요?|좋아요?|부탁(해|드릴)?|해\s*줘|찾아\s*줘|ㅇㅇ+|ㅇㅋ|오케이|ok|okay|yes|y|그렇게\s*해|해\s*봐)(?=[\s!.~?,…]|$)/i;

/**
 * Router Node
 * Uses a lightweight LLM to classify user intent into the supported intent categories.
 * Injects last assistant message as context for follow-up intent continuity.
 * Falls back to keyword heuristics if the LLM fails.
 */
export const routerNode = async (state: AgentStateType) => {
    const lastMessage = state.messages[state.messages.length - 1] as HumanMessage;

    let textContent = "";
    if (typeof lastMessage.content === "string") {
        textContent = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
        for (const part of lastMessage.content) {
            if ((part as any).type === "text") {
                textContent += (part as any).text;
            }
        }
    }

    // Inject last assistant message for follow-up intent continuity
    const lastAssistantMsg = [...state.messages].reverse().find(m => m._getType() === 'ai') as AIMessage | undefined;

    // 최근 assistant 응답에 날씨 카드(json:weather)가 있으면 = 화면에 카드가 떠 있는 상태.
    // 후속 발화가 "카드 코멘트/해석"인지 "새 조회"인지 가르는 신호(멀티턴 카드 재생성 오작동 방지).
    // 직전 1개만 보면 해석형 답변이 한 번 끼는 순간 카드 맥락이 사라져("가장 더운 요일은?" → 산문 답),
    // 그 다음 턴부터 날씨 어휘가 조금만 섞여도 weather로 재승격돼 카드가 반복 생성됐다.
    // → state.messages(= route.ts가 최근 10개로 잘라 보낸 창) 안의 assistant 메시지를 전부 스캔한다.
    //   창을 벗어나면 자연히 false가 되고, 그 안에서는 "카드가 화면에 있다"가 유지된다.
    //   새 조회(다른 도시·시점)는 아래 newFetch 신호가 그대로 승격시키므로 갇히지 않는다.
    // (LLM 프롬프트에 카드 상태를 알려주려고 라우터 호출 前에 계산한다.)
    const weatherCardShown = state.messages.some((m: any) =>
        m._getType?.() === 'ai' && /```json\s*:\s*weather/.test(String(m.content ?? '')));

    // 카드가 떠 있으면 LLM에게 그 사실을 명시한다 — 직전 응답 본문이 카드 JSON이라 원문만으로는
    // "화면에 카드가 있다"는 맥락이 잘 안 읽힌다(follow_up 판정 품질에 직접 영향).
    // 영화 상영표 카드는 클라이언트가 렌더 후 movieContext로 되돌려주므로, 그 존재 자체가 "카드 표시 중" 신호.
    const cardHints = [
        weatherCardShown ? `a WEATHER CARD (current conditions + 5-day forecast for the city already asked)` : '',
        state.movieContext ? `a MOVIE SHOWTIMES CARD (today's showtimes at the theaters already asked)` : '',
    ].filter(Boolean);
    const cardHint = cardHints.length
        ? `\nNOTE: ${cardHints.join(' and ')} ${cardHints.length > 1 ? 'are' : 'is'} currently displayed on screen.`
        : "";
    const prevContext = lastAssistantMsg
        ? `\nPrevious assistant response (for follow-up context, first 300 chars): "${String(lastAssistantMsg.content).slice(0, 300)}"${cardHint}`
        : cardHint;

    const attachmentHasImage = state.attachments && state.attachments.some(att => att.mimeType && att.mimeType.startsWith('image/'));
    const messageHasImage = state.messages.some((msg: any) =>
        Array.isArray(msg.content) && msg.content.some((part: any) =>
            part.type === 'image_url' ||
            part.inlineData?.mimeType?.startsWith?.('image/') ||
            (part.fileData?.mimeType?.startsWith?.('image/') && !part.fileData.fileUri?.includes('youtube'))
        )
    );
    const hasImage = attachmentHasImage || messageHasImage;

    let intent: IntentType = "general";
    // LLM이 회색지대(rule이 on/off를 못 가리는 일반 질문)에서 내려준 검색 필요 판정.
    // 기획 6-1: rule이 강한 on/off면 그게 우선, gray면 이 값 사용, 둘 다 없으면 default-on.
    let llmNeedsSearch: boolean | undefined;
    // 화면에 카드가 떠 있을 때, 이번 발화가 "카드 해석(refine)"인지 "새 조회(new)"인지 "무관한 주제
    // (unrelated)"인지에 대한 LLM 판정. 강한 규칙이 못 가리는 회색지대에서만 쓴다(needsSearch와 동일 3분기).
    let llmFollowUp: "refine" | "new" | "unrelated" | undefined;
    const apiKey = getNextApiKey();

    const hasMedicalKeyword = hasMedicalIntentKeyword(textContent);

    // Fast-path: YouTube URL → 항상 "general" → Router LLM 호출 스킵
    const hasYoutubeUrl = /(?:youtube\.com\/|youtu\.be\/)/.test(textContent) ||
        (state.webContent && /(?:youtube\.com\/|youtu\.be\/)/.test(state.webContent));
    if (hasYoutubeUrl && !hasMedicalKeyword) {
        console.log('[LangGraph] Router fast-path: YouTube URL → general');
        return { nextNode: "generator", intent: "general" };
    }

    // Fast-path: image + explicit drug/pill textual signal → vision (pill identification).
    // IMPORTANT: only a genuine medical/pill keyword (약, 알약, 약품, 식별, pill, tablet, ...) triggers this.
    // A plain image with a generic caption ("이거 뭐야?", "이 사진 분석해줘") or no caption is NOT a pill
    // request — it must fall through to the LLM router / general multimodal generator, which can describe
    // any image. Routing every image to pill identification was the previous misclassification bug.
    if (hasImage && hasMedicalKeyword) {
        console.log('[LangGraph] Router fast-path: image + drug keyword → drug_id vision');
        return { nextNode: "vision", intent: "drug_id" };
    }

    if (apiKey) {
        // 무효 키(Gemini는 400 API_KEY_INVALID 반환)·일시 오류 대비: 키를 바꿔 1회 재시도 후 휴리스틱 폴백
        let routerKey: string = apiKey;
        for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const ai = new GoogleGenAI({ apiKey: routerKey });
            const prompt = `Classify the strictly main intent of the user message into one of these categories:
- "drug_id"         : pill/tablet image identification (user has an image AND asks to identify it)
- "drug_info"       : text-based drug name lookup, dosage, side effects, ingredients
- "medical_qa"      : general medical or health question (symptoms, diseases, treatments, anatomy)
- "pharmacy_search" : finding a pharmacy location, operating hours, night/holiday pharmacy (in Seoul)
- "hospital_search" : finding a hospital or clinic location, ER, operating hours, medical departments (in Seoul)
- "vet_search"      : finding a veterinary hospital / animal clinic / pet hospital for pets or animals
- "law_search"      : Korean law/statute lookup, article text, legal provisions, law lists, legal interpretation requests
- "movie_search"    : movie showtimes / what's playing now at CGV, Lotte Cinema, Megabox theaters (상영시간표, 영화관, 무슨 영화 하는지)
- "sports"          : CURRENT/ONGOING FIFA World Cup standings, group rankings, fixtures/bracket (16강/8강 대진), match results, top scorers. ONLY for the tournament happening now — past World Cups (2022 등) go to "general".
- "weather"         : current weather, temperature, rain/snow/precipitation, or short-term forecast for a place (오늘/내일 날씨, 기온, 비 와?, ○○ 날씨). Includes follow-ups asking about a DIFFERENT city or a DIFFERENT day/time than the weather already shown. BUT a follow-up that only INTERPRETS already-shown weather (why is it raining, do I need an umbrella, is the humidity high) is "general".
- "biology"         : biology, protein structure, DNA, RNA, cell biology, genetics, enzymes
- "chemistry"       : chemistry, molecular structure, chemical reaction, element, compound, SMILES
- "physics"         : physics simulation, mechanics, force, motion, gravity, collision, electricity
- "astronomy"       : constellation, star, planet, galaxy, universe, space observation
- "data_viz"        : data analysis, statistics, chart, graph, visualization of numbers/trends
- "general"         : everything else (code, writing, general chat, web search, video summary, etc.)

Also decide "needs_search": whether answering the LATEST user message needs up-to-date Google Search grounding.
- true  : real-time / current info (news, weather, prices, stocks, "latest/today/now", recent events), a person's current status or role, rankings, company metrics, the user explicitly asks to search or cite sources, OR the message asks about a specific named product/model/version/person that may be recent or that you are not certain exists (verify before denying existence).
- false : timeless knowledge, well-established concept/term explanation, code, translation, writing, math, or summarizing/processing what was already discussed in this conversation.

Also decide "follow_up" — ONLY meaningful when a result CARD is already displayed (see NOTE below); otherwise output "unrelated".
- "refine"    : the message interprets, compares, or filters the card ALREADY shown (which day is hottest, do I need an umbrella, which city is cooler / which movie starts earliest, seats left, which theater has it).
- "new"       : the message asks for a NEW lookup — a different place/theater, a different day/time, or an explicit request to show it again.
- "unrelated" : the topic moved away from the card (planning a trip, what to eat, nearest subway station, coding, chit-chat).\n${prevContext}\n\nUser Message: "${textContent}"\n\nOutput ONLY a JSON object exactly like this:\n{"intent": "general", "needs_search": true, "follow_up": "unrelated"}`;

            const response = await ai.models.generateContent({
                model: ROUTER_MODEL,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                // 인텐트 분류는 얕은 패턴 작업이라 thinking 불필요. flash-lite 기본 off라도
                // 명시 핀(API 기본값 변동 면역). 라우터는 매 턴 serial-blocking이라 영향 직접적.
                // 같은 flash-lite인 summarize-title도 thinkingBudget:0 사용.
                config: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
            });

            if (response.text) {
                const parsed = JSON.parse(response.text);
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports", "weather", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
                if (validIntents.includes(parsed.intent)) {
                    intent = parsed.intent as IntentType;
                }
                if (typeof parsed.needs_search === "boolean") {
                    llmNeedsSearch = parsed.needs_search;
                }
                if (parsed.follow_up === "refine" || parsed.follow_up === "new" || parsed.follow_up === "unrelated") {
                    llmFollowUp = parsed.follow_up;
                }
                // Recover only when the LLM missed an explicit drug/pill signal on an image.
                // Do NOT override "general" for arbitrary images — generic photos stay general.
                if (intent === "general" && hasImage && hasMedicalKeyword) {
                    intent = "drug_id";
                }
                console.log(`[LangGraph] Semantic Router parsed intent from LLM: ${intent}`);
            }
            break; // LLM 응답 수신 — 재시도 불필요
        } catch (error: any) {
            const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');
            if (isRateLimit) {
                if (isDailyQuotaError(error)) {
                    markKeyDailyExhausted(routerKey);
                } else {
                    markKeyRateLimited(routerKey);
                }
            }
            // Gemini는 무효 API 키를 401이 아닌 400(API_KEY_INVALID)으로 반환 → 로테이션에서 영구 제외
            const isInvalidKey = /api key not valid|API_KEY_INVALID/i.test(error?.message ?? '');
            if (isInvalidKey) markKeyInvalid(routerKey);
            console.warn(`[LangGraph] Semantic Router LLM failed (attempt ${attempt + 1}):`, error?.status ?? '', (error?.message ?? String(error)).slice(0, 140));
            const nextKey = getNextApiKey();
            if (attempt === 0 && nextKey && nextKey !== routerKey) {
                routerKey = nextKey;
                continue;
            }
            console.warn('[LangGraph] Semantic Router falling back to heuristics');
            intent = classifyIntentByRules(textContent, hasImage);
        }
        }
    } else {
        intent = classifyIntentByRules(textContent, hasImage);
    }

    // 영화 의도 구제: 라우터 LLM이 "영화 정보"처럼 명백한 영화 질의를 간헐적으로 general(+검색)로
    // 오분류하는 변동성이 있음(503 폴백 시엔 휴리스틱이 movie_search로 정상 분류돼 결과 불일치).
    // LLM이 general로 봤어도 휴리스틱 regex가 movie_search로 잡으면 deterministic하게 movie_search로
    // 교정. 활성 카드(movieContext) 세션은 아래 후속 가드가 처리하므로 제외.
    if (intent === "general" && !state.movieContext && classifyIntentByRules(textContent, hasImage) === "movie_search") {
        console.log('[LangGraph] Movie intent rescue (general→movie_search): heuristic matched');
        intent = "movie_search";
    }

    // 영화 "지역 되묻기" 후속 구제: 직전 봇이 영화 지역을 되물었고("어떤 지역의 영화 상영…")
    // 사용자가 영화 키워드 없이 지역만 답하면("서울 중곡동") general/약국 등으로 빠진다.
    // 카드가 안 떠 movieContext가 없는 상태라 위 가드들이 못 잡으므로 여기서 deterministic 교정.
    if (intent !== "movie_search" && !state.movieContext) {
        const prevAskedMovieRegion = /지역.*(영화|상영)|(영화|상영).*지역|어떤\s*지역/.test(String(lastAssistantMsg?.content ?? ''));
        const looksLikeRegionAnswer =
            textContent.trim().length <= 20 && !/[?？]/.test(textContent)
            && !/날씨|뉴스|코드|번역|뭐야|누구|어때|알려줘\s*$/.test(textContent);
        // 사용자가 명시적으로 다른 도메인(약국/병원/법령 등)으로 전환한 게 아닐 때만 영화로 이어줌.
        const ruleIntent = classifyIntentByRules(textContent, hasImage);
        if (prevAskedMovieRegion && looksLikeRegionAnswer && ruleIntent === "general") {
            console.log('[LangGraph] Movie region follow-up rescue (→movie_search): bot asked region, user gave region');
            intent = "movie_search";
        }
    }

    // 날씨 의도 구제(카드 없을 때만): 라우터 LLM 실패(무료티어 503/timeout)·오분류 시 명백한 날씨
    // 질의를 weather로 교정. 카드가 떠 있을 땐 아래 후속 가드가 도맡으므로 제외 — "전주가 서울보다
    // 기온 높네?" 같은 코멘트에도 '기온' 토큰이 있어 여기서 승격되면 카드가 재생성되던 버그의 원인.
    if (intent === "general" && !weatherCardShown && classifyIntentByRules(textContent, hasImage) === "weather") {
        console.log('[LangGraph] Weather intent rescue (general→weather): heuristic matched');
        intent = "weather";
    }

    // 과거/완료 월드컵(연도 명시 또는 "지난/과거 월드컵")은 API 미지원(403) → general로 보내 학습지식으로 답.
    if (intent === "sports" && /(20\d\d|지난|과거|역대|작년|예전)\s*(년)?\s*(월드컵|world\s?cup)|(월드컵|world\s?cup)\s*(20\d\d|역대|역사)/i.test(textContent)) {
        console.log('[LangGraph] Sports: 과거 대회 질의 → general (API는 현재 대회만)');
        intent = "general";
    }

    // 날씨 후속 처리: 화면에 카드가 떠 있으면(weatherCardShown) 후속 발화를 두 갈래로 가른다.
    //  · "새 조회" 신호(미래 시점·명시 요청·"부산은?"·"부산 날씨") → weather(카드 재생성)
    //  · 그 외(코멘트·해석·비교 "전주가 서울보다 높네?", "우산 챙길까?", "습도 높은 편?") → general
    //    (json:weather가 히스토리에 있어 general이 그 데이터로 답함 · needsSearch도 off로 재검색 억제)
    // 카드가 없을 때(첫 발화 등)는 해석형 오분류만 방어.
    let weatherFollowup = false;
    if (weatherCardShown) {
        // "이런 날씨", "요즘 날씨", "더운 날씨"처럼 지시어·수식어가 붙은 '날씨'는 새 조회가 아니라
        // 떠 있는 카드에 대한 코멘트다("이런 날씨엔 뭐 먹을까?"). 도시명일 때만 재조회로 본다.
        const VAGUE_BEFORE_WEATHER = /^(이런|그런|저런|이|그|저|요즘|요새|무슨|어떤|더운|추운|좋은|나쁜|이딴|같은|덥고|춥고)$/;
        const cityWeatherRequest = Array.from(textContent.matchAll(/([가-힣A-Za-z]{1,12})\s*날씨/g))
            .some(m => !VAGUE_BEFORE_WEATHER.test(m[1]));
        // 시점 토큰 단독은 날씨 요청이 아니다("주말 나들이 계획 짜줘") — 날씨 어휘와 동반될 때만 새 조회.
        const timeShift = /(내일|모레|글피|이번\s*주말|이번\s*주|다음\s*주|주말|오늘\s*(밤|저녁|오후|아침)|새벽)/.test(textContent);
        const weatherWord = /날씨|예보|기온|온도|몇\s*도|비\s*(와|올|오|내|온)|눈\s*(와|올|오|내|온)|강수|더[워울]|추[워울]|맑|흐[림려]/.test(textContent);
        const newFetch =
            (timeShift && weatherWord)                                                                                            // 미래/시점 이동 + 날씨 어휘
            || (/(날씨|예보)/.test(textContent) && /(알려|보여|어때|어떄|어떻|찾아|줘|해\s*줘|궁금|부탁)/.test(textContent))          // 명시 요청
            || /^[가-힣A-Za-z]{1,10}\s*(은|는|도)\s*[?？]?$/.test(textContent.trim())                                              // "부산은?"·"내일은?" 재조회
            || cityWeatherRequest;                                                                                                // "부산 날씨"
        // 강한 "카드 해석" 신호 — 지시어가 붙은 '날씨' 언급이거나 해석형 어휘.
        // 날씨와 무관해진 발화("주말 나들이 계획 짜줘")는 여기 안 걸려야 한다(검색을 살려야 하므로).
        const interpretive = /왜|이유|우산|빨래|외출|나가도|입을|옷|옷차림|괜찮을까|편[이야]?\?|덥|춥|시원|후텁|쾌적|어느\s*날|무슨\s*요일|가장|제일|높|낮/;
        const strongRefine = (/날씨/.test(textContent) && !cityWeatherRequest) || weatherWord || interpretive.test(textContent);

        // 판정 우선순위 (needsSearch 3분기와 같은 원칙: 강한 규칙 → 회색지대 LLM → 폴백)
        //   1) 강한 새 조회 신호  → weather (카드 재생성)
        //   2) 강한 해석 신호     → general + weatherFollowup (카드 데이터로 답변)
        //   3) 회색지대           → 라우터 LLM의 follow_up 판정
        //   4) LLM 판정 없음      → 기존 결정론 폴백(무료티어 503/timeout 대비)
        // 3)이 없어도 1)·2)만으로 기존 동작이 그대로 남도록 감싸는 구조다(롤백 안전).
        const asRefine = (why: string) => {
            if (intent === "weather") intent = "general";
            weatherFollowup = true;
            console.log(`[LangGraph] Weather follow-up (refine ${why}): answer from shown card`);
        };
        const asNewFetch = (why: string) => {
            if (intent !== "weather") { intent = "weather"; console.log(`[LangGraph] Weather follow-up (new ${why}): new city/time fetch`); }
        };
        // A/B 측정용 스위치 — 1이면 LLM 판정을 무시하고 규칙만으로 결정한다.
        const useLlmFollowUp = process.env.DISABLE_LLM_FOLLOWUP !== '1' && !!llmFollowUp;

        if (newFetch) {
            asNewFetch('rule');
        } else if (strongRefine) {
            asRefine('rule');
        } else if (useLlmFollowUp) {
            if (llmFollowUp === "new") asNewFetch('llm');
            else if (llmFollowUp === "refine") asRefine('llm');
            else {
                // unrelated: 주제가 카드를 떠났다 → 카드 재생성도, 검색 억제도 하지 않는다.
                if (intent === "weather") intent = "general";
                console.log('[LangGraph] Weather follow-up (unrelated llm): topic moved away from card');
            }
        } else if (intent === "weather") {
            // 폴백: LLM 판정이 없는데 weather로 분류됐고 새 조회 신호도 없음 → 카드 해석으로 본다.
            asRefine('fallback');
        }
    } else if (intent === "weather") {
        const interp = /왜|이유|우산|빨래|외출|나가도|입을|옷차림|괜찮을까|심한\s*편|높은\s*편|낮은\s*편/;
        const weatherRequest = /날씨|기상|기온|온도|몇\s*도|비\s*(와|올|오|내|온|많)|눈\s*(와|올|오|내|온)|강수|예보|더[워울]|추[워울]|맑|흐[림려]|미세먼지/;
        if (interp.test(textContent) && !weatherRequest.test(textContent)) {
            console.log('[LangGraph] Weather (no card) interpretation → general');
            intent = "general";
        }
    }

    // 카드가 다룰 수 없는 계절/현상·시기 질의는 weather로 분류돼도 general(+search)로 — 카드는 "특정 지역
    // 현재날씨+단기예보"만 답한다. 장마 시작 시기·폭염 전망·미세먼지 농도·태풍 경로 등은 grounding이 정답.
    // ("장마일정 조사하라고" → 카드 반복 대신 검색). weatherTool은 이런 데이터를 갖고 있지 않음.
    if (intent === "weather" && /(장마|폭염|한파|열대야|미세먼지|초미세먼지|황사|태풍|가뭄|자외선\s*지수|꽃가루|오존)/.test(textContent)) {
        console.log('[LangGraph] Weather → general: 계절/현상 질의(카드 범위 밖, 검색 처리)');
        intent = "general";
    }

    // 영화 멀티턴 후속 질문 가드: 직전 턴에 카드가 떠 있고(movieContext 존재) 현재 메시지가
    // 질문형(비교·필터·"~만"·"있어?" 등)이면, movie_search(=카드 재생성)가 아니라 general로 보내
    // 화면 상영표 요약(movieContext)으로 답하게 한다. 새 지역 카드 요청은 보통 질문형이 아니라 그대로 통과.
    let isMovieFollowup = false;
    let forceSearch = false;
    if (state.movieContext) {
        const prevOfferedSearch = SEARCH_OFFER_MARKER.test(String(lastAssistantMsg?.content ?? ''));
        const wantsSearch = EXPLICIT_SEARCH_REQUEST.test(textContent) || (prevOfferedSearch && AFFIRM.test(textContent));
        if (wantsSearch) {
            // 상영표에 없는 정보(줄거리·평점 등)를 웹 검색으로 답함 — 카드/상영표 요약이 아니라 general+검색.
            console.log('[LangGraph] Movie info → web search (explicit request or confirmed offer)');
            if (intent === "movie_search") intent = "general";
            forceSearch = true;
        } else {
            // 판정 우선순위 — 날씨 경로(위)와 동일한 3분기 원칙: 강한 규칙 → 회색지대 LLM → 결정론 폴백.
            const asMovieRefine = (why: string) => {
                if (intent === "movie_search") intent = "general";
                isMovieFollowup = true;
                console.log(`[LangGraph] Movie follow-up (refine ${why}): answer from movieContext`);
            };
            const asMovieNewFetch = (why: string) => {
                if (intent !== "movie_search") { intent = "movie_search"; console.log(`[LangGraph] Movie follow-up (new ${why}): new theater/region card`); }
            };
            const useLlmFollowUp = process.env.DISABLE_LLM_FOLLOWUP !== '1' && !!llmFollowUp;

            const weakOnly = MOVIE_QUESTION_MARK.test(textContent) && !MOVIE_FOLLOWUP_QUESTION.test(textContent);
            if (intent === "movie_search" && MOVIE_FOLLOWUP_QUESTION.test(textContent)) {
                // 영화로 분류됐지만 후속 어휘가 명확 → 새 카드가 아니라 표시된 상영표에 대한 질문
                asMovieRefine('rule');
            } else if (intent === "movie_search" && weakOnly) {
                // 물음표뿐 — "신촌은 어때?"(새 지역)와 "그거 아직 해?"(후속)가 섞이는 회색지대
                if (useLlmFollowUp && llmFollowUp === "refine") asMovieRefine('llm');
                else if (useLlmFollowUp) console.log('[LangGraph] Movie: new card (llm follow_up=%s)', llmFollowUp);
                else asMovieRefine('fallback');   // LLM 판정 없음 → 기존 동작(물음표=후속) 유지
            } else if (intent === "movie_search") {
                // 질문형이 아닌 영화 요청 = 새 지역/지점 카드 → 그대로 통과(재생성이 정상)
            } else if (MOVIE_STRONG_TERMS.test(textContent)) {
                // LLM 라우터가 general로 봤어도 영화 어휘가 명시적이면 후속 질문(예: "메가박스에만 있는 영화는?")
                asMovieRefine('rule');
            } else if (useLlmFollowUp) {
                if (llmFollowUp === "new") asMovieNewFetch('llm');
                else if (llmFollowUp === "refine") asMovieRefine('llm');
                else console.log('[LangGraph] Movie follow-up (unrelated llm): topic moved away from card');
            } else if (MOVIE_WEAK_TERMS.test(textContent)) {
                // 폴백(LLM 판정 없음): 기존 동작 그대로 — 비교/최상급 어휘면 상영표 후속으로 간주.
                asMovieRefine('fallback');
            }
        }
    }

    // Route: drug_id requires vision preprocessing when image is present
    // If drug_id but no image, treat as drug_info
    if (intent === "drug_id") {
        if (hasImage) {
            console.log('[LangGraph] Router decided: VISION processing required');
            return { nextNode: "vision", intent: "drug_id" };
        } else {
            intent = "drug_info";
        }
    }

    // Search-need decision (general intent only).
    // 다른 intent(medical_qa·renderer·검색계열 등)는 generator의 게이트가 검색 on/off를 직접 제어하므로
    // 여기서는 산출하지 않고 default(true)에 맡긴다. general만 rule→(gray)LLM→default-on 순으로 결정.
    // 기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (4, 6-1, 9 안전판)
    let needsSearch = true; // default-on: 판정 누락 시 검색누락 방어 우선
    if (forceSearch) {
        // 영화 정보 웹 검색 요청/동의 — 상영표에 없는 정보라 검색을 강제 ON.
        needsSearch = true;
    } else if (isMovieFollowup) {
        // 화면 상영표(movieContext)로 답해야 함 — 검색을 켜면 그 데이터를 무시하고 일반 표를 내므로 off.
        needsSearch = false;
    } else if (weatherFollowup) {
        // 화면 날씨 카드(히스토리 json:weather)로 답 — grounding 켜면 다른 수치로 답할 수 있어 off.
        needsSearch = false;
    } else if (intent === "general") {
        const ruleDecision = classifySearchNeed(textContent);
        if (ruleDecision === "on") needsSearch = true;
        else if (ruleDecision === "off") needsSearch = false;
        else needsSearch = llmNeedsSearch ?? true; // gray → LLM 판정, 없으면 default-on
    }

    console.log(`[LangGraph] Router decided: intent=${intent}, needsSearch=${needsSearch}, movieFollowup=${isMovieFollowup}, weatherFollowup=${weatherFollowup}, llmFollowUp=${llmFollowUp ?? '-'}`);
    return { nextNode: "generator", intent, needsSearch, movieFollowup: isMovieFollowup, weatherFollowup };
};
