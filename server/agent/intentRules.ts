import type { IntentType } from "./state";

const KOREAN_MEDICAL_KEYWORDS = [
    '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
    '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
    '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
];

const MEDICAL_WORD_PATTERN = /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/;
const MULTILINGUAL_MEDICAL_PATTERN = /(^|[^\p{L}\p{N}_])(pill|tablet|capsule|drug|medication|medicine|dosage|dose|side effects?|ingredients?|prescription|pharmacist|pastilla|tableta|c[aá]psula|medicamento|medicina|dosis|efectos secundarios|ingredientes?|receta|farmac[eé]utico|comprim[eé]|g[eé]lule|m[eé]dicament|posologie|effets secondaires|ingr[eé]dient|ordonnance|pharmacien)(?=$|[^\p{L}\p{N}_])/iu;

/**
 * 라우터 LLM이 못 쓸 때의 결정론적 폴백.
 *
 * ## 언제 도는가
 * · 라우터 LLM이 429/503으로 죽었을 때 — 전 규칙 발동 ([router.ts](./nodes/router.ts))
 * · `movie_search`·`weather`는 **구제 경로**라 LLM이 성공해도 검사된다 → 오탐 비용이 더 크다
 *
 * ## 설계 원칙 — 확신할 때만 잡는다
 * 놓친 것은 `general`이 받아준다(검색 붙고 산문으로 답함). 잘못 잡은 것은 받아줄 곳이 없다
 * (렌더러 스펙 주입 + 검색 OFF). **재현율보다 정밀도가 우선이다.**
 * 새 토큰을 추가할 때는 "이 단어가 이 분야 밖에서 쓰이는가"를 먼저 따질 것.
 * 한국어는 공백 없이 결합해 `\b`가 안 먹는다 — 단독 명사는 대개 문맥 동반을 요구해야 한다.
 *
 * ## ⚠️ 배열 순서 = 우선순위 (first-match-wins)
 * 위에 있을수록 이긴다. 의도적으로 이 순서다:
 *   1. `sports`·`movie_search`·`law_search` — 고유명사·조문번호라 다른 분야와 겹치지 않는다
 *   2. `pharmacy` → `vet` → `hospital` — **`vet`이 `hospital`보다 반드시 앞.**
 *      `동물병원`의 `병원`이 hospital에 먼저 걸리면 수의 경로가 통째로 죽는다
 *   3. `weather` — 위 장소 검색들과 어휘가 안 겹친다
 *   4. `astronomy` → `biology` → `chemistry` → `physics` — 과학 4종
 *   5. `data_viz` — **맨 끝**. `차트`·`그래프`는 위 어느 분야와도 결합하므로
 *      ("분자 구조 차트", "별자리 그래프") 도메인이 먼저 잡게 둔다
 *
 * 검증: `npx tsx tests/test-intent-rules.mts` (양방향 — 잡아야 할 것 / 잡으면 안 될 것)
 * 기획: docs/plans/PLAN_INTENT_RULES_PRECISION_260816.md
 */
const FALLBACK_RULES: Array<{ intent: Exclude<IntentType, "drug_id" | "drug_info" | "general">; pattern: RegExp }> = [
    {
        intent: "sports",
        pattern: /(월드컵|world\s?cup|조별\s*리그|조별\s*순위|[A-L]조\s*순위|16강|8강|준결승|결승\s*대진|월드컵\s*대진|월드컵\s*득점왕|월드컵\s*일정)/i,
    },
    {
        // ⚠️ `영화관` 단독은 뺐다. `영화관 데이트 코스 글 써줘`처럼 작문 소재로 쓰이면
        //    상영시간 카드가 뜬다. 이 규칙은 **구제 경로**(router.ts 영화 의도 구제)라
        //    라우터 LLM이 성공해도 발동하므로 오탐 비용이 특히 크다.
        //    → 위치·상영 질의어를 동반할 때만. (PLAN_INTENT_RULES_PRECISION_260816 Step 2)
        intent: "movie_search",
        pattern: /(영화\s*(상영|시간|표|예매|정보|일정|스케줄|뭐)|상영\s*(시간|표|관|정보|중|작)|상영시간표|무슨\s*영화|볼만한\s*영화|개봉\s*영화|(근처|주변|가까운|인근)\s*영화관|영화관\s*(어디|위치|찾|추천|상영|예매|시간|정보|알려|목록)|멀티플렉스|cgv|롯데\s*시네마|롯데시네마|메가박스|씨지브이|showtime|movie\s*time|now\s*showing|cinema\s*schedule)/i,
    },
    {
        // ⚠️ `조항`·`고시` 단독은 뺐다. `이 조항 좀 다듬어줘`(문서 편집)·`계약서 조항 작성해줘`
        //    (작문)·`공무원 고시 준비`(시험)가 법령 조회로 갔다. 조문 조회는 `제\d+조`·`몇 조`·
        //    법률명이 이미 받는다. (PLAN_INTENT_RULES_PRECISION_260816 Step 5)
        intent: "law_search",
        pattern: /(법령|법률|법안|제\d+\s*조|몇\s*조|(행정|부처|장관|복지부|식약처|국토부|환경부)\s*고시|고시\s*제\s*\d|도로교통법|교통법|소방법|소방기본법|민법|형법|상법|근로기준법|근로법|개인정보\s*보호법|개인정보법|판례|헌재|행정규칙|법령해석|korean law|statute|legal article|article\s+\d+|law provision|loi coréenne|article de loi|ley coreana|artículo legal)/i,
    },
    {
        intent: "pharmacy_search",
        pattern: /(약국|pharmacy|pharmacies|drugstore|farmacia|farmacias|pharmacie|pharmacies)/i,
    },
    {
        intent: "vet_search",
        pattern: /(동물병원|동물 병원|동물의원|동물 의료|동물의료|수의사|수의과|veterinary|veterinarian|animal hospital|pet hospital|vet clinic|vétérinaire|veterinaire|clinique vétérinaire|clinique veterinaire|hôpital pour animaux|hopital pour animaux|veterinario|clínica veterinaria|clinica veterinaria|hospital de animales)/i,
    },
    {
        // ⚠️ `병원`·`의원` 단독은 뺐다. `병원 예약하는 법`(방법 질의)·`병원비 세액공제`(세무)·
        //    `국회의원 정수`(議員)가 병원 검색으로 갔다. 위치 질의어나 진료과명을 요구한다.
        //    (PLAN_INTENT_RULES_PRECISION_260816 Step 5)
        intent: "hospital_search",
        pattern: /((근처|주변|가까운|인근|동네)\s*(병원|의원)|병원\s*(어디|위치|찾|추천|목록|알려)|내과|외과|치과|한의원|소아과|산부인과|정형외과|피부과|(?<![A-Za-z0-9])안과|이비인후과|응급실|hospital|clinic|emergency room|urgent care|doctor near|hôpital|hopital|clinique|urgences|médecin près|medecin pres|hospital|clínica|clinica|urgencias|médico cerca|medico cerca)/i,
    },
    {
        // 날씨 — 라우터 LLM 실패(무료티어 503/timeout) 시 이 폴백이 general+grounding 대신 weather로 보낸다.
        // ⚠️ 카드 툴은 "특정 지역 현재날씨 + 단기예보"만 답한다. 장마 시작 시기·폭염 전망·미세먼지 농도
        //    같은 계절/현상 질의는 카드가 못 답하므로 여기서 제외 → general+search가 처리("장마일정 조사").
        //    오발 방지 위해 명확한 '현재 날씨' 토큰만(모호한 '기상'(기상=wake)·'tiempo' 단독 제외).
        //
        // ⚠️ `날씨`·`기온` **단독**은 뺐다. `날씨 좋은 날 뭐하지`·`분위기가 기온처럼 오르내려`
        //    처럼 배경·비유로 쓰이면 카드가 뜬다. 이 규칙은 **구제 경로**(router.ts 날씨 의도
        //    구제)라 라우터 LLM이 성공해도 발동하므로 오탐 비용이 특히 크다.
        //    → 질의어를 동반하거나 문장 끝(`부산 날씨`)일 때만.
        //    (PLAN_INTENT_RULES_PRECISION_260816 Step 2)
        intent: "weather",
        pattern: /((날씨|기온|기후)\s*(어때|어떄|어떻|어떤|알려|말해|보여|확인|예보|정보|좋아|추워|더워|나빠|는\?|은\?)|(날씨|기온)\s*[?？]?\s*$|기상청|기상\s*(특보|예보)|몇\s*도(예|야|니|인가|일까)?|체감\s*온도|소나기|비\s*(와|올|오|온|내리|많이\s*와)|눈\s*(와|올|오|온|내리)|weather|forecast|temperature|how\s*(hot|cold|warm)|m[eé]t[eé]o|pron[oó]stico\s*(del\s*)?(tiempo|clima)|clima\s*de)/i,
    },
    {
        // ⚠️ 이 패턴은 한때 오탐 최다였다. `별\s|별$|달|태양` + 영문 12궁 단독명이 원인:
        //      · `분기별 매출을 차트로` → `별\s`가 ~별 접미사를 물고, first-match-wins라
        //        뒤에 있는 data_viz에 닿지도 못했다
        //      · `이번 달 일정` `목표 달성` `달러 환율` → `달`
        //      · `태양광 발전 수익률` → `태양`
        //      · `Gemini 모델 비교` `cancer 치료제` `libra 라이브러리` → 영문 12궁 단독명
        //   폴백은 LLM이 죽었을 때 쓰는 최후 수단이다. 놓치면 general+검색이 받아주지만,
        //   잘못 잡으면 렌더러 스펙 주입 + 검색 OFF라 받아줄 곳이 없다.
        //   → 재현율보다 정밀도. 애매한 단독어는 전부 문맥 동반을 요구한다.
        //   (PLAN_INTENT_RULES_PRECISION_260816 Step 1, 검증 tests/test-intent-rules.mts)
        intent: "astronomy",
        pattern: new RegExp([
            // 단독으로 천문 이외의 뜻이 거의 없는 것들
            '별자리', '성좌', '천문', '천체', '밤하늘', '은하', '행성', '항성', '별똥별', '별빛',
            '월식', '일식', '유성', '혜성', '북두칠성', '카시오페이아', '안드로메다', '오리온',
            // `별` 단독은 버린다(별로·별일·~별 접미사). 천문 행위와 붙을 때만.
            '별\\s*(관측|보기|사진|촬영|구경)',
            // `달`: 위상어가 붙거나 천문 문맥일 때만. `이번 달`·`달성`·`달러` 배제
            '(보름|초승|반|그믐|상현|하현)달', '달\\s*(표면|착륙|탐사|위상|뒷면|기지|궤도)',
            // `태양`: 태양광·태양열·태양전지(에너지 산업)는 제외
            '태양(?!광|열|전지)',
            // `우주`: `우주적인`(비유) 제외
            '우주(?!적)',
            '양자리', '황소자리', '쌍둥이자리', '게자리', '사자자리', '처녀자리',
            '천칭자리', '전갈자리', '궁수자리', '염소자리', '물병자리', '물고기자리',
            // 영문 12궁 단독명(gemini·cancer·leo·libra…)은 일반어와 충돌해 전부 뺐다.
            // 영어권 별자리 질의는 아래 constellation/zodiac/star sign이 받는다.
            '(constellation|zodiac|star\\s*sign)',
            'ursa major', 'cassiopeia', 'andromeda', 'star map', 'night sky',
            'astronomy', 'celestial', 'galaxy', 'planet', 'meteor shower',
            'constelación', 'constelacion', 'mapa estelar', 'cielo nocturno',
            'astronomía', 'astronomia', 'galaxia', 'planeta', 'meteoro', 'cometa',
            'carte du ciel', 'ciel nocturne', 'astronomie', 'céleste', 'celeste',
            'galaxie', 'planète', 'planete', 'météore', 'meteore', 'comète', 'comete',
        ].join('|'), 'i'),
    },
    {
        intent: "biology",
        // ⚠️ `유전자 알고리즘`(코드)·영문 `cell` 단독(스프레드시트 셀)은 제외.
        //    (PLAN_INTENT_RULES_PRECISION_260816 Step 5)
        pattern: /(단백질|유전자(?!\s?알고리즘)|DNA|RNA|세포|효소|아미노산|염기서열|protein|gene|genetics|enzyme|(stem\s*)?cell\s*(biology|membrane|division|structure|cycle)|stem\s*cell|pdb|amino acid|sequence|biology|ADN|ARN|proteína|proteina|genética|genetica|enzima|célula|celula|aminoácido|aminoacido|secuencia|biología|biologia|protéine|proteine|génétique|genetique|cellule|acide aminé|acide amine|séquence|sequence|biologie)/i,
    },
    {
        intent: "chemistry",
        pattern: /(분자|화합물|원소|화학(?!적|과)|반응식|구조식|SMILES|molecule|compound|chemical|reaction|element|molecular structure|chemical structure|molécula|molecula|compuesto|química|quimica|reacción|reaccion|elemento|estructura molecular|molécule|molecule|composé|compose|chimie|réaction|reaction|élément|element|structure moléculaire|structure moleculaire)/i,
    },
    {
        // ⚠️ `힘`·`속도` 단독은 뺐다. `힘내라고 응원 메시지`·`힘든 하루`·`인터넷 속도`·
        //    `업무 속도`가 물리 렌더러로 갔다. 한국어는 공백 없이 결합해 `\b`로 못 가른다
        //    → 물리 문맥이 붙은 복합어만 받는다. (PLAN_INTENT_RULES_PRECISION_260816 Step 4)
        intent: "physics",
        pattern: /(물리|역학|중력|가속도|등속|자유\s?낙하|합력|알짜\s*힘|수직항력|장력|부력|탄성력|마찰력|작용\s*반작용|운동\s*에너지|위치\s*에너지|힘\s*의\s*(평형|분해|합성)|(상대|평균|종단)\s*속도|속도\s*(벡터|변화율)|운동량|충돌|마찰|경사면|포물선|전기장|자기장|physics|force|gravity|collision|projectile|free body|inclined plane|friction|momentum|electric field|magnetic field|física|fisica|fuerza|gravedad|colisión|colision|proyectil|fricción|friccion|momento|plano inclinado|campo eléctrico|campo electrico|campo magnético|campo magnetico|physique|gravité|gravite|collision|projectile|frottement|quantité de mouvement|quantite de mouvement|plan incliné|plan incline|champ électrique|champ electrique|champ magnétique|champ magnetique)/i,
    },
    {
        // ⚠️ `통계|추이|분포|비교`(+ statistics/trend/distribution/comparison)는 뺐다.
        //    `이 두 제품 비교해줘`·`통계학 공부 어떻게 시작해?`처럼 시각화와 무관한 일상 요청을
        //    차트 렌더러로 끌고 갔다. 게다가 이 토큰들은 **아무것도 더 잡지 못한다** —
        //    `비교 차트 그려줘`는 이미 `차트`가 받는다. 오탐만 남는 순손실이었다.
        //    (PLAN_INTENT_RULES_PRECISION_260816 Step 3)
        intent: "data_viz",
        pattern: /(차트|그래프|시각화|도표|chart|graph|plot|visuali[sz]e|dashboard|gráfico|grafico|visualizar|visualización|visualizacion|graphique|visualiser|visualisation)/i,
    },
];

/**
 * 제형(dosage form) 어휘 — **고정밀** 의약품 신호.
 *
 * `hasMedicalIntentKeyword`와 분리해 둔 이유: 그쪽은 `효과`·`성분`·`명칭` 같은 범용어를 포함해
 * 재현율은 높지만 정밀도가 낮다. 라우터 LLM의 `general` 판정을 **뒤집는** 용도로 쓰면
 * `"이 마케팅 전략 효과 있어?"` 같은 발화가 drug_info로 끌려간다.
 *
 * 여기 있는 것들은 약학 문맥에서만 쓰이는 제형 명칭이라 오탐 여지가 거의 없다.
 * 계기: `인공 타액제 알려줘`가 어떤 의약 신호에도 안 걸려 general로 새면서
 * `search_drug_info`(MFDS 실데이터) 경로를 통째로 우회했다 — 모델이 제품명을 지어냈다.
 * (DEV_260815_DEPLOY_CHECK)
 *
 * ⚠️ 추가할 때는 "이 단어가 약이 아닌 문맥에서 쓰이는가"를 먼저 따질 것. 실제로 걸러낸 것들:
 *    · `정제`(refine/purify) · `캡슐`(캡슐호텔) · `산제`("산제 발표 자료") — 제외
 *    · `연고`는 緣故(연고지·연고자·연고권)와 충돌 → 그 접미만 lookahead로 배제
 *    · `타액` 단독은 생리 현상 질문("타액 분비가 왜 줄지?")이라 제형이 아님 → `인공 타액`만
 *
 * 남은 위험: "그 지역에 연고가 있어?"(緣故)는 여전히 걸린다. 접미로 구분되지 않는 용법이라
 * 정규식으로는 못 가른다. 오탐 시 결과는 general → drug_info 오라우팅 하나뿐이고,
 * 이 앱의 질의 분포에서 빈도가 낮다고 보고 감수한다. 문제가 관측되면 `연고제`만 남길 것.
 */
const DOSAGE_FORM_PATTERN =
    /(타액제|인공\s?타액|연고제|연고(?![지자권])|좌제|점안액|점안제|점비액|시럽제|현탁액|과립제|주사제|패치제|첩부제|가글액|구강\s?스프레이|분무제|외용액|ointment|suppositor(y|ies)|eye\s?drops?|oral\s?spray|artificial\s?saliva)/i;

/** 제형 명칭이 들어 있는가 — 라우터의 general 오분류를 되돌릴 만큼 확실한 의약 신호. */
export const hasDosageFormKeyword = (text: string): boolean => DOSAGE_FORM_PATTERN.test(text);

export const hasMedicalIntentKeyword = (text: string): boolean => {
    return KOREAN_MEDICAL_KEYWORDS.some(keyword => text.includes(keyword)) ||
        MEDICAL_WORD_PATTERN.test(text) ||
        MULTILINGUAL_MEDICAL_PATTERN.test(text);
};

/**
 * Deterministic fallback for product-critical intents.
 * This is used only when semantic routing is unavailable or inconclusive.
 */
export const classifyIntentByRules = (text: string, hasImage: boolean): IntentType => {
    for (const rule of FALLBACK_RULES) {
        if (rule.pattern.test(text)) return rule.intent;
    }

    // 제형 어휘는 hasMedicalIntentKeyword가 놓치는 구간을 메운다(`인공 타액제` 등).
    if (hasMedicalIntentKeyword(text) || hasDosageFormKeyword(text)) {
        return hasImage ? "drug_id" : "drug_info";
    }

    return "general";
};

// ============================================================
// Search-need classification (general intent only)
//   기획: docs/plans/PLAN_LATENCY_SEARCH_ROUTING.md (4-1, 4-2, 6-3, 9-2)
//   검증: scripts/test-search-rules.mjs (단일턴 22/22, OFF→ON FP 0, 멀티턴 가드 4/4)
//   ※ 아래 정규식은 위 테스트 프로토타입과 동일하게 유지할 것 (변경 시 테스트 동기화).
//   ※ rule은 lite(router LLM) fallback·fast-path용. 다국어 회색지대는 lite가 처리하므로
//      여기 키워드는 ko 중심 + 핵심 en. 필요 시 es/fr 보강 (기획 9-5).
// ============================================================

export type SearchDecision = "on" | "off" | "gray";

// 강한 OFF 신호 (검색 불필요): 코드·번역·창작·계산
// 주의: "설명해/차이/원리/개념/어떻게 작동"은 강한 OFF에서 제외 → gray로 위임.
//   "gpt 5.5 설명해줘"처럼 최근·불확실 엔티티 설명은 검증 검색이 필요하므로
//   하드 OFF로 단정하지 말고 라우터 LLM(needs_search) 판정에 맡긴다. (DEV_260624 §5, A안)
const SEARCH_OFF_PATTERNS: RegExp[] = [
    /```/,
    /\b(code|function|debug|refactor|algorithm)\b/i,
    /(코드|함수|디버그|에러|리팩터|리팩토링|구현|알고리즘)/,
    /(번역|translate)/i,
    /(작성해|써줘|써 줘|작성 해|이메일|문장.{0,4}다듬|교정해)/,
    /(곱하기|나누기|더하기|빼기|\d+\s*[\+\-\*\/x×]\s*\d+)/,
];

// 강한 ON 신호 (검색 필요): 시의성·실시간·명시검색 + 보강(인물근황·순위·기업지표)
const SEARCH_ON_PATTERNS: Array<{ tag: string; re: RegExp }> = [
    { tag: "temporal", re: /(오늘|지금|현재|최근|최신|요즘|이번\s?주|이번\s?달|올해|작년|내년|20\d\d년)/ },
    { tag: "domain", re: /(뉴스|날씨|기온|주가|주식|환율|시세|가격|얼마|출시|일정|경기\s?결과|스코어)/ },
    { tag: "explicit", re: /(검색해|검색 해|찾아봐|찾아 줘|알아봐|출처|근거(는|를| )|cite|search)/i },
    { tag: "person", re: /(CEO|대표|회장|총수|사장|장관|대통령|총리).{0,6}(누구|누가|뭐|이름|은|는)|(누구야|누구임|누구인가|누구니)/ },
    { tag: "ranking", re: /(순위|랭킹|\d+위|점유율|인기\s?(많|높|있|순|차트|순위)|인기\s?(가|는|이)|더\s?인기|가장\s?(많|높|인기|큰\s?인기))/ },
    { tag: "finance", re: /(시가총액|매출|영업이익|연봉|점유율|판매량|구독자\s?수)/ },
];

// follow-up 가공형 참조어 (멀티턴 가드용): 직전 답변을 가공·참조하는 신호
const FOLLOWUP_REF_PATTERN = /(요약|정리|비교|방금|아까|위에서|위의|앞서|그거|그건|그것|이전에 (말|검색|알려))/;

// 과거참조(past-ref) 패턴: "최근/방금 + 검색한/알려준" = 직전 결과 참조 (새 최신요구 아님)
const PAST_REF_PATTERN = /(최근|방금|아까|이전에|앞서|위에서)\s?\S{0,3}(검색|알려|말한|말씀|보여|찾)/;

const evalSearchNeed = (text: string): { decision: SearchDecision; onTags: string[] } => {
    const onTags = SEARCH_ON_PATTERNS.filter(p => p.re.test(text)).map(p => p.tag);
    if (onTags.length > 0) return { decision: "on", onTags };
    if (SEARCH_OFF_PATTERNS.some(re => re.test(text))) return { decision: "off", onTags };
    return { decision: "gray", onTags };
};

/**
 * 단일턴 검색 필요 여부 룰 판정 (general intent 전용).
 * ON 신호가 하나라도 잡히면 "on" (검색누락 방어 우선). 둘 다 없으면 "gray" → router LLM/default 위임.
 */
export const classifySearchNeed = (text: string): SearchDecision => evalSearchNeed(text).decision;

/** follow-up 가공형(요약·정리·비교·방금 등) 참조 여부 */
export const isFollowupReference = (text: string): boolean => FOLLOWUP_REF_PATTERN.test(text);

/** 과거참조("최근 검색한", "방금 알려준") 여부 — temporal ON이라도 새 최신요구가 아님을 구분 */
export const isPastReference = (text: string): boolean => PAST_REF_PATTERN.test(text);

// ============================================================
// 명시적 검색 요청 탐지 — 단일 출처 (기획 PLAN_SEARCH_POLICY_260815 §2)
//   이전에는 같은 개념이 두 곳에 다른 정규식으로 존재했다:
//     · intentRules SEARCH_ON_PATTERNS.explicit (좁음) — "찾아서/찾아줘/조사/알아보자"를 놓침
//     · search-gate.ts explicitSearchRequested (넓음) — 시의성 어휘까지 섞여 있음
//   좁은 쪽이 멀티턴 가드의 관문 역할을 하면서 "검색해서 정리해줘"조차 억제됐다(DEV_260815).
//   → 넓은 쪽 기준으로 통합하되, 시의성(최신·최근·실시간·뉴스)은 여기서 제외한다.
//     "검색해줘"(사용자 의사, tier 300)와 "최신 정보"(시의성 신호, tier 100)는 다른 개념이고
//     권한 계층이 다르다. 섞으면 tier 300이 남발되어 계층이 무의미해진다.
// ============================================================
const EXPLICIT_SEARCH_PATTERN =
    /(검색|구글링|구글|google|서치|웹에서|웹\s?검색|인터넷|찾아|조사(해|하|를|해서)|알아보|알아봐|출처|근거(는|를| |$)|레퍼런스|cite|search|look\s?up)/i;

/**
 * 사용자가 **명시적으로** 웹 검색·출처를 요청했는지.
 * 과거참조("아까 검색 결과 다시 요약")는 새 검색 요청이 아니므로 제외한다 —
 * 이걸 빼지 않으면 직전 결과를 가공해달라는 요청이 매번 재검색을 유발한다.
 */
export const detectExplicitSearchRequest = (text: string): boolean =>
    EXPLICIT_SEARCH_PATTERN.test(text) && !PAST_REF_PATTERN.test(text);

/**
 * 멀티턴 가드 (기획 6-3): 직전 턴에 검색이 일어났고 현재 메시지가 follow-up 가공형이면,
 * 새 최신요구(temporal/domain ON & not past-ref)가 아닌 한 재검색을 억제(off)한다.
 * @param currentText 현재 사용자 메시지
 * @param prevSearched 직전 턴 검색 발생 여부 (9-B 권장: 직전 human 메시지의 classifySearchNeed==="on" 근사)
 * @returns true면 needsSearch를 false로 무력화해야 함
 */
export const shouldSuppressSearchForFollowup = (currentText: string, prevSearched: boolean): boolean => {
    if (!prevSearched || !FOLLOWUP_REF_PATTERN.test(currentText)) return false;
    const { onTags } = evalSearchNeed(currentText);
    const pastRef = PAST_REF_PATTERN.test(currentText);
    const wantsFresh = (onTags.includes("temporal") || onTags.includes("domain")) && !pastRef;
    return !wantsFresh; // 새 최신요구가 아니면 억제
};
