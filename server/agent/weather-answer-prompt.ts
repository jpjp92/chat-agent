/**
 * 날씨 카드 뒤 짧은 답의 순수 부분 — fast-pass 판정·프롬프트(호출은 weather-answer.ts).
 * 키·모델 설정(server-only)을 끌어오지 않아야 하니스가 그대로 임포트한다.
 */
import { weatherSummaryLine } from './weather-summary';
import type { WeatherLang } from '../../lib/weather-labels';

export const NONE = 'NONE';
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
    return `A weather card is already shown to the user, with a one-line summary right below it (current temperature and condition, today's range and precipitation chance). The card shows a 5-day forecast, one value per day — no hourly breakdown.

User message: ${JSON.stringify(question)}
Today: ${today}
Weather data: ${JSON.stringify(cards.map(c => compactCard(c, lang)))}

Step 1 — decide. The default is ${NONE}.
- Output exactly ${NONE} when the message only asks what the weather, temperature, or forecast is — for any day the card covers ("내일 날씨는?", "주말 날씨", "이번 주 날씨 알려줘", "기온 몇 도야?") — even if the forecast has rain or a big temperature swing. The card already answers it; do not add tips.
- Answer when any part of the message asks for something beyond reading the forecast: a judgment or advice (umbrella, clothes, laundry, going out, exercise, car wash), a comparison or "which day is best", or something the forecast does not have. A weather request plus such a question ("날씨 어때? 우산 챙겨야 할까?") is answered — reply to the question part.

Step 2 — answer (only if not ${NONE}):
- Otherwise answer that question in ${LANG_NAME[lang]}, in 1–2 short sentences, like a friend who just checked the forecast. Lead with the conclusion, then the reason with at most two numbers. Refer to days as today/tomorrow or by weekday.
- Name the source only when a forecast number is the whole reason, at most once, woven in naturally (e.g. "${SOURCE_NAME.KMA[lang]} 예보로는 …"). Most answers need no source.
- "Right now" comes from observedNow; today's outlook and later days come from dailyForecast. Do not mix them.
- State only facts present in the weather data, and check every comparison against the numbers (which day is warmer/colder). No comparisons with normal years, averages, past days, or anything not in the data.
- Never mention the card, the data, or what you have or lack — no "제공되지 않아", "정보가 없어", "가지고 있지 않은데".
- Do not restate the summary line, list every day, or add advice they did not ask for. No markdown, no emoji.
- If the question needs something this forecast does not have (fine dust, UV, hourly timing, other places), first give whatever conclusion the daily forecast supports, then end by offering to look it up — say what you would look up, not what is missing (e.g. "비는 금요일에 와요. 몇 시쯤 오는지 찾아볼까요?", "날은 맑아요. 미세먼지도 찾아볼까요?"). If the day they asked about has no rain, say which day does before offering. Do not tell them to check another site themselves.`;
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
