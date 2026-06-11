import type { IntentType } from "./state";

const KOREAN_MEDICAL_KEYWORDS = [
    '알약', '약품', '캡슐', '명칭', '식별', '무슨 약',
    '용법', '용량', '성분', '부작용', '주의사항', '효능', '효과', '복용',
    '정제', '필름정', 'mg정', '산제', '시럽', '의약품', '약사', '처방'
];

const MEDICAL_WORD_PATTERN = /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/;
const MULTILINGUAL_MEDICAL_PATTERN = /(^|[^\p{L}\p{N}_])(pill|tablet|capsule|drug|medication|medicine|dosage|dose|side effects?|ingredients?|prescription|pharmacist|pastilla|tableta|c[aá]psula|medicamento|medicina|dosis|efectos secundarios|ingredientes?|receta|farmac[eé]utico|comprim[eé]|g[eé]lule|m[eé]dicament|posologie|effets secondaires|ingr[eé]dient|ordonnance|pharmacien)(?=$|[^\p{L}\p{N}_])/iu;

const FALLBACK_RULES: Array<{ intent: Exclude<IntentType, "drug_id" | "drug_info" | "general">; pattern: RegExp }> = [
    {
        intent: "movie_search",
        pattern: /(영화\s*(상영|시간|관|표|예매)|상영\s*(시간|표|관|정보|중)|상영시간표|무슨\s*영화|영화관|멀티플렉스|cgv|롯데\s*시네마|롯데시네마|메가박스|씨지브이|showtime|movie\s*time|now\s*showing|cinema\s*schedule)/i,
    },
    {
        intent: "law_search",
        pattern: /(법령|법률|법안|조항|제\d+\s*조|몇\s*조|도로교통법|교통법|소방법|소방기본법|민법|형법|상법|근로기준법|근로법|개인정보\s*보호법|개인정보법|판례|헌재|행정규칙|고시|법령해석|korean law|statute|legal article|article\s+\d+|law provision|loi coréenne|article de loi|ley coreana|artículo legal)/i,
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
        intent: "hospital_search",
        pattern: /(병원|의원|응급실|hospital|clinic|emergency room|urgent care|doctor near|hôpital|hopital|clinique|urgences|médecin près|medecin pres|hospital|clínica|clinica|urgencias|médico cerca|medico cerca)/i,
    },
    {
        intent: "astronomy",
        pattern: /(별자리|성좌|천문|천체|밤하늘|은하|우주|행성|항성|별\s|별$|태양|달|월식|일식|유성|혜성|오리온|북두칠성|카시오페이아|안드로메다|양자리|황소자리|쌍둥이자리|게자리|사자자리|처녀자리|천칭자리|전갈자리|궁수자리|염소자리|물병자리|물고기자리|aries|taurus|gemini|cancer|leo|virgo|libra|scorpius|sagittarius|capricorn|aquarius|pisces|orion|ursa major|cassiopeia|andromeda|constellation|star map|night sky|astronomy|celestial|galaxy|planet|meteor|comet|constelación|constelacion|mapa estelar|cielo nocturno|astronomía|astronomia|celeste|galaxia|planeta|meteoro|cometa|constellation|carte du ciel|ciel nocturne|astronomie|céleste|celeste|galaxie|planète|planete|météore|meteore|comète|comete)/i,
    },
    {
        intent: "biology",
        pattern: /(단백질|유전자|DNA|RNA|세포|효소|아미노산|염기서열|protein|gene|genetics|enzyme|cell|pdb|amino acid|sequence|biology|ADN|ARN|proteína|proteina|genética|genetica|enzima|célula|celula|aminoácido|aminoacido|secuencia|biología|biologia|protéine|proteine|génétique|genetique|cellule|acide aminé|acide amine|séquence|sequence|biologie)/i,
    },
    {
        intent: "chemistry",
        pattern: /(분자|화합물|원소|화학|반응식|구조식|SMILES|molecule|compound|chemical|reaction|element|molecular structure|chemical structure|molécula|molecula|compuesto|química|quimica|reacción|reaccion|elemento|estructura molecular|molécule|molecule|composé|compose|chimie|réaction|reaction|élément|element|structure moléculaire|structure moleculaire)/i,
    },
    {
        intent: "physics",
        pattern: /(물리|역학|힘|중력|속도|가속도|운동량|충돌|마찰|경사면|포물선|전기장|자기장|physics|force|gravity|collision|projectile|free body|inclined plane|friction|momentum|electric field|magnetic field|física|fisica|fuerza|gravedad|colisión|colision|proyectil|fricción|friccion|momento|plano inclinado|campo eléctrico|campo electrico|campo magnético|campo magnetico|physique|gravité|gravite|collision|projectile|frottement|quantité de mouvement|quantite de mouvement|plan incliné|plan incline|champ électrique|champ electrique|champ magnétique|champ magnetique)/i,
    },
    {
        intent: "data_viz",
        pattern: /(차트|그래프|시각화|도표|통계|추이|분포|비교|chart|graph|plot|visuali[sz]e|statistics|trend|distribution|comparison|dashboard|gráfico|grafico|visualizar|visualización|visualizacion|estadística|estadistica|tendencia|distribución|distribucion|comparación|comparacion|graphique|visualiser|visualisation|statistique|tendance|distribution|comparaison)/i,
    },
];

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

    if (hasMedicalIntentKeyword(text)) {
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

// 강한 OFF 신호 (검색 불필요): 코드·번역·창작·계산·개념설명
const SEARCH_OFF_PATTERNS: RegExp[] = [
    /```/,
    /\b(code|function|debug|refactor|algorithm)\b/i,
    /(코드|함수|디버그|에러|리팩터|리팩토링|구현|알고리즘)/,
    /(번역|translate)/i,
    /(작성해|써줘|써 줘|작성 해|이메일|문장.{0,4}다듬|교정해)/,
    /(설명해|설명 해|차이.{0,3}(뭐|무엇|설명)|원리|개념|어떻게 (작동|동작|돌아))/,
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
