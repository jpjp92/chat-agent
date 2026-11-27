/**
 * 날씨 카드 뒤 짧은 답의 순수 부분 — fast-pass 판정·프롬프트(호출은 weather-answer.ts).
 * 키·모델 설정(server-only)을 끌어오지 않아야 하니스가 그대로 임포트한다.
 */
import { weatherSummaryLine } from './weather-summary';
import type { WeatherLang } from '../../lib/weather-labels';

const BLOCK = /```json:weather\n([\s\S]*?)\n```/g;

/**
 * 응답 본문이 fast-pass(카드 + 템플릿 한 줄)뿐이면 카드 데이터들, 모델 산문이 이미 있으면 null.
 * 오류 카드만 있으면 null — 답할 근거가 없다.
 */
export function fastPassWeatherCards(fullResponse: string, lang: WeatherLang): any[] | null {
    const cards: any[] = [];
    for (const m of fullResponse.matchAll(BLOCK)) {
        try { cards.push(JSON.parse(m[1])); } catch { /* 깨진 블록은 근거에서 뺀다 */ }
    }
    const usable = cards.filter(c => c && !c.error && c.current);
    if (!usable.length) return null;
    let rest = fullResponse.replace(BLOCK, '');
    for (const c of cards) { const line = weatherSummaryLine(c, lang); if (line) rest = rest.replace(line, ''); }
    return rest.trim() ? null : usable;
}

const LANG_NAME: Record<WeatherLang, string> = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
const LOCALE: Record<WeatherLang, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };

// 근거를 댈 때 한 번 밝히는 출처 이름 — 카드 배지(KMA/OpenWeather)와 같은 출처를 사용자 언어로
const SOURCE_NAME: Record<string, Record<WeatherLang, string>> = {
    KMA: { ko: '기상청', en: 'KMA', es: 'la KMA', fr: 'le KMA' },
    OpenWeather: { ko: 'OpenWeather', en: 'OpenWeather', es: 'OpenWeather', fr: 'OpenWeather' },
};

/**
 * 모델에 넘길 카드 요약. 요일은 미리 붙인다(날짜 → 요일 계산을 틀리지 않게).
 * 관측(지금)과 예보(오늘 하루 대표)를 이름부터 가른다 — 같은 `condition` 이면 "지금 구름 많고" 처럼 섞였다(DEV_261125 §11-4).
 */
function compactCard(c: any, lang: WeatherLang) {
    const wd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: 'short', timeZone: 'UTC' });
    return {
        city: c.location?.name,
        source: SOURCE_NAME[c.source]?.[lang] ?? c.source,
        observedNow: { temp: c.current?.temp, feelsLike: c.current?.feelsLike, condition: c.current?.condition, humidity: c.current?.humidity, windMs: c.current?.windSpeed },
        // 오늘 칸의 하늘 상태는 뺀다 — 이름을 갈라도 "지금은 구름이 많지만"(관측은 맑음)이 2건 남았다(§11-6). 지금 하늘은 관측값 하나만 둔다.
        dailyForecast: (c.daily ?? []).map((d: any, i: number) => ({ date: d.date, weekday: wd(d.date), ...(i === 0 ? {} : { condition: d.condition }), min: d.minTemp, max: d.maxTemp, popPct: d.pop, rainMm: d.rainMm, snowMm: d.snowMm })),
    };
}

export function buildWeatherAnswerPrompt(question: string, cards: any[], lang: WeatherLang, today: string): string {
    // 짧게 유지한다 — 규칙마다 실측 근거가 있다(DEV_261125 §11-4·6). 빠진 정보는 모델이 말하지 않고 `lookup` 으로만 낸다:
    // "나와 있지 않아"·"제공된 예보에는" 을 금지·예시로 막아도 질문이 바뀌면 다시 나왔다(DEV_261127) → "찾아볼까요?" 는 서버가 붙인다.
    return `The user sees a weather card (5-day forecast, one value per day, no hourly) with a summary line (now, today's range, precipitation chance).

User message: ${JSON.stringify(question)}
Today: ${today}
Weather data: ${JSON.stringify(cards.map(c => compactCard(c, lang)))}

Return JSON {"none": boolean, "answer": string, "lookup": string}.
- "none": true if the message only asks what the weather, temperature, or forecast is, for any day ("내일 날씨는?", "이번 주 날씨 알려줘") — the card answers it; do not add tips. The default is true. But a weather request plus a question ("날씨 어때? 우산 챙겨야 할까?") is false — answer the question part.
- "answer": otherwise, the reply to the question part (umbrella, clothes, going out, laundry, which day is best…) in ${LANG_NAME[lang]}, 1–2 short sentences, like a friend who just checked the forecast${lang === 'ko' ? ' — polite 해요체 (~요) throughout, never ~습니다' : ''}. Conclusion first, then at most two numbers as the reason; days as today/tomorrow/weekday. "Right now" = observedNow; today and later = dailyForecast. Only facts in the data, comparisons checked against the numbers — no normal years, averages, or past days. Values are per day: never say a time within a day (morning, evening, "오전부터"). Do not repeat the current temperature, today's range, or today's precipitation chance — the summary line shows them; say "low"/"high" instead of the number. Write any other number with symbols (60%, 16°), never spelled out. Usually no source; name it ("${SOURCE_NAME.KMA[lang]} 예보로는 …") at most once, only when a single number is the whole reason. Say only what the forecast supports — do not mention anything that is missing, the card, or the data. No markdown or emoji; do not restate the summary or add unasked advice.
- "lookup": only if the user explicitly asked about something this forecast does not have (hourly timing, fine dust, UV, other places), a short noun phrase in ${LANG_NAME[lang]} naming exactly what they asked ("미세먼지", "시간대별 강수", "자외선 지수"); otherwise "" — never offer something they did not ask about. The server adds the offer to look it up.`;
}

/** 서버가 붙이는 역질문 — 모델이 "없다" 를 설명할 자리를 없앤다 */
const OFFER: Record<WeatherLang, (x: string) => string> = {
    ko: x => `${x}도 찾아볼까요?`,
    en: x => `Want me to look up ${x}?`,
    es: x => `¿Busco ${x}?`,
    fr: x => `Je cherche ${x} ?`,
};

/**
 * "없다" 를 말하는 문장 — 할 말이 없을 때 모델이 answer 를 이것으로 채웠다(38건 중 6건, 프롬프트로 막히지 않음).
 * 그 문장만 뺀다. 빈 답이 되면 역질문만 남는다("자외선 지수도 찾아볼까요?").
 */
const MISSING: Record<WeatherLang, RegExp> = {
    ko: /나와 있지 않|알 수 없|확인할 수 없|확인하기 어렵|확인이 어렵|제공하지 않|정보(?:는|가)? 없|제공되지 않|제공된|가지고 있지 않|포함되(?:어 있)?지 않|예보에(?:는)? 없/,
    en: /not (?:available|included|provided|shown)|(?:don't|do not) have|no (?:information|data)|can't tell/i,
    es: /no (?:está|están) disponible|no (?:tengo|hay) (?:información|datos)/i,
    fr: /pas disponible|pas d'information|pas de données|n'est pas indiqu/i,
};
const dropMissing = (text: string, lang: WeatherLang) =>
    text.split(/(?<=[.!?。])\s+/).filter(x => !MISSING[lang].test(x)).join(' ').trim();

/**
 * 해요체로 맞춘다 — 프롬프트로 고정해도 22건 중 2건이 "~입니다"·"~겠습니다" 로 끝났다(DEV_261127).
 * 흔한 어미만 바꾼다: 활용이 불규칙한 동사까지 규칙으로 덮으면 틀린 말이 생긴다.
 */
const HAEYO: [RegExp, string | ((m: string, ...a: string[]) => string)][] = [
    [/겠습니다(?=[.!?]|$)/g, '겠어요'],
    [/있습니다(?=[.!?]|$)/g, '있어요'],
    [/없습니다(?=[.!?]|$)/g, '없어요'],
    [/됩니다(?=[.!?]|$)/g, '돼요'],
    [/%입니다(?=[.!?]|$)/g, '%예요'],  // "퍼센트" 로 읽혀 받침이 없다
    // 받침 있으면 "이에요", 없으면 "예요" — 숫자 뒤는 단위에 따라 읽는 소리가 달라 그대로 둔다
    [/([가-힣])입니다(?=[.!?]|$)/g, (_m, c) => `${c}${(c.charCodeAt(0) - 0xac00) % 28 ? '이에요' : '예요'}`],
];
const toHaeyo = (text: string) => HAEYO.reduce((t, [re, to]) => t.replace(re, to as any), text);

/** 모델 JSON → 붙일 답(없으면 ''). 깨진 JSON·none 은 '' — 카드와 한 줄은 이미 나갔다. */
export function composeWeatherAnswer(raw: string, lang: WeatherLang): string {
    let j: any;
    try { j = JSON.parse(raw); } catch { return ''; }
    if (!j || j.none === true) return '';
    const kept = typeof j.answer === 'string' ? dropMissing(j.answer.trim(), lang) : '';
    const answer = lang === 'ko' ? toHaeyo(kept) : kept;
    const lookup = typeof j.lookup === 'string' ? j.lookup.trim().slice(0, 40) : '';
    return [answer, lookup ? OFFER[lang](lookup) : ''].filter(Boolean).join(' ');
}

/**
 * 날씨 + 카드 밖 정보(미세먼지 등)를 함께 물은 턴 — 선택 모델이 그 부분만 검색해 답한다(PLAN_WEATHER_COMPOSITE_261125).
 * 날씨 수치는 카드 데이터가 정답이다: 통째로 검색하던 때 답이 오늘 최저 -4° 를 4° 로 옮겼다(3회 재현).
 */
export function buildWeatherExtraPrompt(question: string, cards: any[], lang: WeatherLang, today: string, extra: string): string {
    const cities = cards.map(c => c.location?.name).filter(Boolean).join(', ');
    return `A weather card for ${cities} is already shown to the user, with a one-line summary (current temperature and condition, today's range and precipitation chance).

User message: ${JSON.stringify(question)}
Today: ${today}
Weather data (authoritative): ${JSON.stringify(cards.map(c => compactCard(c, lang)))}

Search the web for: ${extra} in ${cities}, today. Then answer in ${LANG_NAME[lang]} in ONE short sentence — two only if the message also asks for a judgment that does not fit in one:
- Give the ${extra} level (e.g. 좋음/보통/나쁨, 낮음/보통/높음) and whose forecast it is. Leave out station readings, µg/m³ values, and announcement times unless the user asked for numbers.
- Do not state temperatures, precipitation chance, or sky condition — the card shows them. If a judgment needs them, take them ONLY from the weather data above, never from search results.
- If the message also asks for a judgment (mask, going out, umbrella, clothes), fold the answer into the same sentence when possible ("보통이라 마스크는 없어도 돼요").
- Prefer official sources (e.g. 에어코리아, 기상청). Do not tell the user to check another site themselves.
- No headings, lists, tables, or emoji.`;
}
