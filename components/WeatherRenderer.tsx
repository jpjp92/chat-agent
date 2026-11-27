'use client';
import React from 'react';
import { COND_LABEL } from '../lib/weather-labels';

/**
 * 날씨 카드 렌더러 — weatherTool의 json:weather(언어 중립 구조)를 받아 렌더.
 * i18n(라벨·상태문구·요일)은 전부 이 클라이언트에서 language prop으로 매핑(OWM lang 불필요).
 * 디자인: 모바일 우선 정리(11-26) — 머리에 출처·시각, 기온 48px + 큰 아이콘, 지표 인라인 3열, 예보 5칸(최고/최저 세로).
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


const T: Record<Lang, Record<string, string>> = {
  ko: { humidity: '습도', wind: '풍속', clouds: '구름', chance: '강수확률', today: '오늘', feels: '체감', hi: '최고', lo: '최저', now: '현재', expected: '오늘 예상', kmaName: '기상청', observed: '관측', popHint: '강수확률 %', daysTitle: '{n}일 예보', rainNow: '지금 비가 내리고 있어요', snowNow: '지금 눈이 내리고 있어요', rainExp: '곧 비 예보 · 우산 챙기세요', snowExp: '곧 눈 예보 · 대비하세요', notFound: '도시를 찾지 못했어요', fetchFail: '날씨 정보를 불러오지 못했어요' },
  en: { humidity: 'Humidity', wind: 'Wind', clouds: 'Clouds', chance: 'Chance', today: 'Today', feels: 'Feels', hi: 'H', lo: 'L', now: 'Now', expected: 'Expected', kmaName: 'KMA', observed: 'Obs.', popHint: 'Rain chance %', daysTitle: '{n}-day forecast', rainNow: "It's raining now", snowNow: "It's snowing now", rainExp: 'Rain expected · bring an umbrella', snowExp: 'Snow expected · be prepared', notFound: "Couldn't find that city", fetchFail: "Couldn't load the weather" },
  es: { humidity: 'Humedad', wind: 'Viento', clouds: 'Nubes', chance: 'Prob.', today: 'Hoy', feels: 'Sens.', hi: 'Máx', lo: 'Mín', now: 'Ahora', expected: 'Previsto', kmaName: 'KMA', observed: 'Obs.', popHint: 'Prob. lluvia %', daysTitle: 'Pronóstico {n} días', rainNow: 'Está lloviendo ahora', snowNow: 'Está nevando ahora', rainExp: 'Se espera lluvia · lleva paraguas', snowExp: 'Se espera nieve · prepárate', notFound: 'No se encontró la ciudad', fetchFail: 'No se pudo cargar el clima' },
  fr: { humidity: 'Humidité', wind: 'Vent', clouds: 'Nuages', chance: 'Prob.', today: "Auj.", feels: 'Ress.', hi: 'Max', lo: 'Min', now: 'Actuel', expected: 'Prévu', kmaName: 'KMA', observed: 'Obs.', popHint: 'Prob. pluie %', daysTitle: 'Prévisions {n} j', rainNow: 'Il pleut maintenant', snowNow: 'Il neige maintenant', rainExp: 'Pluie prévue · prends un parapluie', snowExp: 'Neige prévue · sois prêt', notFound: 'Ville introuvable', fetchFail: 'Impossible de charger la météo' },
};

const LOCALE: Record<Lang, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };

const isSnowy = (c: Condition) => c === 'snow' || c === 'flurry' || c === 'rainSnow';
const isPrecip = (c: Condition) =>
  c === 'rain' || c === 'shower' || c === 'drizzle' || c === 'thunder' || isSnowy(c);

// 하늘 그라디언트(네이비 팔레트): 맑은 낮=하늘색 / 밤(현지 18~6시)=인디고 / 흐림·안개=회색 / 강수=짙은 파랑
function skyClass(c: Condition, night: boolean): string {
  if (isPrecip(c)) {
    return 'bg-[linear-gradient(to_bottom,rgba(71,105,170,.55)_0%,rgba(71,105,170,.18)_46%,transparent_100%)] '
      + 'dark:bg-[linear-gradient(to_bottom,rgba(59,92,160,.55)_0%,rgba(45,70,125,.20)_46%,transparent_100%)]';
  }
  if (c === 'overcast' || c === 'cloudy' || c === 'fog') {
    return 'bg-[linear-gradient(to_bottom,rgba(148,163,184,.42)_0%,rgba(148,163,184,.16)_46%,transparent_100%)] '
      + 'dark:bg-[linear-gradient(to_bottom,rgba(100,116,139,.40)_0%,rgba(71,85,105,.14)_46%,transparent_100%)]';
  }
  if (night) {
    return 'bg-[linear-gradient(to_bottom,rgba(99,102,241,.32)_0%,rgba(79,70,229,.10)_46%,transparent_100%)] '
      + 'dark:bg-[linear-gradient(to_bottom,rgba(79,70,229,.42)_0%,rgba(55,48,163,.14)_46%,transparent_100%)]';
  }
  return 'bg-[linear-gradient(to_bottom,rgba(56,189,248,.40)_0%,rgba(125,211,252,.14)_46%,transparent_100%)] '
    + 'dark:bg-[linear-gradient(to_bottom,rgba(56,149,220,.45)_0%,rgba(37,99,165,.14)_46%,transparent_100%)]';
}

/** 도시 현지 시각 기준 밤(18~6시) — updatedAt + timezoneOffsetSec */
function isNightAt(iso: string, tzOffsetSec: number): boolean {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const h = new Date(t + tzOffsetSec * 1000).getUTCHours();
  return h >= 18 || h < 6;
}

// epoch(ms) → 도시 로컬 tz 기준 HH:MM (뷰어 tz 무관)
function localHm(iso: string, tzOffsetSec: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + tzOffsetSec * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
// 도시 로컬 '오늘' YYYY-MM-DD — 카드를 만든 시각 기준: 지금 시각이면 지난 대화의 카드를 다음 날 열 때 첫날이 '오늘' 이 아니게 된다
function localYmd(baseIso: string, tzOffsetSec: number): string {
  const base = new Date(baseIso).getTime();
  const d = new Date((Number.isFinite(base) ? base : Date.now()) + tzOffsetSec * 1000);
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
      <div className="w-full sm:max-w-[520px] my-3 rounded-[22px] border border-[#e2e8f0] dark:border-white/[0.07] bg-white dark:bg-[#0e162a] px-5 py-4 flex items-center gap-3">
        <span className="text-xl">🌫️</span>
        <div>
          <div className="text-sm font-bold text-[#0f172a] dark:text-[#f1f5f9]">{msg}</div>
          {e.input && <div className="text-xs text-[#64748b] dark:text-[#94a3b8] mt-0.5">“{e.input}”</div>}
        </div>
      </div>
    );
  }

  const w = data as WeatherData;
  const c = w.current;
  const isKma = w.source === 'KMA';
  const precipState = c.precip.state;
  const snowy = isSnowy(c.condition);
  const todayYmd = localYmd(w.updatedAt, w.timezoneOffsetSec);

  const precipSub = precipState === 'now'
    ? (snowy ? tt.snowNow : tt.rainNow)
    : (snowy ? tt.snowExp : tt.rainExp);
  const days = w.daily.slice(0, 5);
  const muted = 'text-[#64748b] dark:text-[#94a3b8]';
  const strong = 'text-[#0f172a] dark:text-[#f1f5f9]';

  // 모바일 기준 레이아웃(11-26): 폭 100%·패딩 16px·기온 48px·지표 인라인 1줄·예보 5칸 ~110px — 카드 높이 ~450px.
  // 출처·갱신 시각은 머리로 올려 푸터를 없앴다(전엔 배지 + 푸터 + 예보 머리 세 곳에 출처가 있었다).
  return (
    <div className="w-full sm:max-w-[520px] my-3 font-[Inter,system-ui,sans-serif]">
      <div className="relative rounded-[22px] overflow-hidden border border-[#e2e8f0] dark:border-white/[0.07] bg-white dark:bg-[#0e162a] shadow-[0_1px_2px_rgba(15,23,42,.05),0_10px_28px_-12px_rgba(15,23,42,.16)] dark:shadow-[0_10px_32px_-14px_rgba(0,0,0,.7)]">
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-[150px] ${skyClass(c.condition, isNightAt(w.updatedAt, w.timezoneOffsetSec))}`} />

        <div className="relative p-4 sm:p-5">
          {/* 머리: 위치 · 출처·갱신 시각 */}
          <div className="flex justify-between items-center gap-3">
            <div className={`flex items-center gap-1.5 min-w-0 text-[16px] font-bold ${strong}`}>
              <i className="fa-solid fa-location-dot text-[#6366f1] dark:text-[#a5b4fc] text-[14px]" aria-hidden />
              <span className="truncate">{w.location.name}{w.location.country && w.location.country !== 'KR' ? `, ${w.location.country}` : ''}</span>
            </div>
            <span className={`shrink-0 text-[12px] font-semibold ${muted} tabular-nums`}>
              {/* 관측 시각 — 카드를 만든 시각(updatedAt)을 쓰면 실제 관측보다 늦은 시각이 관측처럼 보였다 */}
              {isKma ? tt.kmaName : 'OpenWeather'} · {tt.observed} {localHm(c.observedAt || w.updatedAt, w.timezoneOffsetSec)}
            </span>
          </div>

          {/* 기온·상태 + 큰 아이콘 */}
          <div className="flex items-center justify-between gap-3 mt-2 sm:mt-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-1">
                <span className={`text-[40px] sm:text-[48px] font-black tracking-[-.04em] tabular-nums leading-none ${strong}`}>{c.temp}°</span>
                <span className="text-[18px] font-bold text-[#94a3b8] dark:text-[#7c8aa5]">C</span>
              </div>
              <div className={`text-[16px] font-bold mt-1 sm:mt-1.5 ${strong}`}>{COND_LABEL[c.condition]?.[lang] ?? ''}</div>
              <div className={`text-[13px] font-medium mt-0.5 ${muted} tabular-nums`}>
                {tt.feels} {c.feelsLike}° · {tt.hi} {c.maxTemp}° / {tt.lo} {c.minTemp}°
              </div>
            </div>
            <div className="shrink-0 text-[36px] sm:text-[44px] leading-none" aria-hidden>{GLYPH[c.condition]}</div>
          </div>

          {/* 강수 안내(비·눈이 있을 때만) */}
          {precipState !== 'none' && (
            <div className="mt-2 sm:mt-3 flex items-center gap-2.5 px-3 py-2 sm:py-2.5 rounded-xl border border-[#e2e8f0] dark:border-[#a5b4fc]/15 bg-[#a5b4fc]/[.08]">
              <span className="text-[15px]" aria-hidden>{snowy ? '🌨️' : '🌧️'}</span>
              <span className={`flex-1 min-w-0 text-[13px] font-semibold truncate ${strong}`}>
                {c.precip.mm}mm · {precipState === 'now' ? tt.now : tt.expected}
                <span className={`ml-1.5 font-medium ${muted}`}>{precipSub}</span>
              </span>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-[#0284c7] dark:text-[#7dd3fc]">{c.precip.pop}%</span>
            </div>
          )}

          {/* 지표: 인라인 3열 */}
          <div className={`grid grid-cols-3 gap-2 mt-2.5 py-2 sm:mt-3 sm:py-3 border-y border-[#e2e8f0] dark:border-white/[0.07] text-[13px] ${strong}`}>
            {[
              { icon: 'fa-droplet', l: tt.humidity, v: `${c.humidity}%` },
              { icon: 'fa-wind', l: tt.wind, v: `${c.windSpeed}m/s` },
              { icon: 'fa-cloud', l: tt.clouds, v: `${c.clouds}%` },
            ].map((s, i) => (
              <div key={i} className={`flex items-center gap-1.5 min-w-0 ${i === 1 ? 'justify-center' : i === 2 ? 'justify-end' : ''}`}>
                <i className={`fa-solid ${s.icon} text-[12px] text-[#0284c7] dark:text-[#7dd3fc]`} aria-hidden />
                <span className={`${muted} whitespace-nowrap`}>{s.l}</span>
                <span className="font-bold tabular-nums whitespace-nowrap">{s.v}</span>
              </div>
            ))}
          </div>

          {/* 5일 예보 */}
          {days.length > 0 && (
            <>
              {/* % 만 있으면 습도·구름으로 읽힌다 — 무엇인지 제목 줄에 밝힌다 */}
              <div className="mt-2.5 mb-1.5 sm:mt-3 sm:mb-2 flex items-baseline justify-between gap-2">
                <span className={`text-[15px] font-bold ${strong}`}>{tt.daysTitle.replace('{n}', String(days.length))}</span>
                <span className="text-[11.5px] font-semibold text-[#0284c7] dark:text-[#7dd3fc] whitespace-nowrap">{tt.popHint}</span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                {days.map((d, i) => {
                  const today = d.date === todayYmd;
                  return (
                    <div key={d.date + i} className={`flex flex-col items-center gap-0.5 sm:gap-1 py-1.5 sm:py-2.5 rounded-xl text-center border tabular-nums ${
                      today
                        ? 'border-[#a5b4fc]/45 bg-[#a5b4fc]/[.09]'
                        : 'border-transparent bg-[#f1f5f9] dark:bg-white/[0.04]'
                    }`}>
                      <div className={`text-[12px] font-semibold ${today ? strong : muted}`}>{today ? tt.today : weekdayLabel(d.date, LOCALE[lang])}</div>
                      <div className="text-[20px] sm:text-[22px] leading-none sm:my-0.5" aria-hidden>{GLYPH[d.condition]}</div>
                      {/* 최고·최저 한 줄 — 칸마다 한 줄이 빠져 모바일 높이가 가장 많이 준다 */}
                      <div className="whitespace-nowrap"><span className={`text-[14px] font-bold ${strong}`}>{d.maxTemp}°</span> <span className={`text-[12px] ${muted}`}>{d.minTemp}°</span></div>
                      <div className="text-[11.5px] font-semibold text-[#0284c7] dark:text-[#7dd3fc]">{d.pop}%</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
