/**
 * 차트 숫자 표시 — 축약(만·억 / k·M·B)과 단위를 분리한다. 계획: docs/plans/PLAN_CHART_P1_261105.md §2
 *
 * `yAxis.unit` 은 원자료 단위(명·원·%)이고 축약은 여기서 한다. 모델이 이미 `만 명` 처럼 축약 단위로
 * 준 값을 다시 축약하면 100만 명이 "100만 만 명" 이 되므로 그때는 축약을 끈다.
 * React·Apex 에 의존하지 않는다 — 하니스가 그대로 쓴다.
 */
type Lang = 'ko' | 'en' | 'es' | 'fr';

// 모델 출력이라 길이·문자를 제한한다 — 표시는 React 가 이스케이프하지만 긴 문장이 헤더를 밀어내지 않게
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001f\u007f]/;
export const sanitizeUnit = (u: unknown): string | undefined => {
    if (typeof u !== 'string') return undefined;
    const s = u.trim();
    if (!s || s.length > 12 || CTRL_RE.test(s)) return undefined;
    return s;
};

// 영문 배수는 대소문자·뒤 공백까지 본다 — m/s²·mm·kg 는 배수가 아니라 단위
const PRE_SCALED_RE = /^(?:만|억|천|조|십만|백만|천만)|^(?:k|M|B|[Tt]housand|[Mm]illion|[Bb]illion)(?=$|\s)/;
/** 단위가 이미 축약 배수를 담고 있으면(만 명·억 원·M USD) 다시 축약하지 않는다 */
export const isPreScaledUnit = (unit?: string): boolean => !!unit && PRE_SCALED_RE.test(unit.trim());

const trim1 = (n: number) => String(Number(n.toFixed(1)));

/** y축 눈금 — 한국어는 만·억, 그 밖은 k·M·B. 축약 단위를 이미 받은 경우 천 단위 구분만 */
export const formatAxisValue = (value: unknown, lang: Lang, unit?: string): string => {
    const n = Number(value);
    if (value === null || value === undefined || !Number.isFinite(n)) return '';
    const a = Math.abs(n);
    if (!isPreScaledUnit(unit)) {
        if (lang === 'ko') {
            if (a >= 1e8) return `${trim1(n / 1e8)}억`;
            if (a >= 1e4) return `${trim1(n / 1e4)}만`;
        } else {
            if (a >= 1e9) return `${trim1(n / 1e9)}B`;
            if (a >= 1e6) return `${trim1(n / 1e6)}M`;
            if (a >= 1e3) return `${trim1(n / 1e3)}k`;
        }
    }
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

// 한글로 시작하는 단위·%·℃ 는 붙여 쓰고(1,006,645명·3.5%), N·m/s²·USD 는 띄운다
const attachUnit = (num: string, unit?: string) =>
    !unit ? num : /^[가-힣%℃°‰]/.test(unit) ? `${num}${unit}` : `${num} ${unit}`;

/** 툴팁 — 원본 수치를 축약 없이 천 단위 구분 + 단위 */
export const formatTooltipValue = (value: unknown, unit?: string): string => {
    const n = Number(value);
    if (value === null || value === undefined || !Number.isFinite(n)) return '–';
    return attachUnit(n.toLocaleString('en-US', { maximumFractionDigits: 4 }), unit);
};

/**
 * 마커 크기. 산점도는 점이 곧 데이터(6). 결측으로 끊긴 선은 앞뒤 null 인 점이 사라지므로 4.
 * numeric 축 선은 점이 적으면(≤ 10) 관측점과 그 사이 직선(보간)을 구분하게 4, 촘촘한 함수 샘플은 0.
 */
const OBSERVATION_MARKER_MAX = 10;
export const markerSize = (type: string, xScale: string, series: Array<{ data?: unknown[] }>): number => {
    if (type === 'scatter') return 6;
    if (type !== 'line' && type !== 'area') return 0;
    const hasNull = series.some(sr => (sr.data || []).some(v => v === null || (v as { y?: unknown } | null)?.y === null));
    if (hasNull) return 4;
    if (xScale === 'numeric' && series.every(sr => (sr.data || []).length <= OBSERVATION_MARKER_MAX)) return 4;
    return 0;
};
