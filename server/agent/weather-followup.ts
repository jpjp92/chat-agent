/**
 * 날씨 카드가 떠 있을 때의 후속 발화 판정 — 순수 함수.
 *
 * 화면에 `json:weather` 카드가 있는 상태에서 사용자가 이어 말했을 때,
 * **카드를 다시 그릴지(new)** 아니면 **떠 있는 카드로 설명할지(refine)** 를 가른다.
 *
 * ## 왜 분리했나
 * 이 판정이 `routerNode` 안에 인라인으로 있어 하니스가 임포트할 수 없었고,
 * 그 사이 `날씨 추세 알려줘`·`아니 날씨 …` 같은 자연스러운 발화가 전부 `new`로
 * 새면서 카드만 반복 생성됐다(같은 질문을 3번 하는데 한 번도 답하지 않음).
 * 검증: `npx tsx tests/test-weather-followup.mts`
 *
 * ## 판정 계층 (needsSearch·movie와 같은 원칙)
 *   1. 강한 규칙 → new
 *   2. 강한 규칙 → refine
 *   3. 회색지대 → 라우터 LLM의 follow_up 판정
 *   4. LLM 없음 → intent가 weather면 refine(폴백)
 */

import { isKnownCityName } from "../lib/weather";

export type WeatherFollowupDecision = "new" | "refine" | "unrelated" | "none";
export type LlmFollowUp = "new" | "refine" | "unrelated" | null | undefined;

export interface WeatherFollowupInput {
    text: string;
    /** 라우터 LLM이 이미 정한 intent가 weather인가 (4단계 폴백에서만 쓰임) */
    intentIsWeather: boolean;
    /** 라우터 LLM의 follow_up 판정. 없으면 3단계를 건너뛴다 */
    llmFollowUp?: LlmFollowUp;
    /** DISABLE_LLM_FOLLOWUP=1 A/B 스위치 */
    useLlm?: boolean;
    /** 화면에 떠 있는 카드의 도시들(히스토리 `json:weather`의 `location.name`) */
    shownCities?: string[];
}

export interface WeatherFollowupResult {
    decision: WeatherFollowupDecision;
    /** 어느 단계에서 정해졌는가 — 로그·하니스 진단용 */
    why: "rule" | "llm" | "fallback" | "none";
}

// "이런 날씨", "요즘 날씨", "더운 날씨"처럼 지시어·수식어가 붙은 '날씨'는 새 조회가 아니라
// 떠 있는 카드에 대한 코멘트다("이런 날씨엔 뭐 먹을까?"). 도시명일 때만 재조회로 본다.
//
// ⚠️ 이 목록은 **닫힌 부류**만 담는다 — 지시어·수식어·담화표지·시간어. 도시명은 열린 부류라
// 거부목록으로 다룰 수 없다(그래서 아래에서 `isKnownCityName` 사전을 따로 쓴다).
// `아니`가 없어서 "아니 날씨 추세 알려줘"의 `아니`가 도시로 판정되던 결함이 있었다.
const VAGUE_BEFORE_WEATHER = /^(이런|그런|저런|이|그|저|요즘|요새|무슨|어떤|더운|추운|좋은|나쁜|이딴|같은|덥고|춥고)$/;
// 담화표지·접속부사 — 문장 앞에 붙을 뿐 지명이 아니다.
const DISCOURSE_MARKER = /^(아니|아니아니|근데|그런데|그래서|그러면|그럼|그리고|또|음+|어+|저기|야|참|일단|그냥|아까|방금|다시|좀|더|현재|지금)$/;
// 시간 표현 — "이번 주 날씨"의 `주`, "오늘 날씨"의 `오늘`이 지명으로 오인되던 자리.
const TIME_TOKEN = /^(오늘|내일|모레|글피|어제|주|이번|다음|저번|지난|주말|평일|아침|점심|저녁|밤|낮|오후|오전|새벽|월요일|화요일|수요일|목요일|금요일|토요일|일요일|월욜|화욜|수욜|목욜|금욜|토욜|일욜)$/;
const TIME_SHIFT = /(내일|모레|글피|이번\s*주말|이번\s*주|다음\s*주|주말|오늘\s*(밤|저녁|오후|아침)|새벽)/;
const WEATHER_WORD = /날씨|예보|기온|온도|몇\s*도|비\s*(와|올|오|내|온)|눈\s*(와|올|오|내|온)|강수|더[워울]|추[워울]|맑|흐[림려]/;
const REQUEST_VERB = /(알려|보여|어때|어떄|어떻|찾아|줘|해\s*줘|궁금|부탁)/;
const CITY_ONLY_REASK = /^[가-힣A-Za-z]{1,10}\s*(은|는|도)\s*[?？]?$/;
// 강한 "카드 해석" 신호 — 지시어가 붙은 '날씨' 언급이거나 해석형 어휘.
// 날씨와 무관해진 발화("주말 나들이 계획 짜줘")는 여기 안 걸려야 한다(검색을 살려야 하므로).
const INTERPRETIVE = /왜|이유|우산|빨래|외출|나가도|입을|옷|옷차림|괜찮을까|편[이야]?\?|덥|춥|시원|후텁|쾌적|어느\s*날|무슨\s*요일|가장|제일|높|낮/;

/**
 * 오늘/내일/모레/글피 ↔ `daily[].date`(YYYY-MM-DD) 대응표.
 *
 * 날짜 대응을 **모델에게 계산시키지 않기 위해** 서버가 만들어 준다. 실측(2026-08-17):
 * `내일 서울 비와?` 에 카드 히어로 블록(= **오늘** 강수 `19mm·60%`)을 그대로 집어
 * "내일 60%"라고 답했고, 같은 답변에서 18일을 "모레"라고 불렀다(하루씩 밀림).
 * 프롬프트에 `CURRENT_SYSTEM_TIME` 이 있어도 `daily[].date` 와의 대응은 **별개의 계산**이라 틀린다.
 */
export const buildDateLadder = (now: Date, tz: string): string => {
    const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const weekday = (d: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: tz, weekday: "short" }).format(d);
    // 로컬 자정 경계를 넘기지 않도록 UTC 밀리초로 더한다(setDate는 서버 로컬 타임존을 탄다).
    const at = (offset: number) => {
        const d = new Date(now.getTime() + offset * 86400000);
        return `${ymd(d)}(${weekday(d)})`;
    };
    return ["오늘", "내일", "모레", "글피"].map((label, i) => `- ${label} = ${at(i)}`).join("\n");
};

/** 지명일 수 없는 토큰인가 — 지시어·담화표지·시간어 */
const isNonPlaceToken = (t: string): boolean =>
    VAGUE_BEFORE_WEATHER.test(t) || DISCOURSE_MARKER.test(t) || TIME_TOKEN.test(t);

/**
 * 발화가 **도시**를 지목하는가. 3값이다 — 이게 이 수정의 핵심 축이다.
 *   · known   : 사전에 있는 도시("부산 날씨") → 확신하고 새 카드
 *   · unknown : 지명일 수 있는 고유명사("순천 날씨") → 새 카드(사전은 allowlist가 아니다)
 *   · none    : 지명이 없다("날씨 추세 알려줘") → 카드로 설명
 */
export type CityMention = "known" | "unknown" | "none";

export const detectCityMention = (text: string, shownCities: string[] = []): CityMention => {
    // 화면 카드가 이미 그 도시를 담고 있으면 재조회가 아니다. 카드 라벨은 "부산광역시",
    // 사용자는 "부산"이라 쓰므로 양방향 포함으로 맞춘다.
    const alreadyShown = (t: string) =>
        shownCities.some(s => s && (s.includes(t) || t.includes(s)));

    const candidates: string[] = [];
    for (const m of text.matchAll(/([가-힣A-Za-z]{1,12})\s*날씨/g)) candidates.push(m[1]);
    // "부산은?"·"내일은?" 꼴의 단독 재질의 — 여기서도 같은 잣대를 쓴다
    const reask = text.trim().match(/^([가-힣A-Za-z]{1,10})\s*(?:은|는|도)\s*[?？]?$/);
    if (reask) candidates.push(reask[1]);

    let sawUnknown = false;
    for (const t of candidates) {
        if (isNonPlaceToken(t)) continue;
        // `X 날씨`는 명시적 카드 요청이다 — 이미 떠 있어도 새로고침으로 본다.
        if (isKnownCityName(t)) return "known";
        sawUnknown = true;
    }
    if (sawUnknown) return "unknown";

    // `날씨`를 붙이지 않고 도시만 말한 경우("내일 부산 비와?").
    // 화면에 없는 도시일 때만 새 조회 — 떠 있는 카드끼리의 비교("전주가 서울보다 덥네")를
    // 새 조회로 오인하면 안 되기 때문이다.
    for (const m of text.matchAll(/[가-힣A-Za-z]{2,12}/g)) {
        // 조사가 붙어 사전 조회가 빗나가던 자리("제주도는" → "제주도")
        for (const t of [m[0], m[0].replace(/(은|는|이|가|도|의|에서|에|으로|로|과|와|랑|보다|까지|부터)$/, "")]) {
            if (t.length < 2 || isNonPlaceToken(t) || alreadyShown(t)) continue;
            if (isKnownCityName(t)) return "known";
        }
    }
    return "none";
};

/** @deprecated detectCityMention을 쓸 것 — 하위 호환용 */
export const mentionsCityWeather = (text: string): boolean => detectCityMention(text) !== "none";

export const decideWeatherFollowup = (input: WeatherFollowupInput): WeatherFollowupResult => {
    const { text, intentIsWeather, llmFollowUp, useLlm = true, shownCities = [] } = input;

    const city = detectCityMention(text, shownCities);
    const weatherWord = WEATHER_WORD.test(text);

    // 새 조회의 유일한 근거는 **다른 지역이 지목됐는가**다.
    //
    // 예전엔 ① `시점이동 + 날씨어휘` ② `날씨 + 요청동사` 도 새 조회로 쳤다. 둘 다 걷어냈다.
    //  ① 카드는 이미 +5일 예보를 담고 있다 — "내일 비와?"에 재조회해도 **같은 데이터**가 온다.
    //     새 카드를 그리는 대신 떠 있는 카드로 답하는 것이 옳다.
    //  ② "날씨 + 알려/줘"는 날씨를 묻는 **모든** 자연스러운 발화에 걸린다. "부산 날씨 알려줘"와
    //     "날씨 추세 알려줘"를 구분하지 못해, 사용자가 같은 걸 세 번 물어도 카드만 세 번 떴다.
    const newFetch = city !== "none";

    const strongRefine = (/날씨/.test(text) && city === "none") || weatherWord || INTERPRETIVE.test(text);

    if (newFetch) return { decision: "new", why: "rule" };
    if (strongRefine) return { decision: "refine", why: "rule" };
    if (useLlm && llmFollowUp) {
        if (llmFollowUp === "new") return { decision: "new", why: "llm" };
        if (llmFollowUp === "refine") return { decision: "refine", why: "llm" };
        // unrelated: 주제가 카드를 떠났다 → 카드 재생성도, 검색 억제도 하지 않는다.
        return { decision: "unrelated", why: "llm" };
    }
    // 폴백: LLM 판정이 없는데 weather로 분류됐고 새 조회 신호도 없음 → 카드 해석으로 본다.
    if (intentIsWeather) return { decision: "refine", why: "fallback" };
    return { decision: "none", why: "none" };
};
