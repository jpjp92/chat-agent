/**
 * 날씨 중기예보 합치기 하니스 — `npx tsx tests/test-weather-mid.mts` (네트워크·환경변수 없음)
 *
 * 왜 있는가(PLAN_WEATHER_MID_FORECAST_261125): 단기예보는 마지막 날을 일부 시간만 줘(11-29 자정 TMP 하나)
 * 카드 5번째 날이 `0°/0°·0%` 였다. 그런 날은 버리고 기상청 중기(4~10일 뒤)로 잇는다.
 * 구역 코드 변환·발표 시각·필드 파싱·문구 매핑·합치기 규칙을 고정한다.
 */
import fs from 'node:fs';
import { mergeDaily, midCondition, midLandReg, midTmFcCandidates, parseMidDays } from '../server/lib/weather/kma-mid.js';
import { findKrPlace } from '../server/lib/weather/kr-places.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// ① 구역 코드
check('육상 구역: 서울 11B10101 → 11B00000, 부산 11H20201 → 11H20000, 춘천 → 강원영서',
    midLandReg('11B10101') === '11B00000' && midLandReg('11H20201') === '11H20000' && midLandReg('11D10301') === '11D10000');
check('육상 구역 예외: 군산 21F1 → 전북, 목포 21F2 → 전남, 백령도 → 수도권, 울릉도 → 경북, 제주 → 11G',
    midLandReg('21F10501') === '11F10000' && midLandReg('21F20801') === '11F20000' && midLandReg('11A00101') === '11B00000'
    && midLandReg('11E00101') === '11H10000' && midLandReg('11G00201') === '11G00000');
check('좌표표가 중기 지점 코드를 준다(서울·경기 광주·강원 고성·울릉)',
    findKrPlace('서울')?.midTaReg === '11B10101' && findKrPlace('경기 광주')?.midTaReg === '11B20702'
    && findKrPlace('강원 고성')?.midTaReg === '11D20402' && findKrPlace('울릉')?.midTaReg === '11E00101');

// ② 발표 시각 (KST = UTC+9)
const at = (kst: string) => new Date(new Date(`${kst}+09:00`).getTime());
check('발표 시각: 16시 → 당일 06시, 전날 18시', midTmFcCandidates(at('2026-11-25T16:00:00')).join() === '202611250600,202611241800');
check('발표 시각: 19시 → 당일 18시, 당일 06시', midTmFcCandidates(at('2026-11-25T19:00:00')).join() === '202611251800,202611250600');
check('발표 시각: 새벽 3시 → 전날 18시, 전날 06시(월초 경계)', midTmFcCandidates(at('2026-12-01T03:00:00')).join() === '202611301800,202611300600');

// ③ 파싱 — 11-25 06시 실응답(서울) 일부
const land = { rnSt4Am: 10, rnSt4Pm: 10, rnSt5Am: 60, rnSt5Pm: 20, rnSt8: 20, wf4Am: '맑음', wf4Pm: '맑음', wf5Am: '흐리고 비', wf5Pm: '구름많음', wf8: '구름많음' };
const ta = { taMin4: -1, taMax4: 8, taMin5: 4, taMax5: 14, taMin8: 5, taMax8: 12 };
const mid = parseMidDays(land, ta, '202611250600');
check('파싱: 06시 발표 4일 뒤 = 11-29 -1/8°·10%·맑음', JSON.stringify(mid[0]) === JSON.stringify({ date: '2026-11-29', condition: 'clear', minTemp: -1, maxTemp: 8, pop: 10, rainMm: 0, snowMm: 0 }), JSON.stringify(mid[0]));
check('파싱: 오전 비·오후 구름 → 비, 강수확률은 큰 쪽(60)', mid[1]?.condition === 'rain' && mid[1]?.pop === 60);
check('파싱: 8일 뒤는 오전·오후 없이 하루 필드', mid[2]?.date === '2026-12-03' && mid[2]?.pop === 20 && mid[2]?.condition === 'cloudy');
check('파싱: 18시 발표는 5일 뒤부터(필드 있는 날만)', parseMidDays({ rnSt5Am: 10, wf5Am: '맑음' }, { taMin5: 1, taMax5: 9 }, '202611241800')[0]?.date === '2026-11-29');
check('파싱: 기온 없는 날은 만들지 않음(빈 응답 → 0°/0° 금지)', parseMidDays({}, {}, '202611250600').length === 0);

// ④ 문구
check('문구 매핑', midCondition('흐리고 비/눈') === 'rainSnow' && midCondition('구름많고 소나기') === 'shower' && midCondition('흐리고 비') === 'rain'
    && midCondition('구름많고 눈') === 'snow' && midCondition('흐림') === 'overcast' && midCondition('구름많음') === 'cloudy' && midCondition('맑음') === 'clear' && midCondition(undefined) === 'unknown');

// ⑤ 합치기
const d = (date: string, complete: boolean) => ({ date, minTemp: 0, maxTemp: 0, complete });
const short = [d('2026-11-25', false), d('2026-11-26', true), d('2026-11-27', true), d('2026-11-28', true), d('2026-11-29', false)];
const merged = mergeDaily(short, mid, '2026-11-25');
check('합치기: 자정 한 점뿐인 11-29(단기)는 버리고 중기 11-29 로', merged.length === 5 && merged[4].date === '2026-11-29' && merged[4].maxTemp === 8, JSON.stringify(merged.map(x => x.date)));
check('합치기: 오늘은 일부 시간이라도 남긴다', merged[0].date === '2026-11-25');
check('합치기: complete 플래그는 카드로 나가지 않음', merged.every(x => !('complete' in x)));
const noMid = mergeDaily(short, [], '2026-11-25');
check('중기 실패: 단기 4일, 일부 시간 날 없음', noMid.length === 4 && noMid.at(-1)?.date === '2026-11-28');
check('합치기: 단기와 겹치는 중기 날짜는 단기 우선', mergeDaily([d('2026-11-25', true), d('2026-11-29', true)], mid, '2026-11-25')[1].maxTemp === 0);

// ⑥ 소스 고정
const src = fs.readFileSync(new URL('../server/lib/weather/index.ts', import.meta.url), 'utf8');
check('중기는 단기와 병렬(단기 Promise.all 전에 시작)', /const midDaily = fetchMidDaily\([\s\S]{0,200}await Promise\.all\(\[/.test(src));
check('중기 제한 시간은 단기보다 짧다', Number(src.match(/KMA_MID_TIMEOUT_MS = ([\d_]+)/)?.[1].replace(/_/g, '')) < Number(src.match(/KMA_FETCH_TIMEOUT_MS = ([\d_]+)/)?.[1].replace(/_/g, '')));
check('중기 실패는 삼키고 단기만(NO_DATA 는 직전 발표로)', /async function fetchMidDaily[\s\S]{0,900}NO_DATA[\s\S]{0,300}return \[\];/.test(src));
check('단기 요약이 5일로 자르지 않는다(자르기는 합친 뒤)', !/byDate\.entries\(\)\]\.slice\(0, 5\)/.test(src) && /mergeDaily\(summarizeKmaDaily\(villageRows\), await midDaily, today\)/.test(src));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
