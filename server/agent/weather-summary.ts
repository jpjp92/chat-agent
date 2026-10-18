/**
 * 날씨 카드 위 한 줄 설명 — 카드 JSON 에서 서버가 직접 만든다(모델 호출 없음). 검증: `npx tsx tests/test-weather-summary.mts`
 *
 * 날씨는 fast-pass(카드를 모델 합성 없이 바로 보냄)라 산문이 없다 — 카드만 뜨면 질문에 답하지 않은 것처럼 보인다.
 *  · 모델에게 요약을 시키지 않는다 — 지연·비용이 붙고 수치를 잘못 옮길 수 있다. 카드와 같은 데이터로 만들면 항상 일치한다.
 *  · 조언(우산 등)은 넣지 않는다 — 묻지 않은 질문에 답하게 된다. 카드에 있는 사실만 한 문장으로 옮긴다.
 *  · 상태 표기는 카드와 같은 표(lib/weather-labels.ts)를 쓴다.
 * 오류 카드·형식이 다른 블록은 빈 문자열 → 아무것도 붙이지 않는다.
 */
import { COND_LABEL, type WeatherConditionCode, type WeatherLang } from '../../lib/weather-labels';

const TEMPLATES: Record<WeatherLang, { now: string; nowNoCond: string; today: string }> = {
    ko: { now: '{city}은 현재 {cond} {temp}°입니다.', nowNoCond: '{city}은 현재 {temp}°입니다.', today: '오늘 기온은 {min}~{max}°, 강수확률은 {pop}%입니다.' },
    en: { now: '{city} is {cond} at {temp}° right now.', nowNoCond: '{city} is {temp}° right now.', today: 'Today: {min}–{max}°, {pop}% chance of precipitation.' },
    es: { now: 'En {city} ahora: {cond}, {temp}°.', nowNoCond: 'En {city} ahora: {temp}°.', today: 'Hoy: {min}–{max}°, {pop}% de probabilidad de precipitación.' },
    fr: { now: 'À {city} actuellement : {cond}, {temp}°.', nowNoCond: 'À {city} actuellement : {temp}°.', today: "Aujourd'hui : {min}–{max}°, {pop} % de risque de précipitations." },
};

/**
 * 한국어는 상태 이름(명사형)을 문장에 넣으면 "현재 맑음, 16°입니다" 처럼 어색하다 → 연결형으로 잇는다("맑고 16°").
 * 카드 표기(COND_LABEL)와 같은 상태를 가리키도록 코드별로 둔다.
 */
const KO_CONNECTIVE: Record<Exclude<WeatherConditionCode, 'unknown'>, string> = {
    clear: '맑고', mostlyClear: '대체로 맑고', partlyCloudy: '구름이 조금 있고', cloudy: '구름이 많고', overcast: '흐리고',
    rain: '비가 오고', shower: '소나기가 내리고', drizzle: '이슬비가 내리고', thunder: '뇌우가 치고',
    snow: '눈이 오고', rainSnow: '비나 눈이 오고', flurry: '진눈깨비가 내리고', fog: '안개가 끼고',
};

/** 영어도 같은 문제 — 명사 표기를 그대로 넣으면 "Seoul is rain at 14°" 가 된다. "is ___" 에 맞는 서술형으로 둔다. */
const EN_PHRASE: Record<Exclude<WeatherConditionCode, 'unknown'>, string> = {
    clear: 'clear', mostlyClear: 'mostly clear', partlyCloudy: 'partly cloudy', cloudy: 'cloudy', overcast: 'overcast',
    rain: 'rainy', shower: 'showery', drizzle: 'drizzly', thunder: 'stormy',
    snow: 'snowy', rainSnow: 'wet with rain and snow', flurry: 'seeing flurries', fog: 'foggy',
};

/** 한국어 조사 — 받침이 있으면 "은", 없으면 "는"(서울은 / 부산은 / 도쿄는). 한글이 아니면 "은(는)" 대신 "는". */
const koTopic = (name: string): string => {
    const last = name.trim().slice(-1);
    const code = last.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? '은' : '는';
    return '는';
};

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);

export const weatherSummaryLine = (data: any, lang: WeatherLang = 'ko'): string => {
    if (!data || data.error || !data.location?.name || !data.current) return '';
    const temp = num(data.current.temp);
    if (temp === null) return '';
    const t = TEMPLATES[lang] ?? TEMPLATES.ko;
    const city = String(data.location.name);
    const code = data.current.condition as WeatherConditionCode;
    const label = code && code !== 'unknown' ? COND_LABEL[code]?.[lang] : undefined;
    // 한국어는 연결형(맑고), 영어는 서술형(rainy), es/fr 는 "상태, 기온" 나열이라 카드 표기를 소문자로.
    const known = code as Exclude<WeatherConditionCode, 'unknown'>;
    const cond = !label ? undefined
        : lang === 'ko' ? KO_CONNECTIVE[known]
        : lang === 'en' ? EN_PHRASE[known]
        : label.charAt(0).toLowerCase() + label.slice(1);

    let now = fill(cond ? t.now : t.nowNoCond, { city, cond: cond ?? '', temp });
    if (lang === 'ko') now = now.replace(`${city}은`, `${city}${koTopic(city)}`);

    const d = Array.isArray(data.daily) ? data.daily[0] : undefined;
    const min = num(d?.minTemp), max = num(d?.maxTemp), pop = num(d?.pop);
    const today = min !== null && max !== null && pop !== null ? fill(t.today, { min, max, pop }) : '';
    return today ? `${now} ${today}` : now;
};

/**
 * 도구 출력의 json:weather 블록들 → 각 카드 **바로 위**에 그 도시의 한 줄을 둔 텍스트.
 * 카드 아래 끝에 몰아 두면 여러 도시일 때 문장과 카드가 떨어진다. 문장 → 카드 순서로 짝짓는다.
 * 오류 카드·깨진 블록은 문장 없이 카드만.
 */
export const interleaveWeatherSummaries = (blocks: string[], lang: WeatherLang = 'ko'): string =>
    blocks.map(b => {
        let line = '';
        try { line = weatherSummaryLine(JSON.parse(b.replace(/^```json:weather\n/, '').replace(/\n```$/, '')), lang); } catch { /* 카드만 */ }
        return line ? `${line}\n\n${b}` : b;
    }).join('\n\n');
