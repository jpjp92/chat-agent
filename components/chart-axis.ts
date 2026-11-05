/**
 * 차트 x축 판정 — 숫자 좌표(numeric)인가 범주(category)인가. 계획: docs/plans/PLAN_CHART_AXIS_261105.md
 *
 * 범주는 같은 폭으로 놓인다. 숫자 x 를 범주로 그리면 차트는 그려지지만 좌표가 틀린다
 * (x = 0,1,2,10 에서 10 이 2 바로 옆, 1970·1980…2020·2021 이 같은 폭). 그래서 x 가 실제 위치를 뜻하면
 * numeric 축으로 두고, 등간격 숫자 범주는 라벨을 받은 그대로 보이게 category 로 둔다.
 * React·Apex 에 의존하지 않는다 — 하니스와 헤드리스 픽셀 검사가 이 파일을 그대로 쓴다.
 */
export type XScale = 'numeric' | 'category';

type Y = number | null;
type Pt = { x: unknown; y: Y };
type Series = { name?: string; data: Array<Y | Pt> };

interface AxisResult {
    scale: XScale;
    series: Series[];
    categories: string[];
    /** numeric 축에서 x 가 모두 정수(연도 등) — 판정 기록용 */
    integerX: boolean;
}

// "1970"·"-0.4"·"1e3" 은 숫자, "2021년"·"1월"·"" 은 아니다
const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const toNum = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && NUM_RE.test(v.trim())) return Number(v.trim());
    return null;
};
const isPt = (d: unknown): d is Pt => !!d && typeof d === 'object' && 'x' in (d as object);
const label = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? String(Number(x.toFixed(4))) : String(x));

/** 오름·내림 어느 쪽이든 간격이 모두 같으면 등간격 */
export const isEvenlySpaced = (xs: number[]): boolean => {
    if (xs.length < 3) return true;
    const d0 = xs[1] - xs[0];
    if (d0 === 0) return false;
    const tol = Math.abs(d0) * 1e-6;
    for (let i = 2; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1] - d0) > tol) return false;
    return true;
};

export const resolveXAxis = (type: string, series: Series[], categories: string[]): AxisResult => {
    const numericCapable = type === 'line' || type === 'area' || type === 'scatter';
    const allPts = series.length > 0 && series.every(s => s.data.length > 0 && s.data.every(isPt));

    // ① {x,y} 점 — x 가 전부 숫자면 그 자체가 좌표
    if (allPts) {
        const numericX = series.every(s => (s.data as Pt[]).every(d => toNum(d.x) !== null));
        if (numericCapable && numericX) {
            const out = series.map(s => ({ ...s, data: (s.data as Pt[]).map(d => ({ x: toNum(d.x) as number, y: d.y })) }));
            const xs = out.flatMap(s => s.data.map(d => d.x));
            return { scale: 'numeric', series: out, categories: [], integerX: xs.every(Number.isInteger) };
        }
        // 숫자가 아닌 x(이름·월) 또는 막대 — 첫 시리즈 x 를 범주로, y 만 남긴다(시리즈끼리는 x 로 맞춘다)
        const xs = (series[0].data as Pt[]).map(d => label(d.x));
        const out = series.map(s => {
            const byX = new Map((s.data as Pt[]).map(d => [label(d.x), d.y]));
            return { ...s, data: xs.map(x => (byX.has(x) ? (byX.get(x) as Y) : null)) };
        });
        return { scale: 'category', series: out, categories: xs, integerX: false };
    }

    // ② 숫자 범주 + 값 배열 — 간격이 불균등할 때만 numeric(등간격은 범주가 왜곡 없고 라벨이 정확)
    const catNums = categories.map(toNum);
    if (numericCapable && categories.length >= 2 && catNums.every(n => n !== null)) {
        const xs = catNums as number[];
        if (!isEvenlySpaced(xs)) {
            const out = series.map(s => ({
                ...s,
                data: xs.map((x, i) => ({ x, y: (s.data[i] as Y) ?? null })),
            }));
            return { scale: 'numeric', series: out, categories: [], integerX: xs.every(Number.isInteger) };
        }
    }
    return { scale: 'category', series, categories, integerX: false };
};

/**
 * numeric 축 Apex 옵션. 눈금은 깔끔한 간격(1·2·5×10ⁿ)에, 축 양끝은 그 배수에 맞춘다 — Apex 기본은
 * 범위를 tickAmount 로 나눠 1982.8·3.3 같은 자리에 눈금을 놓고, 그걸 반올림해 보이면 위치와 숫자가 어긋난다.
 * 후보 간격 중 축이 데이터보다 가장 덜 넓어지는 것을 고른다(−3~3 은 간격 1 로 그대로, 1970~2021 은 10 으로 1970~2030).
 */
export const numericAxisOptions = (series: Array<{ data?: unknown[] }>, isMobile: boolean) => {
    const xs = series.flatMap(sr => (sr.data || []).map(d => Number((d as { x?: unknown } | null)?.x))).filter(Number.isFinite);
    if (xs.length === 0) return { type: 'numeric' };
    const lo = Math.min(...xs), hi = Math.max(...xs);
    if (hi === lo) return { type: 'numeric', min: lo - 1, max: hi + 1, tickAmount: 2 };
    const maxTicks = isMobile ? 6 : 10;
    const e = Math.floor(Math.log10(hi - lo));
    let best: { min: number; max: number; n: number; ext: number } | null = null;
    for (let k = e - 2; k <= e + 1; k++) {
        for (const m of [1, 2, 5]) {
            const step = m * Math.pow(10, k);
            const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
            const n = Math.round((max - min) / step);
            if (n < 2 || n > maxTicks) continue;
            const ext = (max - min) - (hi - lo);
            if (!best || ext < best.ext - 1e-9 || (Math.abs(ext - best.ext) <= 1e-9 && n < best.n)) best = { min, max, n, ext };
        }
    }
    return best ? { type: 'numeric', min: best.min, max: best.max, tickAmount: best.n } : { type: 'numeric', min: lo, max: hi, tickAmount: isMobile ? 4 : 6 };
};

/** numeric 축 눈금 표기 — 눈금이 깔끔한 간격이라 소수 넷째 자리 반올림이면 정확하다(부동소수 0.30000000000000004 정리) */
export const numericTickLabel = (value: unknown): string => {
    const n = Number(value);
    return Number.isFinite(n) ? String(Number(n.toFixed(4))) : String(value);
};
