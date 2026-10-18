import type { AgentStateType } from "./state";
import { getIntentPolicy, getRendererSections } from "./prompt";
import { type LangName } from "./lang";
import { cardHasResults } from "./card-tool-output";
import {
    buildCardFollowupFacts, buildEmptyCardRules, buildHospitalHoursFacts, buildPaperFollowupRules,
    buildSearchTargetBlock, buildDisplayedCardRules, extractCardEntityNames, findCardEntityAddress, needsHospitalHoursLookup,
} from "./card-followup";
import { buildDateLadderBlock, buildWeatherFollowupRules } from "./weather-followup";
import { buildMovieFollowupRules, buildMovieSearchRules } from "./movie-followup";
import { buildGroundedHistoryRules } from "./grounded-history-rules";
import { buildReformatRules } from "./reformat-rules";
import type { fetchHospitalOpenStatus } from "./hospital-hours";

/**
 * 최종 시스템 인스트럭션 조립 — **순수 함수** (PLAN_PROMPT_LAYERING §7-6).
 *
 * 순수해야 하는 이유:
 *   · 조립 결과 `finalInstruction` 을 골든 스냅샷으로 고정할 수 있어야 한다 — 노드 안 지역 변수면
 *     값을 보려고 노드를 돌려야 하고, 그러면 네트워크 호출로 간다.
 *   · 조립 도중 외부 API 를 치면 골든 테스트가 외부 API 상태에 좌우된다.
 * → **사실 수집(async)은 호출부(generator.ts)에, 규칙 조립(pure)은 여기에.** 조회 결과는 인자로 받는다.
 *   §8 의 층 구분(Runtime Context vs Turn Policy)을 코드에 반영한 것이다.
 *
 * 골든: `tests/test-prompt-assembly.mts`.
 */
/**
 * 조립이 **실제로 읽는 state 필드만** 추린 것.
 *
 * `AgentStateType` 을 통째로 받으면 계약이 "상태 전부"가 돼 무엇에 의존하는지 읽을 수 없고,
 * 골든 스냅샷을 만들 때 쓰지도 않는 필드까지 채워야 한다. 13개로 좁히면 의존이 드러난다.
 * `AgentStateType` 에서 뽑으므로 원본이 바뀌면 여기서 tsc 가 잡는다.
 */
export type AssemblyState = Pick<AgentStateType,
    | 'intent' | 'messages' | 'webContent' | 'contextInfo' | 'needsSearch'
    | 'cardFollowup' | 'cardContexts' | 'paperFollowup' | 'reformatTurn'
    | 'movieFollowup' | 'movieSearchTurn' | 'movieContext' | 'weatherFollowup' | 'lastTurnSearched' | 'lastTurnSourceLabels'>;

type AssemblePromptInput = {
    /** `getSystemInstruction(langName)` 의 결과. 이 함수는 base 를 만들지 않는다. */
    base: string;
    state: AssemblyState;
    langName: LangName;
    latestUserText: string;
    /** 호출부가 한 번만 만들어 넘긴다 — 조립 중 `new Date()` 를 부르면 같은 턴에 값이 흔들린다. */
    now: Date;
    tz: string;
    currentDateStr: string;
    /** 카드에서 사용자가 지목한 기관. `resolveCardEntity` 의 결과를 그대로 넘긴다. */
    cardEntity: CardEntity;
    /** 심평원 진료시간 조회 결과. 호출부가 미리 조회한다. 미시도·실패·미등록 모두 `null`. */
    hospitalStatus: Awaited<ReturnType<typeof fetchHospitalOpenStatus>> | null;
    /**
     * 시각 블록을 어디에 둘 것인가 — **실험 손잡이**(PLAN §10-11).
     *
     * `'start'`(기본)가 프로덕션 동작이다 — 프로덕션(`route.ts` → `compileAgentGraph`)은 이 값을 넘기지
     * 않는다. `'end'`·`'both'` 는 `tests/manual/probe-time-block-position.mts` 만 쓴다.
     *
     * 주의: **판정이 끝나면 지울 손잡이다.** 정해지면 이 옵션과 골든의 `end` 변형을 함께 제거한다(TODO §5-a).
     */
    timeBlockAt?: 'start' | 'end' | 'both';
};

type CardEntity = { namedEntity: string | undefined; namedAddress: string };

/**
 * 사용자가 카드의 어느 기관을 지목했는지 고른다 — 순수.
 *
 * 호출부(조회)와 조립부(검색 대상 블록)가 **같은 값을 써야 한다.** 각자 구하면
 *    두 경로가 다른 기관을 볼 수 있다. 그래서 한 번 구해 양쪽에 넘긴다.
 */
export const resolveCardEntity = (cardContext: string, latestUserText: string): CardEntity => {
    const namedEntity = extractCardEntityNames(cardContext)
        .find(name => latestUserText.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')));
    return { namedEntity, namedAddress: namedEntity ? findCardEntityAddress(cardContext, namedEntity) : '' };
};

export const assemblePrompt = (input: AssemblePromptInput): string => {
    const { base, state, langName, latestUserText, now, tz, currentDateStr, cardEntity, hospitalStatus, timeBlockAt = 'start' } = input;

    let finalInstruction = base;

    // 주입만으로는 부족하다 — 자정 직후에는 검색 결과 대부분이 전날 자료라 모델이 기사 게시일을
    // "오늘"로 삼는다. 이 값이 오늘 날짜의 유일한 근거임을 못 박는다 → DEV_260824
    const timeBlock = `[CURRENT_SYSTEM_TIME (Timezone: ${tz}): ${currentDateStr}]\n`
        + `- This is the ONLY source for today's date. Never infer it from search results, article publication dates, or your training data.\n`
        + `- Just after midnight most search results are from the previous day. That does NOT change today's date — it is still the value above.\n`
        + `- If the user asks for "today" and the newest material you found is from an earlier date, give that material but say in one short sentence which date it is from and that little has been published yet today. Do not silently present an earlier date's material as today's.\n`;
    // 블록은 `\n` 으로 끝나고 이어붙일 때 `\n` 을 하나 더 넣는다(= 블록 끝 `\n\n`). 골든이 바이트를 지킨다.
    if (timeBlockAt !== 'end') finalInstruction = `${timeBlock}\n${finalInstruction}`;

    // 동적 컨텍스트 주입
    if (state.webContent) {
        finalInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${state.webContent}`;
    }
    if (state.contextInfo) {
        finalInstruction += `\n\n${state.contextInfo}`;
    }
    // 영화 후속 질문(라우터가 movieFollowup으로 판정한 턴)과 영화 검색 턴(movieSearchTurn): 화면 상영표
    // 요약을 컨텍스트로 주입한다. 검색 턴에 주지 않으면 학습 시점 이후 개봉작이 없는 영화가 된다(DEV_260831).
    // 데이터에 답이 없으면 솔직히 말하고 검색/지점조회를 안내(json:movie 카드는 재생성하지 말 것).
    if ((state.movieFollowup || state.movieSearchTurn) && state.movieContext) {
        finalInstruction += `\n\n${buildMovieFollowupRules(state.movieContext)}`;
    }
    if (state.movieSearchTurn && state.movieContext) {
        // 검색 결과보다 화면이 우선이다. 상영표는 극장사에서 방금 받아온 값이라
        //    "그 영화가 실재하고 지금 상영 중" 이라는 사실의 근거로는 웹 검색보다 강하다.
        finalInstruction += `\n\n${buildMovieSearchRules()}`;
    }

    // 날씨 후속 대화(라우터가 weatherFollowup으로 판정한 턴): 카드는 이미 화면에 있고 그 수치가
    // 히스토리의 json:weather 블록에 그대로 들어 있다. 카드/5일 표를 다시 그리지 말고 그 데이터로
    // 대화하도록 지시한다. (표 규칙 [WEATHER FORMATTING]은 이제 weather 의도에만 주입되므로
    //  이 턴엔 애초에 없지만, 히스토리의 이전 카드/표를 따라 그리는 관성은 남아 명시적으로 막는다.)
    if (state.weatherFollowup) {
        // 날짜 대응을 **모델에게 계산시키지 않는다.** CURRENT_SYSTEM_TIME 이 있어도 daily[].date 와의
        // 대응은 별개의 계산이라 틀린다(오늘 강수를 "내일"로 답하거나 날짜를 하루씩 밀어 부름) →
        // 대응표를 서버가 만들어 준다 → DEV_260817
        finalInstruction += `\n\n${buildDateLadderBlock(now, tz)}`;
        finalInstruction += `\n\n${buildWeatherFollowupRules()}`;
    }

    // 병원 세부정보가 미등록이라 서버 계산이 실패한 턴. 이 경우에만 검색으로 내려간다 —
    // 세부정보 등록률이 낮다(표본 기준 전체 ~30%, 의원은 더 낮음). 있는 정답(심평원)을 두고 추정하지 않되,
    // 없을 때 침묵하지도 않기 위한 폴백이다 → DEV_260824
    let hospitalHoursUnavailable = false;

    if (state.cardFollowup && state.cardContexts?.[state.cardFollowup]) {
        const kind = state.cardFollowup;
        const cardContext = state.cardContexts[kind]!;
        let cardFacts = buildCardFollowupFacts(kind, cardContext, langName);

        // 사용자가 카드의 어느 기관을 지목했는가. 병원 진료시간 조회와 검색 대상 고정에
        // 같은 값을 쓴다 — 두 경로가 다른 기관을 보면 안 된다.
        const { namedEntity, namedAddress } = cardEntity;

        // 병원 "지금 진료하나": 카드(병원기본목록)에는 진료시간이 없다. 심평원 세부정보로
        // 지목된 1건만 조회해 약국과 동일하게 서버가 상태를 확정한다. 실패하면 사실 블록을
        // 붙이지 않고 아래 기본 규칙("자료에 없음 + 전화 확인")이 그대로 적용된다.
        if (needsHospitalHoursLookup(kind, latestUserText)) {
            // 조회는 **호출부가 이미 마쳤다.** 이 함수 안에서 API 를 치면 조립이 순수하지 않아
            // 골든 테스트가 외부 API 에 의존한다(PLAN_PROMPT_LAYERING §7-6).
            const status = hospitalStatus;
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
        // 검색으로 내려가는 턴에는 대상 기관을 값으로 못 박는다 — 상호만으로 검색하면 다른 지역의
        // 동명 기관을 가져온다. 검색어 구성보다 결과 검증이 확실하다 → DEV_260824
        const searchTarget = liveStatusSearch
            ? buildSearchTargetBlock(namedEntity ?? '', namedAddress, langName)
            : '';
        if (searchTarget) cardFacts = `${cardFacts ? `${cardFacts}\n\n` : ''}${searchTarget}`;
        finalInstruction += `\n\n${buildDisplayedCardRules({ kind, cardContext, cardFacts, liveStatusSearch })}`;
    }

    // 조회가 빈손으로 끝난 두 번째 통과(tools → generator). fast-pass 는 `cardHasResults` 가
    // 껐고(langchain-path), 여기서는 **무엇을 말할지**를 준다 — 지시가 없으면 모델이 카드
    // 안내문만 되풀이한다. 판정·문구는 순수 함수로 빼 하니스가 실물을 검사한다.
    const lastToolMsg = [...state.messages].reverse().find(m => m._getType?.() === 'tool');
    const lastToolText = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : '';
    if (lastToolText.includes('```json:') && !cardHasResults(lastToolText)) {
        finalInstruction += `\n\n${buildEmptyCardRules()}`;
    }

    // 화면 논문 카드를 두고 묻는 턴 — 카드가 유일한 근거다. 규칙 본문은 card-followup.ts 에
    // 있다(하니스가 임포트해서 문구 자체를 검사한다. 소스 grep 은 문구가 바뀌면 조용히 통과한다).
    if (state.paperFollowup) {
        finalInstruction += `\n\n${buildPaperFollowupRules()}`;
    }

    // 재구성 요청 턴(라우터 follow_up="refine"): "표로 정리해줘"·"요약해줘"·"비교해줘".
    // 이런 턴은 툴도 검색도 없이 도는 경우가 많아 모델이 추가한 내용을 검증할 장치가 없다.
    // 정적 프롬프트의 [REFORMAT REQUESTS] 규칙만으로는 지켜지지 않아(빈 직전 응답을 두고 표를 지어냄)
    // 해당 턴에만 강하게 못 박는다 → DEV_260815_DEPLOY_CHECK
    if (state.reformatTurn) {
        finalInstruction += `\n\n${buildReformatRules()}`;
    }

    // 직전 턴이 실제로 검색됐다(groundingSources 있음). 출처 내용은 다시 싣지 않으므로, 검색이 꺼진
    // 후속 턴에서 모델이 학습 시점 이후 사실을 환각으로 보고 번복하지 않게 한다 → DEV_261013
    if (state.lastTurnSearched === true) {
        finalInstruction += `\n\n${buildGroundedHistoryRules(state.lastTurnSourceLabels ?? [])}`;
    }

    // 이번 턴 의도에 필요한 렌더러 스펙만 주입한다(base 에는 없다 — prompt.ts INTENT_RENDERERS).
    //
    // 순서: base → 렌더러 스펙 → 의도 정책. **일반 → 전용** 이다(뒤가 앞을 좁힌다).
    // 이 순서는 측정된 기준선으로 유지한다. 근거는 암묵 캐싱이 아니다 — 시각 블록이 앞에 붙고 분 단위가
    // 바뀌어 prefix 재사용이 끊기며, 고정해도 캐시 히트가 낮다(PLAN_PROMPT_LAYERING §7-1).
    // 순서가 응답을 바꾸는지는 위치 A/B 로 따로 잰다.
    const rendererSections = getRendererSections(state.intent, langName);
    if (rendererSections) {
        finalInstruction += `\n\n${rendererSections}`;
    }

    // 렌더러 선택을 돕는 인텐트별 포커스 힌트 주입
    const intentHint = getIntentPolicy(state.intent);
    if (intentHint) {
        finalInstruction += `\n\n${intentHint}`;
    }

    // 위치 A/B 의 대안 배치 — 프로브만 쓴다.
    //   'end'  : 통째로 맨 끝 (Q1 에서 기각 — §10-12. 재현용으로 남긴다)
    //   'both' : 앞은 그대로 두고 **한 줄만** 맨 끝에 다시 놓는다.
    //            날짜 치환만 위치에 민감했으므로 주목도만 올리고 규칙은 더하지 않는다 —
    //            아래 문장은 위 블록 1·3번째 줄의 **재진술**이고 새 지시가 아니다.
    if (timeBlockAt === 'end') finalInstruction += `\n\n${timeBlock}`;
    if (timeBlockAt === 'both') {
        finalInstruction += `\n\n[TODAY — RESTATED] Today is ${currentDateStr}, and that value above is the ONLY source for it.`
            + ` Never take today's date from a search result or an article's publication date.`
            + ` If the newest material you found is from an earlier date, give it but say which date it is from.`;
    }

    return finalInstruction;
};
