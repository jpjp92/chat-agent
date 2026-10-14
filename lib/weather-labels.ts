// 날씨 상태 표기 — 카드(WeatherRenderer)와 카드 아래 한 줄 설명(server/agent/weather-summary.ts)이 같은 표를 쓴다.
// 둘이 다른 표를 쓰면 카드는 "맑음", 문장은 "대체로 맑음" 처럼 어긋난다.

export type WeatherLang = 'ko' | 'en' | 'es' | 'fr';

export type WeatherConditionCode =
  | 'clear' | 'mostlyClear' | 'partlyCloudy' | 'cloudy' | 'overcast'
  | 'rain' | 'shower' | 'drizzle' | 'thunder'
  | 'snow' | 'rainSnow' | 'flurry' | 'fog' | 'unknown';

export const COND_LABEL: Record<WeatherConditionCode, Record<WeatherLang, string>> = {
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
