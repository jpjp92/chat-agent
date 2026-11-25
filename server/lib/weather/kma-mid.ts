/**
 * 기상청 중기예보(4~10일 뒤)로 단기예보 뒤를 잇는다 — 순수 함수만(조회는 index.ts 의 fetchKma).
 *
 * 왜(PLAN_WEATHER_MID_FORECAST_261125 §1): 단기예보는 마지막 날을 일부 시간만 준다(11-29 자정 TMP 하나) →
 * 카드 5번째 날이 `0°/0°·0%`. 그런 날은 버리고 중기 기온·강수확률·날씨 문구로 채운다.
 */

type Condition = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'shower' | 'snow' | 'rainSnow' | 'unknown';

type MidDay = {
  date: string; condition: Condition; minTemp: number; maxTemp: number; pop: number; rainMm: number; snowMm: number;
};

// 육상 구역 목록(fct_medm_reg.php, 18개 중 남한) — 도시 지점 코드 앞 5자가 여기 있으면 그 구역, 아니면 앞 3자
const LAND_5 = new Set(['11C10', '11C20', '11D10', '11D20', '11F10', '11F20', '11H10', '11H20']);

/** 기온 도시 지점 코드 → 육상(강수·날씨) 구역 코드 */
export function midLandReg(taReg: string): string {
  if (taReg.startsWith('21F1')) return '11F10000';   // 군산·부안 등 서해안 → 전북
  if (taReg.startsWith('21F2')) return '11F20000';   // 목포·무안 등 → 전남
  if (taReg.startsWith('11A')) return '11B00000';    // 백령도 → 서울·인천·경기
  if (taReg.startsWith('11E')) return '11H10000';    // 울릉도·독도 → 경북
  const five = taReg.slice(0, 5);
  return LAND_5.has(five) ? `${five}000` : `${taReg.slice(0, 3)}00000`;
}

/** 발표 시각 후보(KST `YYYYMMDDHHmm`) — 최근 06·18시 발표, 그다음 직전 발표. 발표 직후엔 `NO_DATA` 라 둘째로 간다. */
export function midTmFcCandidates(now: Date = new Date()): string[] {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const h = kst.getUTCHours();
  const prevDay = new Date(kst.getTime() - 86_400_000);
  if (h >= 18) return [`${ymd(kst)}1800`, `${ymd(kst)}0600`];
  if (h >= 6) return [`${ymd(kst)}0600`, `${ymd(prevDay)}1800`];
  return [`${ymd(prevDay)}1800`, `${ymd(prevDay)}0600`];
}

/** 중기 날씨 문구("흐리고 비", "구름많고 비/눈"…) → 카드 상태 코드 */
export function midCondition(wf: string | undefined): Condition {
  const s = wf ?? '';
  if (/비\/눈|눈\/비/.test(s)) return 'rainSnow';
  if (s.includes('소나기')) return 'shower';
  if (s.includes('비')) return 'rain';
  if (s.includes('눈')) return 'snow';
  if (s.includes('흐')) return 'overcast';
  if (s.includes('구름')) return 'cloudy';
  if (s.includes('맑')) return 'clear';
  return 'unknown';
}

const num = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** 중기 육상(land)·기온(ta) 항목 → 날짜별. n 은 발표일 기준 n일 뒤(06시 발표 4~, 18시 발표 5~) */
export function parseMidDays(land: Record<string, unknown>, ta: Record<string, unknown>, tmFc: string): MidDay[] {
  const base = Date.UTC(Number(tmFc.slice(0, 4)), Number(tmFc.slice(4, 6)) - 1, Number(tmFc.slice(6, 8)));
  const out: MidDay[] = [];
  for (let n = 3; n <= 10; n++) {
    const lo = num(ta[`taMin${n}`]), hi = num(ta[`taMax${n}`]);
    if (lo === null || hi === null) continue;
    const pops = [land[`rnSt${n}Am`], land[`rnSt${n}Pm`], land[`rnSt${n}`]].map(num).filter((v): v is number => v !== null);
    const wfs = [land[`wf${n}Am`], land[`wf${n}Pm`], land[`wf${n}`]].filter((v): v is string => typeof v === 'string');
    // 오전·오후 중 강수가 있는 쪽을 대표로 — 단기예보 요약(강수 시간 우선)과 같은 기준
    const wet = wfs.find(w => /비|눈|소나기/.test(w));
    out.push({
      date: new Date(base + n * 86_400_000).toISOString().slice(0, 10),
      condition: midCondition(wet ?? wfs.at(-1)),
      minTemp: Math.round(lo), maxTemp: Math.round(hi),
      pop: pops.length ? Math.max(...pops) : 0,
      rainMm: 0, snowMm: 0,   // 중기는 강수량을 주지 않는다
    });
  }
  return out;
}

/**
 * 단기 날짜별 + 중기 → 카드 5일. 단기에서 일부 시간만 있는 날(오늘 제외)은 버린다 — 중기가 실패해도 `0°/0°` 칸은 나가지 않는다.
 * `complete` 는 단기 요약이 판정(TMN·TMX 가 둘 다 있거나 시간별 값이 충분).
 */
export function mergeDaily<T extends { date: string }>(short: (T & { complete: boolean })[], mid: T[], today: string, days = 5): T[] {
  const kept = short.filter(d => d.date === today || d.complete).map(({ complete: _c, ...d }) => d as unknown as T);
  const last = kept.at(-1)?.date ?? today;
  return [...kept, ...mid.filter(d => d.date > last)].slice(0, days);
}
