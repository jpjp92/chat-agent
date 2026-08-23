import { type LangName, DEFAULT_LANG_NAME, pickByLang } from './lang';

export type LocationCardKind = 'pharmacy' | 'hospital' | 'vet';
export type CardFollowupDecision = 'new' | 'refine' | 'acknowledge' | 'unrelated';
export type RouterFollowupDecision = 'new' | 'refine' | 'unrelated' | undefined;

const ACKNOWLEDGEMENT = /(가야겠다|가볼게|갈게|여기로\s*가|여기\s*갈|정했어|선택했어|고마워|감사|알겠|확인했|그렇구나|좋네|괜찮네|뿐이네|뿐이군|됐어|오케이|okay|thanks?)/i;
const CARD_DETAIL = /(몇\s*시|영업\s*시간|운영\s*시간|근무\s*시간|업무\s*시간|진료\s*시간|접수\s*시간|점심\s*시간|전화(?:번호)?|주소|휴무|문\s*(열|닫)|지금\s*(열|영업|진료)|오늘\s*(열|영업|진료)|열려\s*있|열었|열렸|닫혔|닫았|영업\s*(중|하나|해|한다|할까)|의사\s*수|어디가\s*더|어느\s*곳이|비교|가장\s*(늦게|일찍))/i;
const NEW_LOOKUP = /(찾아|검색|보여|알려|추천|어디|가까운|근처|주변|인근|다른\s*(곳|약국|병원)|새로|재검색|목록|지역|동네)/i;
const REQUEST_SHAPE = /([?？]|줘|주세요|해줘|해\s*줘|알려|보여|찾아|추천|어디|있어|있나|인가|일까)\s*$/i;
/** 명시적 전환 — 지역이 없어도 새 조회로 본다. */
const EXPLICIT_NEW = /(다른\s*(곳|데|지역|동네|약국|병원|동물병원)|딴\s*데|새로|재검색)/i;
/** 새 조회 대상이 되는 지역·행정 토큰. 이게 없으면 화면 카드에 대한 요청으로 본다. */
// 조사가 붙어도 잡아야 한다("효자동에서"). 그렇다고 뒤 한글을 전부 허용하면 "그렇구나"의 `구`까지
// 지역으로 오인하므로, 뒤에 올 수 있는 조사만 열거한다.
const AREA_TOKEN = /[가-힣]{2,}(시|군|구|동|읍|면|로|길|역)(?:(?![가-힣])|(?=에|에서|은|는|이|가|의|도|만|으로|로|쪽|과|와|근처|인근|주변))/;
/** 상호로 보이는 토큰. 화면 카드에 없는 이름을 대면 그것도 새 조회 대상이다. */
const FACILITY_NAME = /[가-힣A-Za-z0-9]{2,}(약국|동물병원|병원|의원|메디컬센터)/g;
const CLEARLY_OTHER_DOMAIN = /(날씨|기온|비\s*와|영화|상영|법률|법령|조문|코드|파이썬|뉴스|번역|주식|환율|월드컵)/i;

const squash = (value: string) => value.replace(/\s+/g, '');

// 🔴 어휘가 좁으면 조회 자체가 안 걸린다. 실측(2026-08-24): `늘좋은내과의원 근무시간은?`이
// `진료시간`만 알던 이 패턴에 안 걸려 심평원 조회를 건너뛰고 "확인되지 않습니다"로 답했다.
const LIVE_STATUS_QUESTION = /(열려\s*있|열었|열렸|닫혔|닫았|문\s*(열|닫)|영업\s*(중|하나|해|한다|할까|여부)|진료\s*(중|하나|해|하나요|여부|시간)|(근무|업무|운영|영업|접수|점심)\s*시간|몇\s*시(까지|부터)?|언제\s*(까지|열|여|닫)|오픈|마감|지금\s*(열|영업|진료)|오늘\s*(열|영업|진료)|야간|당직|응급)/i;

/** 앞 턴에서 못 찾은 정보를 "다시 찾아봐 달라"는 재시도 요청. 대상 없이 방법만 말한다. */
const RETRY_LOOKUP = /(검색(해|해서|으로)?|찾아\s*(볼|봐|줘|주세요)|알아\s*(봐|봐줘)|확인\s*(해|해줘)|다시\s*(찾|검색|확인))/i;

/**
 * 동물병원 카드는 행안부 **인허가** 데이터라 진료시간 필드가 아예 없다. 그래서 "지금 진료하나"는
 * 카드만으로 답할 수 없고, 침묵하면 모델이 인허가 상태('영업/정상')를 현재 영업으로 오독한다
 * (실측 2026-08-23: "열려 있는 동물병원 10곳" 단정). 이 턴에 한해 웹 검색을 열어 근거를 찾게 하고,
 * 확정이 아니라는 것과 전화 확인을 함께 말하도록 generator가 규칙을 바꾼다.
 *
 * 병원(hospital)은 심평원 세부정보 API에 요일별 진료시간이 구조화돼 있으므로 검색 추정 대상이
 * 아니다 — 그 키가 준비되면 약국과 같은 서버 계산 경로로 붙인다.
 */
export function needsLiveStatusSearch(
    kind: LocationCardKind | 'law' | '',
    text: string,
    cardNames: string[] = [],
): boolean {
    if (kind !== 'vet') return false;
    const trimmed = text.trim();
    if (LIVE_STATUS_QUESTION.test(trimmed)) return true;
    // 카드 안내가 "진료시간이 필요하면 병원 이름을 알려주세요"라고 유도하므로, 이름만 말한 턴도
    // 그 요청으로 받는다. 이름을 지목했는데 검색이 안 켜지면 안내가 지키지 못할 약속이 된다.
    const squashedText = squash(trimmed);
    return cardNames.some(name => squashedText.includes(squash(name)));
}

/**
 * 병원은 심평원 세부정보로 서버가 상태를 계산한다 — 이 턴이 그 조회를 해야 하는가.
 * 시간 질문뿐 아니라 "검색해서 찾아볼 수 있어?" 같은 재시도 요청도 포함한다. 병원 카드 후속에서
 * 대상 없는 재시도는 사실상 직전에 못 준 정보(=진료시간)를 다시 달라는 뜻이고, 조회가 헛돌아도
 * null이 나와 기존 안내로 폴백하므로 비용은 API 2회뿐이다.
 */
export function needsHospitalHoursLookup(kind: LocationCardKind | 'law' | '', text: string): boolean {
    if (kind !== 'hospital') return false;
    const trimmed = text.trim();
    return LIVE_STATUS_QUESTION.test(trimmed) || RETRY_LOOKUP.test(trimmed);
}

/** 병원 진료시간 사실 블록의 라벨. 약국과 같은 이유로 응답 언어를 따라간다. */
const HOSPITAL_HOURS_LABELS: Record<LangName, {
    title: string; checkedAt: string; hoursToday: string; lunch: string; state: string;
    open: string; closed: string; unknown: string; emergency: string; emergencyPhone: string;
    note: string; none: string;
}> = {
    Korean: {
        title: '병원 진료 상태 — 심평원 조회 결과, 이 값이 정답입니다',
        checkedAt: '상태 확인 시각', hoursToday: '오늘 진료시간', lunch: '점심시간', state: '지금 진료',
        open: '진료 중', closed: '진료 중 아님', unknown: '확인 불가',
        emergency: '야간 응급실', emergencyPhone: '응급실 전화', none: '정보 없음',
        note: '진료시간이 끝났어도 응급실이 운영되면 응급 진료는 가능합니다. 점심시간에는 접수가 중단될 수 있으니 방문 전 전화 확인을 권하세요.',
    },
    English: {
        title: 'Hospital treatment status — from the HIRA lookup, these values are authoritative',
        checkedAt: 'Status checked at', hoursToday: "Today's hours", lunch: 'Lunch break', state: 'Open right now',
        open: 'open', closed: 'not open', unknown: 'could not be determined',
        emergency: 'Night emergency room', emergencyPhone: 'Emergency phone', none: 'not available',
        note: 'Emergency care may still be available after regular hours if the emergency room operates. Reception can pause during the lunch break, so advise calling ahead.',
    },
    Spanish: {
        title: 'Estado de atención del hospital — según la consulta a HIRA, estos valores son los correctos',
        checkedAt: 'Estado verificado a las', hoursToday: 'Horario de hoy', lunch: 'Hora de almuerzo', state: 'Atendiendo ahora',
        open: 'atendiendo', closed: 'no atendiendo', unknown: 'no se pudo determinar',
        emergency: 'Urgencias nocturnas', emergencyPhone: 'Teléfono de urgencias', none: 'sin información',
        note: 'La atención de urgencias puede seguir disponible fuera del horario si funciona el servicio de urgencias. La recepción puede pausarse durante el almuerzo, así que conviene llamar antes.',
    },
    French: {
        title: "Statut de consultation de l'hôpital — d'après la consultation HIRA, ces valeurs font foi",
        checkedAt: 'Statut vérifié à', hoursToday: "Horaires du jour", lunch: 'Pause déjeuner', state: 'En consultation maintenant',
        open: 'en consultation', closed: 'pas en consultation', unknown: 'indéterminé',
        emergency: 'Urgences de nuit', emergencyPhone: 'Téléphone des urgences', none: 'non disponible',
        note: "Les urgences peuvent rester accessibles en dehors des horaires si le service fonctionne. L'accueil peut s'interrompre pendant la pause déjeuner : conseillez d'appeler avant.",
    },
};

/**
 * 검색으로 내려갈 때 "어느 기관인가"를 서버가 못 박는다.
 *
 * 실측(2026-08-24): `나루동물병원 진료시간`에 모델이 상호만으로 검색해 **종로의 동명 병원** 시간을
 * 가져왔다. 규칙에 "상호와 주소를 함께 검색하라"고 써도 검색어 구성은 모델에 달려 있어 신뢰할 수
 * 없다. 그래서 ⓐ 대상 주소를 값으로 주고 ⓑ **결과 주소가 다르면 버리라**는 검증을 함께 건다.
 * 검색어를 잘 만드는 것보다 잘못된 결과를 버리는 쪽이 확실하다.
 */
const SEARCH_TARGET_LABELS: Record<LangName, { title: string; name: string; address: string; rule: string; verify: string }> = {
    Korean: {
        title: '검색 대상 — 이 기관 하나만 해당합니다',
        name: '상호', address: '주소',
        rule: '검색어에 위 주소의 시·구와 도로명을 반드시 포함하세요.',
        verify: '검색 결과에 적힌 주소가 위 주소와 다르면 같은 이름의 다른 기관입니다. 그 결과는 쓰지 말고 버리세요. 남는 결과가 없으면 확인되지 않는다고 답하세요.',
    },
    English: {
        title: 'Search target — this one institution only',
        name: 'Name', address: 'Address',
        rule: 'Include the city, district, and street from the address above in your search query.',
        verify: 'If the address in a search result differs from the one above, it is a different institution with the same name. Discard that result. If nothing is left, say it could not be confirmed.',
    },
    Spanish: {
        title: 'Objetivo de búsqueda — solo esta institución',
        name: 'Nombre', address: 'Dirección',
        rule: 'Incluya la ciudad, el distrito y la calle de la dirección anterior en la consulta de búsqueda.',
        verify: 'Si la dirección de un resultado difiere de la anterior, es otra institución con el mismo nombre. Descarte ese resultado. Si no queda ninguno, diga que no se pudo confirmar.',
    },
    French: {
        title: 'Cible de recherche — cet établissement uniquement',
        name: 'Nom', address: 'Adresse',
        rule: "Incluez la ville, l'arrondissement et la rue de l'adresse ci-dessus dans votre requête.",
        verify: "Si l'adresse d'un résultat diffère de celle ci-dessus, il s'agit d'un autre établissement du même nom. Écartez ce résultat. S'il n'en reste aucun, dites que cela n'a pas pu être confirmé.",
    },
};

export function buildSearchTargetBlock(name: string, address: string, langName: LangName = DEFAULT_LANG_NAME): string {
    if (!name.trim() || !address.trim()) return '';
    const t = pickByLang(SEARCH_TARGET_LABELS, langName);
    return `[${t.title}]\n`
        + `- ${t.name}: ${name.trim()}\n`
        + `- ${t.address}: ${address.trim()}\n`
        + `- ${t.rule}\n`
        + `- ${t.verify}`;
}

export function buildHospitalHoursFacts(status: {
    name: string; hours_today: string; lunch: string; is_open_now: boolean | null;
    closed_reason: string; emergency_night: boolean; emergency_phone: string; checked_at: string;
}, langName: LangName = DEFAULT_LANG_NAME): string {
    const t = pickByLang(HOSPITAL_HOURS_LABELS, langName);
    const state = status.is_open_now === true ? t.open
        : status.is_open_now === false ? `${t.closed}${status.closed_reason ? ` (${status.closed_reason})` : ''}`
        : t.unknown;

    return `[${t.title}]\n`
        + `- ${status.name}\n`
        + `- ${t.checkedAt}: ${status.checked_at}\n`
        + `- ${t.hoursToday}: ${status.hours_today || t.none}\n`
        + `- ${t.lunch}: ${status.lunch || t.none}\n`
        + `- ${t.state}: ${state}\n`
        + `- ${t.emergency}: ${status.emergency_night ? 'Y' : 'N'}${status.emergency_phone ? ` / ${t.emergencyPhone}: ${status.emergency_phone}` : ''}\n`
        + `- ${t.note}`;
}


/**
 * 표시된 카드 JSON에서 상호명을 뽑는다. 후속 판정이 "화면에 이미 있는 곳을 묻는가"를
 * 결정적으로 알려면 필요하다.
 */
export function extractCardEntityNames(cardBlock: string | undefined): string[] {
    if (!cardBlock) return [];
    const match = cardBlock.trim().match(/^```json:[a-z]+\s*\n([\s\S]*?)\n```$/);
    if (!match) return [];
    try {
        const payload = JSON.parse(match[1]) as Record<string, unknown>;
        const names: string[] = [];
        for (const value of Object.values(payload)) {
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                const name = (item as { name?: unknown } | null)?.name;
                if (typeof name === 'string' && squash(name).length >= 2) names.push(name);
            }
        }
        return names;
    } catch {
        return [];
    }
}

/** 카드에서 특정 상호의 주소를 찾는다. 후속 진료시간 조회가 지역 코드를 복원하려면 필요하다. */
export function findCardEntityAddress(cardBlock: string | undefined, name: string): string {
    if (!cardBlock) return '';
    const match = cardBlock.trim().match(/^```json:[a-z]+\s*\n([\s\S]*?)\n```$/);
    if (!match) return '';
    try {
        const payload = JSON.parse(match[1]) as Record<string, unknown>;
        for (const value of Object.values(payload)) {
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                const entry = item as { name?: unknown; address?: unknown } | null;
                if (typeof entry?.name === 'string' && squash(entry.name) === squash(name)) {
                    return typeof entry.address === 'string' ? entry.address : '';
                }
            }
        }
        return '';
    } catch {
        return '';
    }
}

export function decideLocationCardFollowup(input: {
    text: string;
    llmFollowUp?: RouterFollowupDecision;
    currentIntentMatches: boolean;
    cardNames?: string[];
}): CardFollowupDecision {
    const text = input.text.trim();
    if (CLEARLY_OTHER_DOMAIN.test(text)) return 'unrelated';
    // 요청 형태가 아닌 반응문("… 뿐이네. 여기로 가야겠다")은 카드 세부 표현을 품고 있어도 수락이다.
    // CARD_DETAIL이 영업 상태 표현까지 넓어지면서 이 구분을 앞으로 빼야 한다.
    if (ACKNOWLEDGEMENT.test(text) && !REQUEST_SHAPE.test(text)) return 'acknowledge';
    if (CARD_DETAIL.test(text)) return 'refine';
    // "다른 약국"·"새로"처럼 전환을 명시하면 대상이 없어도 새 조회다.
    if (EXPLICIT_NEW.test(text) && REQUEST_SHAPE.test(text)) return 'new';
    // 🔴 조회 동사(검색·찾아)만으로 새 조회로 보면 안 된다. 실측(2026-08-24): 병원 카드가 떠 있는데
    //    `검색해서 찾아볼 수 있음?`이 새 조회로 빠져 같은 병원 카드를 다시 그렸다. 새 지역·새 대상이
    //    언급됐을 때만 새 조회이고, 대상 없는 요청은 화면 카드에 대한 후속이다.
    if (NEW_LOOKUP.test(text) && REQUEST_SHAPE.test(text) && AREA_TOKEN.test(text)) return 'new';
    // 화면 카드에 있는 상호를 지목했으면 새 조회가 아니다. 실측(2026-08-23): "우리들 약국은
    // 아직 열려있겠네?"가 어떤 규칙에도 안 걸려 라우터 LLM 판정으로 떨어졌고, 그게 'new'로
    // 나온 턴에서 pharmacy_search가 재호출돼 0건 → 빈 카드가 나왔다(모델이 아니라 경로가
    // 비결정적이었다). 카드에 이미 있는 이름은 결정적 근거이므로 여기서 고정한다.
    const squashedText = squash(text);
    if (input.cardNames?.some((name) => squashedText.includes(squash(name)))) return 'refine';
    if (ACKNOWLEDGEMENT.test(text)) return 'acknowledge';
    // 새 조회 대상 = 새 지역이거나, 화면 카드에 없는 상호. 둘 다 없으면 대상은 여전히 이 카드다.
    const mentionsUnknownFacility = (text.match(FACILITY_NAME) ?? [])
        .some(name => !(input.cardNames ?? []).some(known => squash(known).includes(squash(name))));
    const looksLikeNewTarget = AREA_TOKEN.test(text) || EXPLICIT_NEW.test(text) || mentionsUnknownFacility;

    // 🔴 라우터 LLM의 'new'도 대상이 있을 때만 받는다. 실측(2026-08-23): 대상 없는 발화가 LLM 판정
    //    'new'로 넘어가 재조회 0건 → 빈 카드가 됐고, 같은 문장이 모델에 따라 뒤집혔다.
    if (input.llmFollowUp === 'new' && looksLikeNewTarget) return 'new';
    if (input.llmFollowUp === 'refine') return 'refine';
    if (input.llmFollowUp === 'unrelated') return 'unrelated';
    // 카드가 떠 있는데 새 대상이 없으면 재조회보다 카드 후속이 안전하다.
    if (!looksLikeNewTarget) return 'refine';
    return input.currentIntentMatches ? 'new' : 'unrelated';
}

const LAW_EXPLANATION = /(설명|요약|쉽게|뜻|의미|시나리오|사례|예시|비교|적용|해석|왜|어떻게)/i;
const LAW_ADDITIONAL_LOOKUP = /(처벌|벌금|형량|과태료|면허\s*(취소|정지)|판례|헌재|예외|다른\s*조문|관련\s*조문)/i;
const LAW_RAW_LOOKUP = /(원문|전문|조문\s*(보여|조회)|제\s*\d+\s*조.*(보여|알려|조회)|법령\s*(목록|찾아|검색))/i;

export type LawInteractionDecision = 'lookup' | 'synthesize' | 'refine' | 'acknowledge';

export function decideLawInteraction(textValue: string, cardShown: boolean): LawInteractionDecision {
    const text = textValue.trim();
    if (LAW_ADDITIONAL_LOOKUP.test(text)) return 'synthesize';
    if (LAW_EXPLANATION.test(text)) return cardShown ? 'refine' : 'synthesize';
    if (LAW_RAW_LOOKUP.test(text)) return 'lookup';
    if (cardShown && ACKNOWLEDGEMENT.test(text)) return 'acknowledge';
    return 'lookup';
}

/**
 * 약국 사실 블록의 라벨. 실측(2026-08-23): GPT-5.4 mini가 이 블록을 그대로 인용해
 * 사용자에게 "is_open_now=true인 약국은 …"을 노출했다. 그래서 라벨에서 내부 필드명을
 * 없앴는데, 그러면 이번엔 **응답 언어**를 따라가야 한다 — 모델이 통째로 베낄 수 있는
 * 데이터이므로 English 세션에 한국어 라벨이 새어 나오면 같은 종류의 결함이 된다.
 * 지시문이 아니라 인용될 수 있는 값이라서 langName으로 분기한다.
 */
const PHARMACY_FACT_LABELS: Record<LangName, {
    title: string; checkedAt: string; openNow: string; closedNow: string; unknown: string;
    unit: string; none: string; fallbackTime: string; priority: string; distance: string;
}> = {
    Korean: {
        title: '약국 영업 상태 — 조회 시점 확정값, 이 값이 정답입니다',
        checkedAt: '상태 확인 시각', openNow: '지금 영업 중', closedNow: '지금 영업 종료',
        unknown: '상태 확인 불가', unit: '곳', none: '없음', fallbackTime: '카드 조회 시점',
        priority: '위 영업 중/영업 종료 구분이 현재 상태의 최우선 근거입니다. 카드에 적힌 영업시간은 예정 시간일 뿐 지금 문을 열었다는 증거가 아닙니다.',
        distance: "카드에는 사용자 위치 좌표와 각 약국까지의 거리가 없으므로 정확한 '가장 가까운 약국'은 확정할 수 없습니다.",
    },
    English: {
        title: 'Pharmacy open status — confirmed at lookup time, these values are authoritative',
        checkedAt: 'Status checked at', openNow: 'Open now', closedNow: 'Closed now',
        unknown: 'Status unavailable', unit: '', none: 'none', fallbackTime: 'the time of the lookup',
        priority: 'The open/closed split above is the authoritative basis for current status. The opening hours shown on the card are the scheduled hours only, not evidence that a pharmacy is open right now.',
        distance: 'The card has no user coordinates or distances, so the "nearest pharmacy" cannot be determined.',
    },
    Spanish: {
        title: 'Estado de apertura de farmacias — confirmado en el momento de la consulta, estos valores son los correctos',
        checkedAt: 'Estado verificado a las', openNow: 'Abiertas ahora', closedNow: 'Cerradas ahora',
        unknown: 'Estado no disponible', unit: '', none: 'ninguna', fallbackTime: 'el momento de la consulta',
        priority: 'La división abiertas/cerradas anterior es la base autorizada del estado actual. El horario que figura en la tarjeta es solo el horario previsto, no prueba de que esté abierta ahora.',
        distance: 'La tarjeta no incluye la ubicación del usuario ni distancias, por lo que no se puede determinar la "farmacia más cercana".',
    },
    French: {
        title: "Statut d'ouverture des pharmacies — confirmé au moment de la recherche, ces valeurs font foi",
        checkedAt: 'Statut vérifié à', openNow: 'Ouvertes maintenant', closedNow: 'Fermées maintenant',
        unknown: 'Statut indisponible', unit: '', none: 'aucune', fallbackTime: 'le moment de la recherche',
        priority: "La répartition ouvertes/fermées ci-dessus fait foi pour le statut actuel. Les horaires affichés sur la carte sont les horaires prévus, pas la preuve qu'une pharmacie est ouverte en ce moment.",
        distance: "La carte ne contient ni la position de l'utilisateur ni les distances : la « pharmacie la plus proche » ne peut donc pas être déterminée.",
    },
};

/**
 * 카드 후속 답변에서 모델이 영업시간 문자열을 현재 상태로 오해하지 않도록,
 * 서버가 구조화 데이터의 boolean 상태를 짧은 사실 블록으로 고정한다.
 */
export function buildCardFollowupFacts(kind: string, cardBlock: string, langName: LangName = DEFAULT_LANG_NAME): string {
    if (kind !== 'pharmacy') return '';
    const match = cardBlock.trim().match(/^```json:pharmacy\s*\n([\s\S]*?)\n```$/);
    if (!match) return '';

    try {
        const payload = JSON.parse(match[1]) as {
            checked_at?: string;
            pharmacies?: Array<{ name?: string; is_open_now?: boolean }>;
        };
        const pharmacies = Array.isArray(payload.pharmacies) ? payload.pharmacies : [];
        const open = pharmacies.filter((item) => item.is_open_now === true);
        const closed = pharmacies.filter((item) => item.is_open_now === false);
        const unknown = pharmacies.length - open.length - closed.length;
        const t = pickByLang(PHARMACY_FACT_LABELS, langName);
        const names = (items: typeof pharmacies) => items.map((item) => item.name).filter(Boolean).join(', ') || t.none;
        const count = (n: number) => `${n}${t.unit}`;

        return `[${t.title}]\n`
            + `- ${t.checkedAt}: ${payload.checked_at || t.fallbackTime}\n`
            + `- ${t.openNow}: ${count(open.length)} (${names(open)})\n`
            + `- ${t.closedNow}: ${count(closed.length)} (${names(closed)})\n`
            + `- ${t.unknown}: ${count(unknown)}\n`
            + `- ${t.priority}\n`
            + `- ${t.distance}`;
    } catch {
        return '';
    }
}
