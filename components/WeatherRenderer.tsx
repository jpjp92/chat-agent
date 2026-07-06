'use client';
import React from 'react';

/**
 * 날씨 카드 렌더러 — weatherTool의 json:weather(언어 중립 구조)를 받아 렌더.
 * i18n(라벨·상태문구·요일)은 전부 이 클라이언트에서 language prop으로 매핑(OWM lang 불필요).
 * 디자인: preview/weather-card-sample.html 확정본(바이올렛 액센트·글래스·수직 하늘 그라디언트).
 */

type Lang = 'ko' | 'en' | 'es' | 'fr';

type Condition =
  | 'clear' | 'mostlyClear' | 'partlyCloudy' | 'cloudy' | 'overcast'
  | 'rain' | 'shower' | 'drizzle' | 'thunder'
  | 'snow' | 'rainSnow' | 'flurry' | 'fog' | 'unknown';

interface Daily {
  date: string; condition: Condition; minTemp: number; maxTemp: number; pop: number; rainMm: number; snowMm: number;
}
interface WeatherData {
  source: 'KMA' | 'OpenWeather';
  updatedAt: string;
  timezoneOffsetSec: number;
  location: { name: string; country: string };
  current: {
    temp: number; feelsLike: number; minTemp: number; maxTemp: number; humidity: number;
    pressure: number | null; windSpeed: number; windGust: number | null; clouds: number;
    visibilityKm: number | null; condition: Condition;
    precip: { state: 'now' | 'expected' | 'none'; mm: number; pop: number };
    observedAt: string;
  };
  daily: Daily[];
  forecastDays: number;
  notes?: any[];
}

const GLYPH: Record<Condition, string> = {
  clear: '☀️', mostlyClear: '🌤️', partlyCloudy: '⛅', cloudy: '🌥️', overcast: '☁️',
  rain: '🌧️', shower: '🌦️', drizzle: '🌦️', thunder: '⛈️',
  snow: '❄️', rainSnow: '🌨️', flurry: '🌨️', fog: '🌫️', unknown: '🌡️',
};

const COND_LABEL: Record<Condition, Record<Lang, string>> = {
  clear: { ko: '맑음', en: 'Clear', es: 'Despejado', fr: 'Dégagé' },
  mostlyClear: { ko: '대체로 맑음', en: 'Mostly clear', es: 'Mayormente despejado', fr: 'Plutôt dégagé' },
  partlyCloudy: { ko: '구름 조금', en: 'Partly cloudy', es: 'Parcialmente nublado', fr: 'Partiellement nuageux' },
  cloudy: { ko: '구름 많음', en: 'Cloudy', es: 'Nublado', fr: 'Nuageux' },
  overcast: { ko: '흐림', en: 'Overcast', es: 'Cubierto', fr: 'Couvert' },
  rain: { ko: '비', en: 'Rain', es: 'Lluvia', fr: 'Pluie' },
  shower: { ko: '소나기', en: 'Showers', es: 'Chubascos', fr: 'Averses' },
  drizzle: { ko: '이슬비', en: 'Drizzle', es: 'Llovizna', fr: 'Bruine' },
  thunder: { ko: '뇌우', en: 'Thunderstorm', es: 'Tormenta', fr: 'Orage' },
  snow: { ko: '눈', en: 'Snow', es: 'Nieve', fr: 'Neige' },
  rainSnow: { ko: '비/눈', en: 'Rain & snow', es: 'Aguanieve', fr: 'Pluie et neige' },
  flurry: { ko: '진눈깨비', en: 'Flurries', es: 'Nevisca', fr: 'Rafales de neige' },
  fog: { ko: '안개', en: 'Fog', es: 'Niebla', fr: 'Brouillard' },
  unknown: { ko: '정보 없음', en: 'No data', es: 'Sin datos', fr: 'Aucune donnée' },
};

const T: Record<Lang, Record<string, string>> = {
  ko: { humidity: '습도', wind: '풍속', clouds: '구름', chance: '강수확률', forecast: '예보', today: '오늘', updated: '업데이트', feels: '체감', now: '현재', expected: '오늘 예상', kmaFoot: '기상청 단기예보', rainNow: '지금 비가 내리고 있어요', snowNow: '지금 눈이 내리고 있어요', rainExp: '곧 비 예보 · 우산 챙기세요', snowExp: '곧 눈 예보 · 대비하세요', kmaDays: 'KMA +{n}일', notFound: '도시를 찾지 못했어요', fetchFail: '날씨 정보를 불러오지 못했어요' },
  en: { humidity: 'Humidity', wind: 'Wind', clouds: 'Clouds', chance: 'Chance', forecast: 'Forecast', today: 'Today', updated: 'Updated', feels: 'Feels', now: 'Now', expected: 'Expected', kmaFoot: 'KMA short-term', rainNow: "It's raining now", snowNow: "It's snowing now", rainExp: 'Rain expected · bring an umbrella', snowExp: 'Snow expected · be prepared', kmaDays: 'KMA +{n} days', notFound: "Couldn't find that city", fetchFail: "Couldn't load the weather" },
  es: { humidity: 'Humedad', wind: 'Viento', clouds: 'Nubes', chance: 'Prob.', forecast: 'Pronóstico', today: 'Hoy', updated: 'Actualizado', feels: 'Sens.', now: 'Ahora', expected: 'Previsto', kmaFoot: 'KMA corto plazo', rainNow: 'Está lloviendo ahora', snowNow: 'Está nevando ahora', rainExp: 'Se espera lluvia · lleva paraguas', snowExp: 'Se espera nieve · prepárate', kmaDays: 'KMA +{n} días', notFound: 'No se encontró la ciudad', fetchFail: 'No se pudo cargar el clima' },
  fr: { humidity: 'Humidité', wind: 'Vent', clouds: 'Nuages', chance: 'Prob.', forecast: 'Prévisions', today: "Auj.", updated: 'Màj', feels: 'Ress.', now: 'Actuel', expected: 'Prévu', kmaFoot: 'KMA court terme', rainNow: 'Il pleut maintenant', snowNow: 'Il neige maintenant', rainExp: 'Pluie prévue · prends un parapluie', snowExp: 'Neige prévue · sois prêt', kmaDays: 'KMA +{n} j', notFound: 'Ville introuvable', fetchFail: 'Impossible de charger la météo' },
};

const LOCALE: Record<Lang, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };

const isSnowy = (c: Condition) => c === 'snow' || c === 'flurry' || c === 'rainSnow';
const isPrecip = (c: Condition) =>
  c === 'rain' || c === 'shower' || c === 'drizzle' || c === 'thunder' || isSnowy(c);

// 하늘 그라디언트 카테고리: 강수=파랑 / 흐림·안개=회색 / 맑음=따뜻한 톤
function skyClass(c: Condition): string {
  if (isPrecip(c)) {
    return 'bg-[linear-gradient(to_bottom,rgba(109,131,179,.60)_0%,rgba(138,154,194,.24)_46%,transparent_100%)] '
      + 'dark:bg-[linear-gradient(to_bottom,rgba(96,120,175,.52)_0%,rgba(70,86,128,.20)_46%,transparent_100%)]';
  }
  if (c === 'overcast' || c === 'cloudy' || c === 'fog') {
    return 'bg-[linear-gradient(to_bottom,rgba(148,163,184,.42)_0%,rgba(148,163,184,.16)_46%,transparent_100%)] '
      + 'dark:bg-[linear-gradient(to_bottom,rgba(100,116,139,.36)_0%,rgba(71,85,105,.14)_46%,transparent_100%)]';
  }
  return 'bg-[linear-gradient(to_bottom,rgba(246,181,107,.55)_0%,rgba(243,208,138,.20)_46%,transparent_100%)] '
    + 'dark:bg-[linear-gradient(to_bottom,rgba(212,150,74,.46)_0%,rgba(150,110,60,.16)_46%,transparent_100%)]';
}

// epoch(ms) → 도시 로컬 tz 기준 HH:MM (뷰어 tz 무관)
function localHm(iso: string, tzOffsetSec: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + tzOffsetSec * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
// 도시 로컬 '오늘' YYYY-MM-DD
function localYmd(tzOffsetSec: number): string {
  const d = new Date(Date.now() + tzOffsetSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function weekdayLabel(date: string, locale: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d);
}

interface Props { data: WeatherData | { error: true; input?: string; code?: string }; language?: Lang }

export const WeatherRenderer: React.FC<Props> = ({ data, language = 'ko' }) => {
  const lang: Lang = (['ko', 'en', 'es', 'fr'].includes(language as string) ? language : 'ko') as Lang;
  const tt = T[lang];

  // 에러 카드 — 명시적 error 플래그 또는 필수 필드 결측(부분/깨진 데이터)
  const malformed = !(data as any)?.current || !Array.isArray((data as any)?.daily);
  if ((data as any)?.error || malformed) {
    const e = (data as any) as { input?: string; code?: string };
    const msg = e.code === 'CITY_NOT_FOUND' ? tt.notFound : tt.fetchFail;
    return (
      <div className="w-full max-w-[380px] sm:max-w-[540px] mx-auto my-3 rounded-[22px] border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-5 py-4 flex items-center gap-3">
        <span className="text-xl">🌫️</span>
        <div>
          <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{msg}</div>
          {e.input && <div className="text-xs text-slate-400 mt-0.5">“{e.input}”</div>}
        </div>
      </div>
    );
  }

  const w = data as WeatherData;
  const c = w.current;
  const isKma = w.source === 'KMA';
  const precipState = c.precip.state;
  const snowy = isSnowy(c.condition);
  const todayYmd = localYmd(w.timezoneOffsetSec);

  const precipSub = precipState === 'now'
    ? (snowy ? tt.snowNow : tt.rainNow)
    : (snowy ? tt.snowExp : tt.rainExp);
  const forecastNote = isKma ? tt.kmaDays.replace('{n}', String(w.forecastDays)) : 'OpenWeather';

  return (
    <div className="w-full max-w-[380px] sm:max-w-[540px] mx-auto my-3 font-[Inter,system-ui,sans-serif]">
      <div className="relative rounded-[26px] overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] shadow-[0_1px_2px_rgba(15,23,42,.04),0_12px_34px_-12px_rgba(15,23,42,.14)] dark:shadow-[0_12px_40px_-14px_rgba(0,0,0,.7)]">
        {/* 하늘 그라디언트 */}
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-[180px] ${skyClass(c.condition)}`} />

        <div className="relative p-[18px_20px_20px]">
          {/* 위치 + 출처 */}
          <div className="flex justify-between items-start gap-3">
            <div className="flex items-center gap-[7px] text-[14px] font-bold text-slate-900 dark:text-slate-100">
              <span className="opacity-85">📍</span>
              <span>{w.location.name}{w.location.country && w.location.country !== 'KR' ? `, ${w.location.country}` : ''}</span>
            </div>
            <span className={`text-[10.5px] font-extrabold tracking-wide px-2 py-[3px] rounded-full whitespace-nowrap border ${
              isKma
                ? 'text-blue-600 border-blue-500/30 bg-blue-500/10 dark:text-blue-300 dark:bg-blue-400/15 dark:border-blue-300/25'
                : 'text-slate-500 border-slate-200 bg-slate-100 dark:text-slate-400 dark:border-white/10 dark:bg-white/5'
            }`}>{w.source}</span>
          </div>

          {/* 온도 + 상태 */}
          <div className="flex items-baseline gap-1.5 mt-3.5">
            <span className="text-[56px] font-black tracking-[-.04em] tabular-nums leading-[.92] text-slate-900 dark:text-slate-100">{c.temp}</span>
            <span className="text-[22px] font-extrabold text-slate-400 dark:text-slate-500">°C</span>
          </div>
          <div className="text-[15px] font-bold mt-1.5 text-slate-800 dark:text-slate-200">
            {COND_LABEL[c.condition]?.[lang] ?? ''}
            <span className="text-slate-400 dark:text-slate-500 font-semibold text-[13px] ml-2">{tt.feels} {c.feelsLike}°</span>
          </div>

          {/* 강수 히어로 (없으면 생략) */}
          {precipState !== 'none' && (
            <div className="mt-4 flex items-center gap-3 px-[15px] py-[13px] rounded-2xl border border-slate-200 dark:border-white/10 bg-[linear-gradient(180deg,rgba(139,92,246,.07),rgba(139,92,246,.02))] dark:bg-[linear-gradient(180deg,rgba(139,92,246,.14),rgba(139,92,246,.04))]">
              <div className="w-[30px] h-[30px] shrink-0 grid place-items-center rounded-[9px] bg-violet-500/15 text-violet-500 text-[15px]">{snowy ? '🌨️' : '🌧️'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-extrabold tabular-nums tracking-[-.01em] text-slate-900 dark:text-slate-100">
                  {c.precip.mm}mm
                  <span className={`text-[10.5px] font-extrabold ml-1.5 px-1.5 py-0.5 rounded-md align-middle ${
                    precipState === 'now'
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
                      : 'bg-violet-500/15 text-violet-500'
                  }`}>{precipState === 'now' ? tt.now : tt.expected}</span>
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{precipSub}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{c.precip.pop}%</div>
                <div className="text-[10px] text-slate-400 font-bold">{tt.chance}</div>
              </div>
            </div>
          )}

          {/* 스탯 3칩 */}
          <div className="flex gap-2 mt-3.5">
            {[
              { l: tt.humidity, v: `${c.humidity}%` },
              { l: tt.wind, v: `${c.windSpeed}m/s` },
              { l: tt.clouds, v: `${c.clouds}%` },
            ].map((s, i) => (
              <div key={i} className="flex-1 py-2.5 px-1 rounded-[13px] text-center bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="text-[10.5px] text-slate-400 font-bold">{s.l}</div>
                <div className="text-[14px] font-extrabold mt-[3px] tabular-nums text-slate-800 dark:text-slate-200">{s.v}</div>
              </div>
            ))}
          </div>

          {/* 예보 스트립 */}
          {w.daily.length > 0 && (
            <>
              <div className="flex items-center justify-between mx-0.5 mt-[18px] mb-[9px]">
                <span className="text-[11px] font-extrabold text-slate-400 tracking-wide uppercase">{tt.forecast}</span>
                <span className="text-[10.5px] text-slate-400">{forecastNote}</span>
              </div>
              <div className="grid grid-flow-col auto-cols-fr gap-2">
                {w.daily.slice(0, 5).map((d, i) => {
                  const today = d.date === todayYmd;
                  return (
                    <div key={d.date + i} className={`py-[11px] px-1.5 rounded-[15px] text-center border ${
                      today
                        ? 'border-violet-500/40 bg-violet-500/[.06]'
                        : 'border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5'
                    }`}>
                      <div className="text-[11px] font-extrabold text-slate-400">{today ? tt.today : weekdayLabel(d.date, LOCALE[lang])}</div>
                      <div className="text-[20px] my-[5px_0_4px] leading-none">{GLYPH[d.condition]}</div>
                      <div className="text-[13px] font-extrabold tabular-nums text-slate-800 dark:text-slate-200">{d.maxTemp}°</div>
                      <div className="text-[11px] font-semibold text-slate-400 tabular-nums">{d.minTemp}°</div>
                      <div className="text-[10px] font-bold text-violet-500 mt-1 tabular-nums">{d.pop}%</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 푸터 */}
          <div className="flex items-center gap-2 mt-3.5 text-[11px] text-slate-400">
            <span>{tt.updated} {localHm(w.updatedAt, w.timezoneOffsetSec)}</span>
            <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60" />
            <span>{isKma ? tt.kmaFoot : 'OpenWeather'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherRenderer;
