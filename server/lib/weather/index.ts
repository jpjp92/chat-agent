/**
 * 날씨 코어 — KMA(기상청 API Hub) + OpenWeather 하이브리드.
 *
 * 설계(PLAN_WEATHER_TOOL_260706):
 *  - 격자좌표는 하드코딩 표 X → `dfsXyConv(lat,lon)` LCC 공식(전국 커버). geocoding은 1회.
 *  - 한국(country=KR) → KMA(실황+단기 2콜, 육상예보 생략), 실패 시 OpenWeather 폴백. 그 외 → OpenWeather.
 *  - 출력은 **언어 중립 구조 데이터**(condition/note 코드 + 숫자). i18n은 클라이언트(WeatherRenderer)가 담당.
 *  - 강수: 현재 우선 + 예보 fallback + PCP 범위/미만 파싱 강화(폭우 시 강수량 소실 방지).
 *
 * 검증: scripts/test-weather-hybrid.ts (KMA키=API Hub authKey·공식 격자 일치·레이턴시 1s, DEV_260705 §4).
 */

// ── 공개 타입 (렌더러/툴 공용 — 언어 중립) ──────────────────────────

/** 정규화된 날씨 상태 코드. 렌더러가 이모지/라벨로 매핑. */
export type WeatherCondition =
  | 'clear' | 'mostlyClear' | 'partlyCloudy' | 'cloudy' | 'overcast'
  | 'rain' | 'shower' | 'drizzle' | 'thunder'
  | 'snow' | 'rainSnow' | 'flurry' | 'fog' | 'unknown';

/** 강수 표시 상태: 지금 오는 중 / 예보상 예상 / 없음. */
export type PrecipState = 'now' | 'expected' | 'none';

/** 규칙기반 안내 코드(값 포함). 렌더러가 언어별 문구로 변환. */
export type WeatherNote =
  | { code: 'highPop'; value: number }
  | { code: 'currentRain'; value: number }
  | { code: 'expectedRain'; value: number }
  | { code: 'hot' }
  | { code: 'freezing' }
  | { code: 'strongWind'; value: number };

export type WeatherDaily = {
  date: string;            // YYYY-MM-DD (해당 도시 로컬)
  condition: WeatherCondition;
  minTemp: number;
  maxTemp: number;
  pop: number;             // 강수확률 %
  rainMm: number;
  snowMm: number;
};

export type WeatherData = {
  source: 'KMA' | 'OpenWeather';
  updatedAt: string;                 // ISO (실제 조회 시각)
  timezoneOffsetSec: number;         // 도시 로컬 tz offset (초)
  location: {
    name: string;                    // 표기용(도시명 원문/라벨)
    country: string;                 // ISO 국가코드 (KR/JP/...)
  };
  current: {
    temp: number;
    feelsLike: number;
    minTemp: number;
    maxTemp: number;
    humidity: number;
    pressure: number | null;
    windSpeed: number;
    windGust: number | null;
    clouds: number;                  // %
    visibilityKm: number | null;
    condition: WeatherCondition;
    precip: { state: PrecipState; mm: number; pop: number };
    observedAt: string;              // ISO
  };
  daily: WeatherDaily[];             // KMA +3일 / OWM 5일 (렌더러가 가변 처리)
  forecastDays: number;              // daily 길이(렌더러 note용)
  notes: WeatherNote[];
};

// ── 도시명 별칭(geocoding 질의 정규화용 — 격자 하드코딩 아님) ──────────
// OpenWeather geocoding은 영어/로마자에 강함. 한국 도시 한글 입력을 안정적으로
// 해석시키기 위한 이름 매핑 표. lat/lon은 여기서 얻지 않고 geocoding이 돌려준다.
const CITY_ALIASES: Record<string, string> = {
  서울: 'Seoul,KR', 서울시: 'Seoul,KR', 부산: 'Busan,KR', 대구: 'Daegu,KR',
  인천: 'Incheon,KR', 광주: 'Gwangju,KR', 대전: 'Daejeon,KR', 울산: 'Ulsan,KR',
  세종: 'Sejong,KR', 수원: 'Suwon,KR', 성남: 'Seongnam,KR', 용인: 'Yongin,KR',
  고양: 'Goyang,KR', 제주: 'Jeju,KR', 제주시: 'Jeju,KR', 제주도: 'Jeju,KR', 서귀포: 'Seogwipo,KR',
  춘천: 'Chuncheon,KR', 강릉: 'Gangneung,KR', 청주: 'Cheongju,KR', 전주: 'Jeonju,KR',
  포항: 'Pohang,KR', 창원: 'Changwon,KR', 여수: 'Yeosu,KR', 목포: 'Mokpo,KR',
  안동: 'Andong,KR', 원주: 'Wonju,KR', 천안: 'Cheonan,KR', 김해: 'Gimhae,KR',
  도쿄: 'Tokyo,JP', 오사카: 'Osaka,JP', 교토: 'Kyoto,JP', 후쿠오카: 'Fukuoka,JP',
  삿포로: 'Sapporo,JP', 베이징: 'Beijing,CN', 상하이: 'Shanghai,CN', 홍콩: 'Hong Kong,HK',
  타이베이: 'Taipei,TW', 방콕: 'Bangkok,TH', 싱가포르: 'Singapore,SG', 하노이: 'Hanoi,VN',
  호치민: 'Ho Chi Minh City,VN', 마닐라: 'Manila,PH', 자카르타: 'Jakarta,ID',
  런던: 'London,GB', 파리: 'Paris,FR', 베를린: 'Berlin,DE', 로마: 'Rome,IT',
  밀라노: 'Milan,IT', 마드리드: 'Madrid,ES', 바르셀로나: 'Barcelona,ES',
  암스테르담: 'Amsterdam,NL', 취리히: 'Zurich,CH', 빈: 'Vienna,AT', 프라하: 'Prague,CZ',
  뉴욕: 'New York,US', 뉴욕시: 'New York,US', 워싱턴: 'Washington,US',
  로스앤젤레스: 'Los Angeles,US', 엘에이: 'Los Angeles,US', 시카고: 'Chicago,US',
  샌프란시스코: 'San Francisco,US', 시애틀: 'Seattle,US', 라스베이거스: 'Las Vegas,US',
  토론토: 'Toronto,CA', 밴쿠버: 'Vancouver,CA', 시드니: 'Sydney,AU', 멜버른: 'Melbourne,AU',
  오클랜드: 'Auckland,NZ',
};

const KMA_BASE = 'https://apihub.kma.go.kr/api';

function openWeatherKey() {
  return process.env.OPENWEATHER_API_KEY || process.env.OPENWEATHER_KEY;
}
function kmaKey() {
  return process.env.KMA_API_KEY;
}

/**
 * 이 이름이 우리가 아는 도시인가 — 라우터의 날씨 후속 판정(`weather-followup.ts`)이 쓴다.
 * 별칭 표를 그대로 재사용해 **사전이 따로 늙지 않게** 한다(복사 금지).
 * 여기 없는 지명(순천·구미…)은 `false`지만, 호출부가 그걸 "도시 아님"이 아니라
 * "확신 없음"으로 다뤄야 한다 — 이 표는 allowlist가 아니라 geocoding 별칭이다.
 */
export function isKnownCityName(name: string): boolean {
  const n = normalizeCityInput(name);
  return !!(CITY_ALIASES[n] || CITY_ALIASES[compactCity(n)]);
}

export function normalizeCityInput(city: string) {
  return city.trim().replace(/\s+/g, ' ').slice(0, 80);
}
function compactCity(city: string) {
  return normalizeCityInput(city).replace(/\s+/g, '').toLowerCase();
}
function cityAliasQuery(city: string): string | undefined {
  const normalized = normalizeCityInput(city);
  return CITY_ALIASES[normalized] || CITY_ALIASES[compactCity(normalized)];
}

// ── KMA 위경도 → 격자 변환 (Lambert Conformal Conic, 기상청 공식 샘플) ──
// scripts/test-weather-hybrid.ts에서 서울 60,127 · 부산 98,76 등 레퍼런스 값과 일치 검증.
export function dfsXyConv(lat: number, lon: number) {
  const RE = 6371.00877, GRID = 5.0;
  const SLAT1 = 30, SLAT2 = 60, OLON = 126, OLAT = 38, XO = 43, YO = 136;
  const D = Math.PI / 180, re = RE / GRID;
  const s1 = SLAT1 * D, s2 = SLAT2 * D, ol = OLON * D, oa = OLAT * D;
  const sn = Math.log(Math.cos(s1) / Math.cos(s2))
    / Math.log(Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + s1 * 0.5), sn) * Math.cos(s1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + oa * 0.5), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * D * 0.5), sn);
  let theta = lon * D - ol;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

// ── KST / base_time 슬롯팅 ──────────────────────────────────────────
function formatKst(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    ymd: `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`,
    h: p(date.getUTCHours()),
  };
}
function latestHourlyBase() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  now.setUTCMinutes(0, 0, 0);
  now.setUTCHours(now.getUTCHours() - 1);
  const { ymd, h } = formatKst(now);
  return { baseDate: ymd, baseTime: `${h}00` };
}
function latestVillageForecastBase() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const slots = ['0200', '0500', '0800', '1100', '1400', '1700', '2000', '2300'];
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const avail = slots
    .map(s => ({ s, m: Number(s.slice(0, 2)) * 60 + Number(s.slice(2)) + 20 }))
    .filter(i => cur >= i.m);
  if (!avail.length) now.setUTCDate(now.getUTCDate() - 1);
  return { baseDate: formatKst(now).ymd, baseTime: avail.at(-1)?.s || '2300' };
}
function isoFromKst(ymd: string, hm: string) {
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(4, 6)), d = Number(ymd.slice(6, 8));
  const h = Number(hm.slice(0, 2)), mi = Number(hm.slice(2, 4) || 0);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi)).toISOString();
}
function dateFromYmd(ymd: string) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

// ── 값 파싱: KMA PCP 범위/미만/없음 문자열 안전 처리(폭우 강수량 소실 방지) ──
export function numericValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.includes('없음')) return 0;
  const range = text.match(/(-?\d+(?:\.\d+)?)\s*~\s*(-?\d+(?:\.\d+)?)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const first = text.match(/-?\d+(?:\.\d+)?/);
  if (!first) return null;
  const parsed = Number(first[0]);
  if (!Number.isFinite(parsed)) return null;
  if (text.includes('미만')) return parsed / 2;
  return parsed;
}

// ── 상태 코드 정규화 ────────────────────────────────────────────────
function kmaCondition(pty: number, sky: number): WeatherCondition {
  switch (pty) {
    case 1: case 5: return 'rain';       // 비 / 빗방울
    case 4: return 'shower';             // 소나기
    case 2: case 6: return 'rainSnow';   // 비/눈 · 빗방울눈날림
    case 3: return 'snow';               // 눈
    case 7: return 'flurry';             // 눈날림
  }
  if (sky === 4) return 'overcast';      // 흐림
  if (sky === 3) return 'cloudy';        // 구름많음
  return 'clear';                        // 맑음
}
// OpenWeather weather[0].id → condition (https://openweathermap.org/weather-conditions)
function owmCondition(id: number): WeatherCondition {
  if (id >= 200 && id < 300) return 'thunder';
  if (id >= 300 && id < 400) return 'drizzle';
  if (id === 511) return 'snow';
  if (id >= 500 && id < 505) return id >= 502 ? 'rain' : 'rain';
  if (id === 520 || id === 521 || id === 522 || id === 531) return 'shower';
  if (id >= 500 && id < 600) return 'rain';
  if (id >= 600 && id < 700) return (id === 611 || id === 612 || id === 613 || id === 615 || id === 616) ? 'rainSnow' : 'snow';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'clear';
  if (id === 801) return 'mostlyClear';
  if (id === 802) return 'partlyCloudy';
  if (id === 803) return 'cloudy';
  if (id === 804) return 'overcast';
  return 'unknown';
}
function isPrecipCondition(c: WeatherCondition) {
  return c === 'rain' || c === 'shower' || c === 'drizzle' || c === 'thunder'
    || c === 'snow' || c === 'rainSnow' || c === 'flurry';
}

// ── OpenWeather ─────────────────────────────────────────────────────
type OwmEntry = {
  dt: number;
  main: { temp: number; feels_like: number; temp_min: number; temp_max: number; humidity: number; pressure: number };
  weather: Array<{ id: number; main: string; description: string; icon: string }>;
  wind?: { speed: number; gust?: number };
  clouds?: { all: number };
  pop?: number;
  rain?: { '1h'?: number; '3h'?: number };
  snow?: { '1h'?: number; '3h'?: number };
  visibility?: number;
};

// 외부 API가 멈추면 Vercel 60s 하드캡까지 매달림 → 툴 실행엔 상위 타임아웃이 없으므로
// per-fetch로 끊는다. KMA는 실측 ~2~3.6s라 8s면 정상 응답은 안 잘리고 행만 차단.
const OWM_FETCH_TIMEOUT_MS = 8_000;
const KMA_FETCH_TIMEOUT_MS = 9_000;

async function fetchOwm<T>(url: string): Promise<T> {
  const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(OWM_FETCH_TIMEOUT_MS) } as any);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `OpenWeather request failed (${res.status})`);
  return data as T;
}

type Resolved = { input: string; label: string; name: string; country: string; lat: number; lon: number };

async function geocode(city: string, apiKey: string): Promise<Resolved> {
  const normalized = normalizeCityInput(city);
  const query = cityAliasQuery(normalized) || normalized;
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1&appid=${apiKey}`;
  const geo = await fetchOwm<Array<{ name: string; local_names?: Record<string, string>; lat: number; lon: number; country: string }>>(url);
  const match = geo[0];
  if (!match) {
    const err: any = new Error('도시를 찾지 못했습니다.');
    err.status = 404; err.code = 'CITY_NOT_FOUND';
    throw err;
  }
  return {
    input: normalized,
    label: match.local_names?.ko || match.name,
    name: match.name,
    country: match.country,
    lat: match.lat,
    lon: match.lon,
  };
}

function localDate(epochSeconds: number, tzSeconds = 0) {
  return new Date((epochSeconds + tzSeconds) * 1000).toISOString().slice(0, 10);
}
function dominant(entries: OwmEntry[]) {
  const counts = new Map<number, number>();
  for (const e of entries) {
    const id = e.weather?.[0]?.id;
    if (id == null) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 800;
}
function summarizeOwmDaily(list: OwmEntry[], tzSeconds: number): WeatherDaily[] {
  const grouped = new Map<string, OwmEntry[]>();
  for (const e of list) {
    const date = localDate(e.dt, tzSeconds);
    grouped.set(date, [...(grouped.get(date) || []), e]);
  }
  return [...grouped.entries()].slice(0, 5).map(([date, entries]) => {
    const temps = entries.flatMap(e => [e.main.temp_min, e.main.temp_max]);
    const pop = Math.max(...entries.map(e => e.pop || 0));
    const rain = entries.reduce((s, e) => s + (e.rain?.['3h'] || 0), 0);
    const snow = entries.reduce((s, e) => s + (e.snow?.['3h'] || 0), 0);
    return {
      date,
      condition: owmCondition(dominant(entries)),
      minTemp: Math.round(Math.min(...temps)),
      maxTemp: Math.round(Math.max(...temps)),
      pop: Math.round(pop * 100),
      rainMm: Number(rain.toFixed(1)),
      snowMm: Number(snow.toFixed(1)),
    };
  });
}

function buildNotes(opts: { pop: number; currentPrecip: number; expectedPrecip: number; temp: number; wind: number }): WeatherNote[] {
  const notes: WeatherNote[] = [];
  if (opts.pop >= 50) notes.push({ code: 'highPop', value: opts.pop });
  if (opts.currentPrecip > 0) notes.push({ code: 'currentRain', value: Number(opts.currentPrecip.toFixed(1)) });
  else if (opts.expectedPrecip > 0) notes.push({ code: 'expectedRain', value: Number(opts.expectedPrecip.toFixed(1)) });
  if (opts.temp >= 30) notes.push({ code: 'hot' });
  else if (opts.temp <= 0) notes.push({ code: 'freezing' });
  if (opts.wind >= 8) notes.push({ code: 'strongWind', value: Number(opts.wind.toFixed(1)) });
  return notes;
}

function precipOf(current: number, expected: number, pop: number): { state: PrecipState; mm: number; pop: number } {
  if (current > 0) return { state: 'now', mm: Number(current.toFixed(1)), pop };
  if (expected > 0) return { state: 'expected', mm: Number(expected.toFixed(1)), pop };
  return { state: 'none', mm: 0, pop };
}

async function buildOpenWeatherData(resolved: Resolved, apiKey: string): Promise<WeatherData> {
  const params = `lat=${resolved.lat}&lon=${resolved.lon}&appid=${apiKey}&units=metric`;
  const [current, forecast] = await Promise.all([
    fetchOwm<OwmEntry & { name: string; sys?: { country?: string }; timezone?: number }>(`https://api.openweathermap.org/data/2.5/weather?${params}`),
    fetchOwm<{ city?: { timezone?: number; country?: string }; list?: OwmEntry[] }>(`https://api.openweathermap.org/data/2.5/forecast?${params}`),
  ]);
  const tz = current.timezone ?? forecast.city?.timezone ?? 0;
  const daily = summarizeOwmDaily(forecast.list || [], tz);
  const curRain = (current.rain?.['1h'] || 0) + (current.snow?.['1h'] || 0);
  const expected = (daily[0]?.rainMm || 0) + (daily[0]?.snowMm || 0);
  const pop = daily[0]?.pop ?? 0;
  const wind = Number((current.wind?.speed || 0).toFixed(1));
  const temp = Math.round(current.main.temp);
  return {
    source: 'OpenWeather',
    updatedAt: new Date().toISOString(),
    timezoneOffsetSec: tz,
    location: {
      name: resolved.label || current.name || resolved.input,
      country: current.sys?.country || forecast.city?.country || resolved.country || '',
    },
    current: {
      temp,
      feelsLike: Math.round(current.main.feels_like),
      minTemp: Math.round(current.main.temp_min),
      maxTemp: Math.round(current.main.temp_max),
      humidity: current.main.humidity,
      pressure: current.main.pressure ?? null,
      windSpeed: wind,
      windGust: current.wind?.gust ? Number(current.wind.gust.toFixed(1)) : null,
      clouds: current.clouds?.all || 0,
      visibilityKm: current.visibility ? Number((current.visibility / 1000).toFixed(1)) : null,
      condition: owmCondition(current.weather?.[0]?.id ?? 800),
      precip: precipOf(curRain, expected, pop),
      observedAt: new Date(current.dt * 1000).toISOString(),
    },
    daily,
    forecastDays: daily.length,
    notes: buildNotes({ pop, currentPrecip: curRain, expectedPrecip: expected, temp, wind }),
  };
}

// ── KMA ─────────────────────────────────────────────────────────────
type KmaItem = Record<string, string | number | undefined>;

async function fetchKma(path: string, query: Record<string, string>) {
  const apiKey = kmaKey();
  if (!apiKey) {
    const err: any = new Error('KMA_API_KEY가 없습니다.');
    err.code = 'KMA_CONFIG_MISSING';
    throw err;
  }
  const params = new URLSearchParams({ ...query, authKey: apiKey });
  const res = await fetch(`${KMA_BASE}${path}?${params.toString()}`, {
    headers: { Accept: 'application/json,*/*', 'User-Agent': 'chat-agent-weather/1.0' },
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(KMA_FETCH_TIMEOUT_MS),
  } as any);
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`KMA JSON 파싱 실패 (${res.status})`); }
  const header = data?.response?.header;
  if (!res.ok || (header && header.resultCode !== '00')) {
    throw new Error(header?.resultMsg || `KMA request failed (${res.status})`);
  }
  return data;
}
function kmaItems(json: any): KmaItem[] {
  const item = json?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}
function kmaCategoryMap(rows: KmaItem[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of rows) {
    const c = String(row.category || '');
    if (c) values[c] = String(row.obsrValue ?? '');
  }
  return values;
}
function groupKmaForecast(rows: KmaItem[]) {
  const grouped = new Map<string, { fcstDate: string; fcstTime: string; values: Record<string, string> }>();
  for (const row of rows) {
    const fcstDate = String(row.fcstDate || ''), fcstTime = String(row.fcstTime || ''), category = String(row.category || '');
    if (!fcstDate || !fcstTime || !category) continue;
    const key = `${fcstDate}${fcstTime}`;
    const entry = grouped.get(key) || { fcstDate, fcstTime, values: {} };
    entry.values[category] = String(row.fcstValue ?? '');
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) => `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`));
}
function summarizeKmaDaily(villageRows: KmaItem[]): WeatherDaily[] {
  const byDate = new Map<string, Record<string, string>[]>();
  for (const row of groupKmaForecast(villageRows)) {
    const date = dateFromYmd(row.fcstDate);
    byDate.set(date, [...(byDate.get(date) || []), row.values]);
  }
  return [...byDate.entries()].slice(0, 5).map(([date, entries]) => {
    const temps = entries.map(v => numericValue(v.TMP)).filter((v): v is number => v !== null);
    const pop = entries.map(v => numericValue(v.POP)).filter((v): v is number => v !== null);
    const rain = entries.map(v => numericValue(v.PCP)).filter((v): v is number => v !== null);
    const snow = entries.map(v => numericValue(v.SNO)).filter((v): v is number => v !== null);
    const rep = entries.find(v => Number(v.PTY || 0) > 0) || entries[Math.floor(entries.length / 2)] || {};
    const tmn = entries.map(v => numericValue(v.TMN)).find((v): v is number => v !== null);
    const tmx = entries.map(v => numericValue(v.TMX)).find((v): v is number => v !== null);
    const minTemp = tmn ?? (temps.length ? Math.min(...temps) : 0);
    const maxTemp = tmx ?? (temps.length ? Math.max(...temps) : minTemp);
    return {
      date,
      condition: kmaCondition(Number(rep.PTY || 0), Number(rep.SKY || 1)),
      minTemp: Math.round(minTemp),
      maxTemp: Math.round(maxTemp),
      pop: pop.length ? Math.max(0, ...pop) : 0,
      rainMm: Number(rain.reduce((s, v) => s + v, 0).toFixed(1)),
      snowMm: Number(snow.reduce((s, v) => s + v, 0).toFixed(1)),
    };
  });
}

async function buildKmaData(resolved: Resolved): Promise<WeatherData> {
  const { nx, ny } = dfsXyConv(resolved.lat, resolved.lon);
  const hourly = latestHourlyBase();
  const village = latestVillageForecastBase();

  // 육상예보(getLandFcst) 생략 — regId/stnId는 공식 없음(코드표) + notes는 규칙기반으로 충분.
  const [nowcast, villageForecast] = await Promise.all([
    fetchKma('/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst', {
      pageNo: '1', numOfRows: '1000', dataType: 'JSON',
      base_date: hourly.baseDate, base_time: hourly.baseTime, nx: String(nx), ny: String(ny),
    }),
    fetchKma('/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst', {
      pageNo: '1', numOfRows: '1200', dataType: 'JSON',
      base_date: village.baseDate, base_time: village.baseTime, nx: String(nx), ny: String(ny),
    }),
  ]);

  const nowRows = kmaItems(nowcast);
  const villageRows = kmaItems(villageForecast);
  // KMA가 200이지만 데이터가 비는 경우(격자 밖·base_time 미스 등) → 0°C 유령카드 대신 폴백 유도.
  if (nowRows.length === 0 && villageRows.length === 0) {
    throw new Error('KMA 응답에 관측/예보 데이터가 없습니다 (빈 items)');
  }
  const cur = kmaCategoryMap(nowRows);
  const firstForecast = groupKmaForecast(villageRows)[0]?.values || {};
  const daily = summarizeKmaDaily(villageRows);

  const temp = Math.round(numericValue(cur.T1H) ?? daily[0]?.maxTemp ?? 0);
  const humidity = Math.round(numericValue(cur.REH) ?? daily[0]?.pop ?? 0);
  const wind = Number((numericValue(cur.WSD) ?? 0).toFixed(1));
  const curRain = numericValue(cur.RN1) ?? 0;
  const pty = Number(cur.PTY || firstForecast.PTY || 0);
  const sky = Number(firstForecast.SKY || 1);
  const expected = (daily[0]?.rainMm || 0) + (daily[0]?.snowMm || 0);
  const pop = daily[0]?.pop ?? 0;
  const observedDate = String(nowRows[0]?.baseDate || hourly.baseDate);
  const observedTime = String(nowRows[0]?.baseTime || hourly.baseTime);

  return {
    source: 'KMA',
    updatedAt: new Date().toISOString(),
    timezoneOffsetSec: 32400,
    location: { name: resolved.label || resolved.input, country: 'KR' },
    current: {
      temp,
      feelsLike: temp,               // KMA 실황엔 체감온도 없음 → 기온과 동일
      minTemp: daily[0]?.minTemp ?? temp,
      maxTemp: daily[0]?.maxTemp ?? temp,
      humidity,
      pressure: null,
      windSpeed: wind,
      windGust: null,
      clouds: sky === 4 ? 100 : sky === 3 ? 70 : 0,
      visibilityKm: null,
      condition: kmaCondition(pty, sky),
      precip: precipOf(curRain, expected, pop),
      observedAt: isoFromKst(observedDate, observedTime),
    },
    daily,
    forecastDays: daily.length,
    notes: buildNotes({ pop, currentPrecip: curRain, expectedPrecip: expected, temp, wind }),
  };
}

// ── 진입점 ──────────────────────────────────────────────────────────
export async function buildWeatherData(city: string): Promise<WeatherData> {
  const apiKey = openWeatherKey();
  if (!apiKey) {
    const err: any = new Error('날씨 서비스 설정(OPENWEATHER_API_KEY)이 없습니다.');
    err.status = 500; err.code = 'WEATHER_CONFIG_MISSING';
    throw err;
  }
  const normalized = normalizeCityInput(city || 'Seoul');
  const resolved = await geocode(normalized, apiKey);   // geocoding 1회 (lat/lon/country)

  if (resolved.country === 'KR' && kmaKey()) {
    try {
      return await buildKmaData(resolved);
    } catch (error: any) {
      console.warn('[weather] KMA 실패 → OpenWeather 폴백:', resolved.label, error?.message);
      return buildOpenWeatherData(resolved, apiKey);
    }
  }
  return buildOpenWeatherData(resolved, apiKey);
}
