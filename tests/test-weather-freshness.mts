/**
 * 날씨 신선도 하니스 — `npx tsx tests/test-weather-freshness.mts` (네트워크·환경변수 없음)
 *
 * 왜 있는가(DEV_261125 §7): KMA 시간 초과 → OpenWeather 폴백 때 `next.revalidate` 캐시가 3일 전(11-22) 응답을
 * 그대로 돌려줘, 오늘 카드에 22일 관측·22일부터의 예보가 나갔다(updatedAt 만 오늘이라 새 데이터처럼 보였다).
 *   ① 현재·예보 조회는 캐시하지 않는다(좌표 변환만 캐시)
 *   ② 관측 시각이 3시간보다 오래됐거나 읽을 수 없으면 카드로 내보내지 않는다
 */
import fs from 'node:fs';
import { isStaleObservation, WEATHER_MAX_OBSERVATION_AGE_MS } from '../server/lib/weather/index.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const now = new Date('2026-11-25T02:11:37.781Z');
check('② 실제 사고 값(11-22 관측) → 오래됨', isStaleObservation('2026-11-22T02:41:56.000Z', now));
check('② 10분 전 관측 → 신선', !isStaleObservation('2026-11-25T02:01:00.000Z', now));
check('② 정시 실황 2시간 전 → 신선', !isStaleObservation('2026-11-25T00:15:00.000Z', now));
check('② 3시간 1분 전 → 오래됨', isStaleObservation(new Date(now.getTime() - WEATHER_MAX_OBSERVATION_AGE_MS - 60_000).toISOString(), now));
check('② 관측 시각 없음·깨짐 → 오래됨(내보내지 않음)', isStaleObservation(null, now) && isStaleObservation('not-a-date', now));
check('② 미래 시각(시계 차이) → 통과', !isStaleObservation('2026-11-25T02:20:00.000Z', now));

const src = fs.readFileSync(new URL('../server/lib/weather/index.ts', import.meta.url), 'utf8');
check('① OWM 기본은 no-store(현재·예보)', /cacheable = false/.test(src) && src.includes("{ cache: 'no-store' }"));
check('① geocode 만 cacheable', (src.match(/cacheable: true/g) ?? []).length === 1 && /geo\/1\.0\/direct[\s\S]{0,400}cacheable: true/.test(src));
check('① OWM 조회에 revalidate 600 이 남지 않음', !/fetchOwm[\s\S]{0,300}revalidate: 600/.test(src));
check('② 진입점의 모든 반환이 assertFresh 를 거친다', (src.match(/return assertFresh\(/g) ?? []).length === 3);

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
