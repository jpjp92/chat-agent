import { AgentStateType, IntentType } from "../state";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError } from "../../config";
import { ROUTER_MODEL } from "../../models";
import { classifyIntentByRules, hasMedicalIntentKeyword, classifySearchNeed } from "../intentRules";

// 영화 카드가 떠 있을 때 "새 카드 요청"이 아닌 "표시된 상영표에 대한 질문"을 가려내는 패턴.
// (movie_search로 분류된 메시지에만 적용 — 이미 영화 맥락이므로 물음표 단독도 후속 신호로 충분)
const MOVIE_FOLLOWUP_QUESTION = /[?？]|있어|없어|있나|비교|차이|만\s|중에|중에서|제일|가장|어느|어디서|어떤|뭐가|뭐야|몇\s*시|언제|추천|골라|빠른|늦은|장르|평점|좌석|남았|매진/;
// general로 분류됐지만 영화 카드 후속인지 판정(물음표 단독 제외 — "오늘 날씨 어때?" 오발 방지).
const MOVIE_CONTEXT_TERMS = /영화|상영|cgv|롯데|메가박스|씨지브이|회차|시간대|상영관|좌석|매진|예매|비교|중에|제일|가장|빠른|늦은|평점|장르/i;
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
    const prevContext = lastAssistantMsg
        ? `\nPrevious assistant response (for follow-up context, first 300 chars): "${String(lastAssistantMsg.content).slice(0, 300)}"`
        : "";

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
- "biology"         : biology, protein structure, DNA, RNA, cell biology, genetics, enzymes
- "chemistry"       : chemistry, molecular structure, chemical reaction, element, compound, SMILES
- "physics"         : physics simulation, mechanics, force, motion, gravity, collision, electricity
- "astronomy"       : constellation, star, planet, galaxy, universe, space observation
- "data_viz"        : data analysis, statistics, chart, graph, visualization of numbers/trends
- "general"         : everything else (code, writing, general chat, web search, video summary, etc.)

Also decide "needs_search": whether answering the LATEST user message needs up-to-date Google Search grounding.
- true  : real-time / current info (news, weather, prices, stocks, "latest/today/now", recent events), a person's current status or role, rankings, company metrics, or the user explicitly asks to search or cite sources.
- false : timeless knowledge, concept/term explanation, code, translation, writing, math, or summarizing/processing what was already discussed in this conversation.\n${prevContext}\n\nUser Message: "${textContent}"\n\nOutput ONLY a JSON object exactly like this:\n{"intent": "general", "needs_search": true}`;

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
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "pharmacy_search", "hospital_search", "vet_search", "law_search", "movie_search", "sports", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
                if (validIntents.includes(parsed.intent)) {
                    intent = parsed.intent as IntentType;
                }
                if (typeof parsed.needs_search === "boolean") {
                    llmNeedsSearch = parsed.needs_search;
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

    // 과거/완료 월드컵(연도 명시 또는 "지난/과거 월드컵")은 API 미지원(403) → general로 보내 학습지식으로 답.
    if (intent === "sports" && /(20\d\d|지난|과거|역대|작년|예전)\s*(년)?\s*(월드컵|world\s?cup)|(월드컵|world\s?cup)\s*(20\d\d|역대|역사)/i.test(textContent)) {
        console.log('[LangGraph] Sports: 과거 대회 질의 → general (API는 현재 대회만)');
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
        } else if (intent === "movie_search" && MOVIE_FOLLOWUP_QUESTION.test(textContent)) {
            // 영화로 분류됐지만 질문형 → 새 카드가 아니라 표시된 상영표에 대한 후속 질문
            console.log('[LangGraph] Movie follow-up (movie_search→general): answer from movieContext');
            intent = "general";
            isMovieFollowup = true;
        } else if (intent === "general" && MOVIE_CONTEXT_TERMS.test(textContent)) {
            // LLM 라우터가 이미 general로 본 영화 후속(예: "제일 빠른 시간은?")도 포착
            console.log('[LangGraph] Movie follow-up (general): answer from movieContext');
            isMovieFollowup = true;
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
    } else if (intent === "general") {
        const ruleDecision = classifySearchNeed(textContent);
        if (ruleDecision === "on") needsSearch = true;
        else if (ruleDecision === "off") needsSearch = false;
        else needsSearch = llmNeedsSearch ?? true; // gray → LLM 판정, 없으면 default-on
    }

    console.log(`[LangGraph] Router decided: intent=${intent}, needsSearch=${needsSearch}, movieFollowup=${isMovieFollowup}`);
    return { nextNode: "generator", intent, needsSearch, movieFollowup: isMovieFollowup };
};
