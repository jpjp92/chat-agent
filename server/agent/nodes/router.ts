import { AgentStateType, IntentType } from "../state";
import { hasNewImageAttachment, historyHasImage, shouldFastPathPillId } from "./image-flags";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { getNextApiKey, markKeyRateLimited, markKeyDailyExhausted, markKeyInvalid, isDailyQuotaError } from "../../config";
import { ROUTER_MODEL } from "../../models";
import { classifyIntentByRules, resolveClinicIntent, resolveWeatherStickiness, hasMedicalIntentKeyword, hasDosageFormKeyword, classifySearchNeed, isNonBiomedicalPaperTopic, resolvePaperArtifactIntent } from "../intentRules";
import { decideWeatherFollowup } from "../weather-followup";
import { extractCardEntityNames, decideLawInteraction, decideLocationCardFollowup, decidePaperCardFollowup, needsLiveStatusSearch, type LocationCardKind } from "../card-followup";

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
    // 클라이언트가 전체 히스토리로 판정해 보내주면 그걸 우선한다 — 서버가 받는 창(최근 10개)은
    // 대화가 5턴만 지나도 카드를 놓친다(영어 멀티턴에서 카드 이후 6턴째부터 후속 판정이 통째로
    // 꺼지는 걸 실측). 구버전 클라·테스트 하니스처럼 플래그가 없으면 기존 창 스캔으로 폴백.
    const weatherCardInWindow = state.messages.some((m: any) =>
        m._getType?.() === 'ai' && /```json\s*:\s*weather/.test(String(m.content ?? '')));
    const weatherCardShown = state.activeCards?.weather ?? weatherCardInWindow;
    const cardInWindow = (kind: LocationCardKind | 'law') => state.messages.some((m: any) =>
        m._getType?.() === 'ai' && new RegExp(`\`\`\`json\\s*:\\s*${kind}`).test(String(m.content ?? '')));
    const locationCardShown: Record<LocationCardKind, boolean> = {
        pharmacy: state.activeCards?.pharmacy ?? cardInWindow('pharmacy'),
        hospital: state.activeCards?.hospital ?? cardInWindow('hospital'),
        vet: state.activeCards?.vet ?? cardInWindow('vet'),
    };
    const lawCardShown = state.activeCards?.law ?? cardInWindow('law');
    /**
     * 🔴 예전엔 창 스캔만 했고 주석에 "창을 벗어나면 재조회가 맞다(카드가 화면에서 밀려났으므로)"
     * 라고 적어 뒀다. **틀렸다.** 밀려난 건 서버가 받는 창(최근 10개)이지 사용자의 화면이 아니다.
     * 실측(2026-09-01): 여러 턴을 테스트한 뒤 "두번째 논문 설명해줘" 에 **빈 arXiv 카드**
     * ("조건에 맞는 논문을 찾지 못했습니다")가 붙었다 — 사용자는 카드를 보면서 물었는데.
     *
     * 클라이언트는 최근 20개(`CARD_WINDOW`)로 판정해 `activeCards` 로 보내 준다. 날씨·약국·병원·
     * 동물병원·법률이 전부 쓰는 장치인데 논문만 빠져 있었다. 구버전 클라는 창 스캔으로 폴백한다.
     */
    const paperCardInWindow = state.messages.some((m: any) =>
        m._getType?.() === 'ai' && /```json\s*:\s*paper/.test(String(m.content ?? '')));
    const paperCardShown = state.activeCards?.paper ?? paperCardInWindow;

    // 화면 카드가 어느 도시인가 — 후속 판정이 "화면에 없는 도시가 나왔나"를 보려면 필요하다.
    // (이게 없으면 서울 카드가 떠 있는데 "내일 부산 비와?"에 서울로 답한다.)
    const shownWeatherCities: string[] = [];
    for (const m of state.messages) {
        if ((m as any)._getType?.() !== 'ai') continue;
        for (const b of String((m as any).content ?? '').matchAll(/```json\s*:\s*weather\s*\n([\s\S]*?)\n```/g)) {
            try {
                const name = JSON.parse(b[1])?.location?.name;
                if (typeof name === 'string' && name && !shownWeatherCities.includes(name)) shownWeatherCities.push(name);
            } catch { /* 부분 스트리밍·에러 카드 — 무시 */ }
        }
    }

    // 카드가 떠 있으면 LLM에게 그 사실을 명시한다 — 직전 응답 본문이 카드 JSON이라 원문만으로는
    // "화면에 카드가 있다"는 맥락이 잘 안 읽힌다(follow_up 판정 품질에 직접 영향).
    // 영화 상영표 카드는 클라이언트가 렌더 후 movieContext로 되돌려주므로, 그 존재 자체가 "카드 표시 중" 신호.
    const cardHints = [
        weatherCardShown ? `a WEATHER CARD (current conditions + 5-day forecast for the city already asked)` : '',
        state.movieContext ? `a MOVIE SHOWTIMES CARD (today's showtimes at the theaters already asked)` : '',
        locationCardShown.pharmacy ? `a PHARMACY RESULTS CARD` : '',
        locationCardShown.hospital ? `a HOSPITAL RESULTS CARD` : '',
        locationCardShown.vet ? `a VETERINARY HOSPITAL RESULTS CARD` : '',
        lawCardShown ? `a KOREAN LAW ARTICLE CARD` : '',
    ].filter(Boolean);
    const cardHint = cardHints.length
        ? `\nNOTE: ${cardHints.join(' and ')} ${cardHints.length > 1 ? 'are' : 'is'} currently displayed on screen.`
        : "";
    const prevContext = lastAssistantMsg
        ? `\nPrevious assistant response (for follow-up context, first 300 chars): "${String(lastAssistantMsg.content).slice(0, 300)}"${cardHint}`
        : cardHint;

    const attachmentHasImage = hasNewImageAttachment(state.attachments);
    const messageHasImage = historyHasImage(state.messages);
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

    // Fast-path: **이번 턴에 새로 붙인** 이미지 + 명시적 약/알약 신호 → vision (알약 식별).
    // IMPORTANT: only a genuine medical/pill keyword (약, 알약, 약품, 식별, pill, tablet, ...) triggers this.
    // A plain image with a generic caption ("이거 뭐야?", "이 사진 분석해줘") or no caption is NOT a pill
    // request — it must fall through to the LLM router / general multimodal generator, which can describe
    // any image. Routing every image to pill identification was the previous misclassification bug.
    //
    // 🔴 **`hasImage` 가 아니라 `attachmentHasImage` 다.** (2026-08-18)
    //   `hasImage` 는 `messages` **전체**를 훑으므로(:93) 1턴에 붙인 알약 사진이 2턴에도 true 다.
    //   거기에 "약품" 같은 단어만 있으면 이 fast-path 가 **또** 걸려서 같은 vision → 같은 DB 조회 →
    //   **글자 하나 안 틀리고 같은 답**이 나왔다. 실측(2026-08-18): 사용자가
    //   *"이미지 특징 기반으로 검색해서 찾아볼래?"* 라고 명시적으로 요청했는데 이전 답이 그대로 반복됐다.
    //   **라우터 LLM 이 호출조차 되지 않아** 그 요청이 전달될 통로가 없었다.
    //   이미지가 있는 대화에서 약 관련 단어를 쓰는 한 **영원히 빠져나올 수 없는 구조**였다.
    //
    //   기준선: **이번 턴에 이미지를 새로 붙였으면** 알약 식별이 거의 확실하다 → 결정론적으로 간다.
    //   붙이지 않았으면 **후속 발화**이므로 라우터 LLM 이 판단하게 둔다. 그래도 알약 식별이면
    //   LLM 이 drug_id 를 고르고, 아래 :373 이 `hasImage`(히스토리 포함)로 vision 을 태운다 —
    //   **넓은 판정은 그 자리에 남겨두고, 지름길만 좁힌다.**
    //
    //   ⚠️ DEV_260808 *"특정 사례로 이름 붙인 규칙은 그 사례에만 적용된다"* 의 재발이다
    //   (pinYoutube · YOUTUBE_CALL_TIMEOUT_MS · fastLongInput 에 이어 네 번째).
    //   이 fast-path 는 "이미지+약 키워드"라는 **첫 턴의 모양**으로 이름 붙었고, 후속 턴이 같은 모양을
    //   갖는다는 걸 고려하지 않았다.
    if (shouldFastPathPillId(state.attachments, hasMedicalKeyword)) {
        console.log('[LangGraph] Router fast-path: 신규 첨부 이미지 + drug keyword → drug_id vision');
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
- "law_search"      : exact Korean statute lookup, article text, original provisions, or law lists
- "law_qa"          : explanation, summary, comparison, scenario, or application of Korean law grounded in current statute data
- "paper_search"    : the user is asking for RESEARCH PAPERS / studies / academic evidence — 논문, 연구 결과, 임상시험, 근거 자료, "관련 논문 찾아줘", "연구된 게 있어?". Judge only whether they want papers; do NOT judge the field here. The field is decided separately by "paper_source" below, which also decides whether any database can serve it. A medical question that never asks for research ("고혈압에 좋은 음식 알려줘", "감기 걸렸는데 어떻게 해?") is "medical_qa" — but "연구 있어?", "연구된 거 있어?", "연구 결과 알려줘" ARE paper requests even without the word 논문. NEGATIVE ANCHOR — judge what the user wants DELIVERED, not what the subject is about. If they want a SOFTWARE ARTIFACT handed to them — code repositories, GitHub/GitLab repos (레포, 레포지토리, 저장소, 깃허브), open-source projects, libraries, packages, SDKs, frameworks, tools, or documentation — that is "general", NOT paper_search, even when the topic is academic and even when the message says 검색/찾아줘: "클로드 skills 관련된 레포 검색" and "rag 라이브러리 추천해줘" want software, so "general". But those same words may merely NAME THE SUBJECT of a study — "깃허브 코파일럿 생산성 논문 있나", "오픈소스 라이선스 연구 있어?" ask for literature ABOUT software, so they stay paper_search. The deciding question: would a repository satisfy them, or does only a paper?
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
- "new"       : the message asks for a NEW lookup — a different place/theater, a different day/time, or an explicit request to display it again.
- "unrelated" : the topic moved away from the card's subject entirely (planning a trip, what to eat, nearest subway station, coding, chit-chat).

CRITICAL for "new" — this is the case most often missed. Judge it in ANY language, and note that these messages are usually VERY SHORT and lean on the card for context, so they can look like small talk:
- A bare place/theater name, with or without a question word, is "new": "부산은?" · "대구는 어때?" · "How about Busan?" · "And Daegu?" · "What about Busan" · "¿Y Busan?" · "Et Busan ?"
- Asking to see something again is "new" (NOT "unrelated"): "아까 서울 거 다시 보여줘" · "Show me the Seoul one again" · "show that again" · "muéstrame Seúl otra vez"
- A different day/time is "new": "내일은?" · "what about tomorrow?" · "et demain ?"
If the message mentions a PLACE, CITY, or THEATER while a card is displayed, it is "new" or "refine" — never "unrelated". Reserve "unrelated" for messages whose subject is genuinely something else (code, food, travel planning, directions).\n${prevContext}\n\nUser Message: "${textContent}"\n\nOutput ONLY a JSON object exactly like this:\n{"intent": "general", "needs_search": true, "follow_up": "unrelated", "topic_field": "cooking", "paper_source": "none"}

"topic_field": name the ACADEMIC FIELD the user's subject belongs to, in English, 1-3 words ("cardiology", "art history", "reinforcement learning", "monetary policy"). Always output it, for every intent. Decide it from the subject itself, not from the words used.

"paper_source": read ONLY when intent is "paper_search". It picks which literature database can actually answer. Apply this test to the topic_field you just named — what does that field STUDY?
- "pubmed" : a LIVING BODY — an organism, its structure, its function, its illness, or its care. Organisms of any kind (people, animals, plants, microbes) and anything about their bodies or minds: physiology, genetics, disease, drugs, nutrition, mental health, nursing, dentistry, veterinary medicine, public health, occupational and environmental health, exercise science, aging, and any therapy delivered to a patient.
- "arxiv"  : a FORMAL, PHYSICAL, or COMPUTATIONAL SYSTEM — something with laws or mechanisms you can model, measure, or build. Mathematics, physics, astronomy, chemistry of matter, algorithms and computing, machine learning, electronics, robotics, engineering of any kind, statistics, and the quantitative side of economics and finance.
- "none"   : a HUMAN RECORD — a text, an artwork, a past event, an institution, or a law. Literature, art history, musicology, history, archaeology, law, politics, philosophy, accounting, business practice, and the grammar of a language. People made these and people appear in them, but reading, trading, legislating, and adjudicating are neither bodily functions nor systems with laws. Neither database holds this field, so answer without a card.
- If the user wants software artifacts (repos, libraries, packages, tools) HANDED TO THEM rather than literature, answer "none" — no literature database serves that. A paper ABOUT software is still literature: judge it by its field as usual.
- If you cannot name what the field studies, answer "none". A wrong card is worse than no card: both databases return plausible-looking results for ANY query, so a miss sends the user confidently unrelated papers.
Some words name a field on each side — the OBJECT decides, never the word: music therapy treats a patient (pubmed) but musicology studies music (none); sports medicine treats athletes (pubmed) but sports history studies events (none); computational linguistics builds language models (arxiv) but Korean syntax studies a grammar (none). "인상주의 회화 연구" studies paintings -> none, even though both databases happen to hold papers analysing paintings.`;

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
                const validIntents: IntentType[] = ["drug_id", "drug_info", "medical_qa", "pharmacy_search", "hospital_search", "vet_search", "law_search", "law_qa", "movie_search", "paper_search", "arxiv_search", "sports", "weather", "biology", "chemistry", "physics", "astronomy", "data_viz", "general"];
                if (validIntents.includes(parsed.intent)) {
                    intent = parsed.intent as IntentType;
                }
                if (parsed.intent === "paper_search") {
                    // 라우터는 분야를 가리지 않고 논문 요청을 전부 paper_search 로 보낸다(무오염 실측
                    // 차단 대상 30/30 누수). 블록리스트로는 분야 공간이 무한해 못 막으므로, 같은
                    // 호출에서 두 칸을 더 받아 결정적으로 가른다(추가 LLM 호출 없음).
                    //
                    // 🔴 판정은 **분야 목록이 아니라 규칙**이다. 예전엔 "문학·예술사·경제는 false" 처럼
                    //   열거했는데, 그러면 내가 적어둔 분야만 맞고 고고학·언어학·건축학처럼 안 적은
                    //   분야는 그대로 샌다 — 블록리스트가 실패한 것과 같은 이유(분야 공간이 무한).
                    //   그래서 순서를 둘로 나눴다: ① topic_field 로 주제를 학문 분야로 먼저 명명하고
                    //   ② "그 분야가 무엇을 연구하는가" 로 데이터베이스를 고른다.
                    //   음악치료/음악학처럼 같은 단어가 양쪽에 걸릴 때 대상이 가르도록 하는 게 핵심.
                    //
                    // 🔴 **3분기다.** "의생명이 아니면 arXiv" 가 아니다 — arXiv 도 PubMed 처럼 빈손으로
                    //   실패하지 않는다(실측: "한국어 통사론" → astro-ph *Korean VLBI Network*).
                    //   문학·역사·법학·예술은 어느 쪽에도 없으므로 카드 없이 산문으로 답한다.
                    const source = parsed.paper_source;
                    if (source === "arxiv") {
                        // arxiv_search 는 모델이 고르는 의도가 아니다 — paper_source 에서 파생시킨다.
                        // 모델에게 의도와 분야를 따로 물으면 두 판단이 어긋난다.
                        intent = "arxiv_search";
                    } else if (source !== "pubmed") {
                        console.log(`[LangGraph] Paper intent downgrade (paper_search→general): field="${parsed.topic_field ?? '?'}" 는 두 DB 밖`);
                        intent = "general";
                    }
                    console.log(`[LangGraph] Paper source: ${source ?? '(없음→general)'} · field="${parsed.topic_field ?? '?'}"`);
                }
                if (typeof parsed.needs_search === "boolean") {
                    llmNeedsSearch = parsed.needs_search;
                }
                if (parsed.follow_up === "refine" || parsed.follow_up === "new" || parsed.follow_up === "unrelated") {
                    llmFollowUp = parsed.follow_up;
                }
                // Recover only when the LLM missed an explicit drug/pill signal on an image.
                // Do NOT override "general" for arbitrary images — generic photos stay general.
                // 🔴 여기도 `attachmentHasImage` 다 (2026-08-18) — 위 fast-path 와 같은 이유.
                //   히스토리 이미지까지 보면 후속 발화("직접 검색해줘")가 general 로 분류됐을 때
                //   이 복구가 **다시 drug_id 로 되돌려** 위 수정이 무력화된다.
                //   이번 턴에 새로 붙인 경우에만 복구한다 — 그게 이 안전판이 원래 막으려던 상황이다.
                if (intent === "general" && attachmentHasImage && hasMedicalKeyword) {
                    intent = "drug_id";
                }
                // 텍스트 경로의 같은 복구 — 제형 명칭(타액제·연고·좌제·점안액…)이 있는데 general이면
                // drug_info로 되돌린다. general로 새면 search_drug_info(MFDS 실데이터) 경로와
                // 프롬프트의 약 정보 방어(L280 "학습 지식으로 채우지 마라"·L282 "각인은 환자 안전")가
                // 통째로 빠져서, 모델이 제품명을 지어낸다(DEV_260815_DEPLOY_CHECK).
                // hasMedicalKeyword(효과·성분 등 범용어 포함)가 아니라 **고정밀 제형 어휘**로만 뒤집는다.
                if (intent === "general" && !hasImage && hasDosageFormKeyword(textContent)) {
                    console.log('[LangGraph] Router recovery: dosage-form keyword → general → drug_info');
                    intent = "drug_info";
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

    // 논문 의도인데 주제가 PubMed 밖이면 general 로 강등한다. 라우터 LLM 은 분야를 가리지
    // 않고 논문 요청을 전부 paper_search 로 보내며(무오염 실측 CS·공학 9/9 누수), PubMed 는
    // 빈손 대신 그 주제의 의생명 응용을 돌려줘 조용히 엉뚱한 근거가 나간다.
    // ⚠️ `arxiv_search` 에는 적용하지 않는다 — 이 가드가 잡는 CS·공학 어휘가 arXiv 에서는
    //   정답이다. 여기서 걸러야 할 건 "PubMed 로 가려는 비의생명 주제" 뿐이다.
    if (intent === "paper_search" && isNonBiomedicalPaperTopic(textContent)) {
        console.log('[LangGraph] Paper intent downgrade (paper_search→general): non-biomedical field');
        intent = "general";
    }

    // 논문이 아니라 **소프트웨어 산출물**(레포·라이브러리·패키지)을 찾는 요청이면 강등한다.
    // 🔴 실측(2026-09-02): "클로드 skills 관련된 레포 검색" → paper_search + arxiv → arXiv 카드.
    //   위 가드는 `arxiv_search` 를 일부러 건너뛰므로 arXiv 쪽엔 안전망이 없었다 — 여기가 그 자리다.
    //   판정은 `resolvePaperArtifactIntent` 로 나가 있다(하니스가 임포트해야 하기 때문).
    {
        const artifactResolved = resolvePaperArtifactIntent(intent, textContent);
        if (artifactResolved !== intent) {
            console.log(`[LangGraph] Paper intent downgrade (${intent}→general): 논문이 아니라 소프트웨어 산출물 요청`);
            intent = artifactResolved;
        }
    }

    /**
     * 논문 카드 후속 — 화면 카드를 두고 묻는 턴은 재조회하지 않는다.
     *
     * 🔴 실측(2026-08-31, gemini-3.7·gpt-5.6-luna 양쪽): 이 가드가 없어서 "세 번째 논문 좀 더
     * 설명해줘" 가 PubMed 를 다시 검색해 **다른 목록의 새 카드**를 띄웠고, "표로 정리해줘" 는
     * 얘기한 적도 없는 논문 카드를 새로 붙였다. 순서가 밀리면 `[3]` 이 딴 논문을 가리키므로
     * §6.9 에서 없앤 귀속 오류가 멀티턴으로 되돌아오는 경로다.
     *
     * 판정은 `decidePaperCardFollowup` 로 나가 있다 — 하니스가 임포트해야 하기 때문이다.
     *
     * 🔴 **`general` 도 봐야 한다.** 처음엔 논문 의도일 때만 봤는데, 라우터 LLM 이 같은 발화를
     * `general` 로 분류하는 일이 있다(실측: "세 번째 논문 좀 더 설명해줘" → `paper_source: none`
     * → 두 DB 밖 강등 → general). 그러면 가드를 그냥 지나가고 `needsSearch` 가 켜진 채 웹 검색이
     * 돌아 **화면에 카드가 멀쩡히 떠 있는데** 이런 답이 나갔다:
     *   "죄송합니다. 세 번째 논문은 찾을 수 없었습니다. arXiv 데이터베이스에 연결할 수 없었습니다."
     * 날씨 카드 가드가 `weatherCardShown` 만 보고 의도를 안 가리는 것과 같은 이유다.
     *
     * ⚠️ 세 의도로만 좁힌다. 논문 카드가 떠 있어도 "오늘 서울 날씨?" 는 날씨로 가야 한다.
     */
    let paperFollowup = false;
    if (paperCardShown && (intent === "paper_search" || intent === "arxiv_search" || intent === "general")) {
        if (decidePaperCardFollowup(textContent, true) === 'discuss') {
            console.log(`[LangGraph] Paper card followup: discuss → general (재조회 없이 화면 카드로 답한다)`);
            intent = "general";
            paperFollowup = true;
        }
    }

    // 위치·법률 카드 후속은 카드 재조회와 카드 기반 대화를 분리한다. 카드에 이미 있는 운영시간·주소·
    // 의사수·조문을 묻거나 선택 결과에 반응하는 턴은 general로 보내 카드 원문만 근거로 답한다.
    // 다른 지역/기관의 새 목록을 요구할 때만 기존 조회 intent를 유지한다.
    let cardFollowup: "" | LocationCardKind | "law" = "";
    /** 화면 카드에 있는 상호명 — 후속 판정과 검색 게이트가 같은 목록을 본다. */
    let cardFollowupNames: string[] = [];
    const intentToLocationKind: Partial<Record<IntentType, LocationCardKind>> = {
        pharmacy_search: 'pharmacy', hospital_search: 'hospital', vet_search: 'vet',
    };
    const currentLocationKind = intentToLocationKind[intent];
    const candidateLocationKind = currentLocationKind
        ?? (state.activeCards?.latest && locationCardShown[state.activeCards.latest as LocationCardKind]
            ? state.activeCards.latest as LocationCardKind : undefined);
    if (candidateLocationKind && locationCardShown[candidateLocationKind]) {
        cardFollowupNames = extractCardEntityNames(state.cardContexts?.[candidateLocationKind]);
        const decision = decideLocationCardFollowup({
            text: textContent, llmFollowUp, currentIntentMatches: currentLocationKind === candidateLocationKind,
            cardNames: cardFollowupNames,
        });
        if (decision === 'refine' || decision === 'acknowledge') {
            intent = 'general';
            cardFollowup = candidateLocationKind;
        } else if (decision === 'new') {
            intent = `${candidateLocationKind}_search` as IntentType;
        }
        console.log(`[LangGraph] ${candidateLocationKind} card interaction: ${decision}`);
    }

    const ruleIntentForLaw = classifyIntentByRules(textContent, hasImage);
    // 🔴 진료과명이 있는데 LLM 이 약국이라 하면 규칙이 이긴다 — 판정 근거는 intentRules 에 있다.
    //   ("서초구 소아과" 가 3/3 pharmacy_search 로 가서 빈 약국 카드가 떴다, 실측 2026-08-31)
    if (intent !== resolveClinicIntent(intent, ruleIntentForLaw)) {
        console.log(`[LangGraph] Clinic guard: ${intent} → hospital_search (진료과명이 있고 약국이라는 말이 없다)`);
        intent = resolveClinicIntent(intent, ruleIntentForLaw);
    }
    // 🔴 진입 근거를 구분해서 넘긴다. 카드가 떠 있다는 것 **하나만**으로 들어온 턴은
    //   주제가 법률을 떠났을 수 있다 — 그 판정이 decideLawInteraction 의 'unrelated' 다.
    //   구분 없이 돌리던 시절, 법률 카드가 화면에 있으면 논문·날씨·약국 질의까지 전부
    //   law_search 로 가서 "관련 법령을 찾을 수 없습니다" 빈 카드가 나갔다(실측 2026-08-31).
    const intentIsLaw = intent === 'law_search' || intent === 'law_qa' || ruleIntentForLaw === 'law_search';
    if (intentIsLaw || (lawCardShown && state.activeCards?.latest === 'law')) {
        const decision = decideLawInteraction(textContent, lawCardShown, intentIsLaw);
        if (decision === 'lookup') intent = 'law_search';
        else if (decision === 'synthesize') intent = 'law_qa';
        // 주제가 카드를 떠났다 → 법률로 끌어오지 않는다. LLM 이 정한 의도를 그대로 둔다.
        else if (decision === 'unrelated') { /* intent 유지 */ }
        else {
            intent = 'general';
            cardFollowup = 'law';
        }
        console.log(`[LangGraph] Law interaction: ${decision} → ${intent}`);
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
        // 판정은 weather-followup.ts의 순수 함수로 나가 있다 — 하니스가 임포트해야 하기 때문이다.
        // 인라인이던 시절, `날씨 + 알려/줘`가 전부 새 조회로 새면서 사용자가 같은 질문을 세 번 해도
        // 카드만 세 번 뜨고 한 번도 답하지 않던 결함이 있었다.
        // 검증: `npx tsx tests/test-weather-followup.mts`
        const { decision, why } = decideWeatherFollowup({
            text: textContent,
            intentIsWeather: intent === "weather",
            llmFollowUp: llmFollowUp as any,
            // A/B 측정용 스위치 — 1이면 LLM 판정을 무시하고 규칙만으로 결정한다.
            useLlm: process.env.DISABLE_LLM_FOLLOWUP !== '1',
            shownCities: shownWeatherCities,
        });
        if (decision === "new") {
            if (intent !== "weather") { intent = "weather"; console.log(`[LangGraph] Weather follow-up (new ${why}): new city fetch`); }
        } else if (decision === "refine") {
            if (intent === "weather") intent = "general";
            weatherFollowup = true;
            console.log(`[LangGraph] Weather follow-up (refine ${why}): answer from shown card`);
        } else if (decision === "unrelated") {
            // 주제가 카드를 떠났다 → 카드 재생성도, 검색 억제도 하지 않는다.
            if (intent === "weather") intent = "general";
            console.log('[LangGraph] Weather follow-up (unrelated llm): topic moved away from card');
        }
    } else if (intent === "weather") {
        const interp = /왜|이유|우산|빨래|외출|나가도|입을|옷차림|괜찮을까|심한\s*편|높은\s*편|낮은\s*편/;
        const weatherRequest = /날씨|기상|기온|온도|몇\s*도|비\s*(와|올|오|내|온|많)|눈\s*(와|올|오|내|온)|강수|예보|더[워울]|추[워울]|맑|흐[림려]|미세먼지/;
        if (interp.test(textContent) && !weatherRequest.test(textContent)) {
            console.log('[LangGraph] Weather (no card) interpretation → general');
            intent = "general";
        }
    }

    // 🔴 날씨 카드가 무관한 질의를 빨아들이는 것을 막는다 — 판정은 intentRules 에 있다.
    //   후속 판정(위 블록) 뒤에 둔다. 카드가 떠 있을 때 intent 를 weather 로 만드는 경로가
    //   LLM 직접 판정과 'new' 재조회 두 갈래라, 마지막에 한 번 거르는 편이 새지 않는다.
    if (weatherCardShown) {
        const resolved = resolveWeatherStickiness(intent, ruleIntentForLaw, weatherCardShown);
        if (resolved !== intent) {
            console.log(`[LangGraph] Weather stickiness: ${intent} → ${resolved} (규칙이 다른 카드 의도를 확언한다)`);
            intent = resolved;
            weatherFollowup = false;
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
    } else if (cardFollowup) {
        // 기본은 off — 화면 카드가 근거다. 예외는 카드에 그 사실이 애초에 없는 경우다:
        // 동물병원 인허가 데이터에는 진료시간 필드가 없어 "지금 진료하나"를 카드로 답할 수 없다.
        // 영화 forceSearch("상영표에 없는 정보라 검색 강제 ON")와 같은 성격의 예외다.
        needsSearch = needsLiveStatusSearch(cardFollowup, textContent, cardFollowupNames);
    } else if (isMovieFollowup) {
        // 화면 상영표(movieContext)로 답해야 함 — 검색을 켜면 그 데이터를 무시하고 일반 표를 내므로 off.
        needsSearch = false;
    } else if (weatherFollowup) {
        // 화면 날씨 카드(히스토리 json:weather)로 답 — grounding 켜면 다른 수치로 답할 수 있어 off.
        needsSearch = false;
    } else if (paperFollowup) {
        // 화면 논문 카드(히스토리 json:paper)가 근거다 — 검색을 켜면 카드에 없는 논문을 끌어와
        // 인용 번호가 가리키는 대상이 어긋난다. 날씨 카드와 같은 이유로 off.
        needsSearch = false;
    } else if (intent === "general") {
        const ruleDecision = classifySearchNeed(textContent);
        if (ruleDecision === "on") needsSearch = true;
        else if (ruleDecision === "off") needsSearch = false;
        else needsSearch = llmNeedsSearch ?? true; // gray → LLM 판정, 없으면 default-on
    }

    // cardShown 은 진단에 필수 — 이 값이 false면 후속 판정 블록 자체가 안 돌아 llmFollowUp 이 무시된다
    // (히스토리 창 밖으로 카드가 밀려난 경우가 대표적).
    // 재구성 요청 여부 — 여태 llmFollowUp을 로그로만 찍고 버렸다. 그 탓에 generator는 이번 턴이
    // "형식만 바꿔달라"는 요청인지 모른 채, 수백 줄짜리 정적 프롬프트에 판단을 맡기고 있었다.
    // (검색 판정에서 겪은 것과 같은 정보 손실 — DEV_260815 §2-2)
    // 카드의 수치를 묻는 refine과 직전 산문의 형식 재구성은 다르다. 카드 후속에 REFORMAT 규칙까지
    // 주입하면 "몇 시까지?"를 형식 변경 요청으로 오해하므로 카드 전용 후속에서는 끈다.
    const reformatTurn = llmFollowUp === "refine" && !cardFollowup && !isMovieFollowup && !weatherFollowup;

    console.log(`[LangGraph] Router decided: intent=${intent}, needsSearch=${needsSearch}, cardFollowup=${cardFollowup || '-'}, movieFollowup=${isMovieFollowup}, weatherFollowup=${weatherFollowup}, paperFollowup=${paperFollowup}, llmFollowUp=${llmFollowUp ?? '-'}, reformatTurn=${reformatTurn}, weatherCardShown=${weatherCardShown}, paperCardShown=${paperCardShown}`);
    return { nextNode: "generator", intent, needsSearch, cardFollowup, movieFollowup: isMovieFollowup, movieSearchTurn: forceSearch, weatherFollowup, paperFollowup, reformatTurn };
};
