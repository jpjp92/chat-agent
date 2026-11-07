import React, { useEffect, useRef, useMemo } from 'react';
import ApexCharts from 'apexcharts';
import { numericAxisOptions, numericTickLabel, resolveXAxis, type XScale } from './chart-axis';
import { formatAxisValue, formatTooltipValue, markerSize, sanitizeUnit } from './chart-format';

interface ChartData {
    type: 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'radar' | 'treemap' | 'heatmap';
    title?: string;
    data: {
        categories?: string[];
        series: Array<{
            name?: string;
            data: any[];
        }>;
    };
    /** 원자료 단위(명·원·%) — 축약(만·억)은 chart-format 이 한다 */
    yAxis?: { unit?: string };
}

interface ChartRendererProps {
    chartData: ChartData;
    language?: 'ko' | 'en' | 'es' | 'fr';
}

// 다크모드 감지 훅
const useThemeMode = () => {
    const [isDark, setIsDark] = React.useState(false);

    useEffect(() => {
        const checkDarkMode = () => {
            setIsDark(document.documentElement.classList.contains('dark'));
        };
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return isDark;
};

// 화면 너비 감지 훅
const useScreenWidth = () => {
    const [width, setWidth] = React.useState(() =>
        typeof window !== 'undefined' ? window.innerWidth : 1280
    );
    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return width;
};

// 세련된 색상 팔레트
const CHART_COLORS = [
    '#6366f1', // 기본 (인디고)
    '#8b5cf6', // 바이올렛
    '#ec4899', // 핑크
    '#10b981', // 에메랄드
    '#f59e0b', // 앰버
    '#3b82f6', // 블루
    '#f43f5e', // 로즈
    '#06b6d4', // 시안
];

/** 범주가 이 개수를 넘을 때만 가로 스크롤 */
const SCROLL_CATEGORY_MIN = 24;

const ChartRenderer: React.FC<ChartRendererProps> = ({ chartData, language = 'ko' }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<ApexCharts | null>(null);
    const isDark = useThemeMode();
    const screenWidth = useScreenWidth();
    const isMobile = screenWidth < 480;
    const isTablet = screenWidth >= 480 && screenWidth < 768;

    const i18n = {
        ko: { title: '데이터 시각화', download: 'PNG 다운로드', unit: '단위' },
        en: { title: 'Data Visualization', download: 'Download PNG', unit: 'Unit' },
        es: { title: 'Visualización de Datos', download: 'Descargar PNG', unit: 'Unidad' },
        fr: { title: 'Visualisation des Données', download: 'Télécharger PNG', unit: 'Unité' }
    };
    const t = i18n[language] || i18n.en;
    const { type, title } = chartData;
    const yUnit = sanitizeUnit(chartData.yAxis?.unit);
    // 부모가 렌더마다 JSON 을 다시 파싱해 새 객체를 넘긴다 — 객체 동일성으로 메모하면 무관한 리렌더마다
    // 차트를 부수고 다시 그려 애니메이션이 반복됐다. 내용 문자열로 메모한다
    const dataKey = JSON.stringify(chartData);
    // 등장 애니메이션은 처음 한 번만 — 테마·화면 폭 변경으로 다시 그릴 때는 바로 그린다
    const hasAnimated = useRef(false);

    // --- 데이터 정규화 (Normalization) ---
    const { series, categories, isPie, isRadar, isTreemap, isHeatmap, xScale } = useMemo(() => {
        const type = chartData.type;
        const isPieType = type === 'pie' || type === 'donut';
        const isRadarType = type === 'radar';
        const isTreemapType = type === 'treemap';
        const isHeatmapType = type === 'heatmap';
        let normSeries: any = [];
        // LLM 이 범주를 숫자로 보내면(변위 [-0.4, …, 0.4]) Apex 가 숫자 축으로 바꿔 눈금을 정수로 반올림하고
        // 끝 구간 선이 어긋난다 — 범주는 문자열로 고정해 받은 그대로 고르게 놓는다
        let normCategories: string[] = (chartData.data?.categories || []).map((c: unknown) =>
            typeof c === 'number' && Number.isFinite(c) ? String(Number(c.toFixed(4))) : String(c));

        if (!chartData.data || !chartData.data.series)
            return { series: [], categories: [], isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType, isHeatmap: isHeatmapType, xScale: 'category' as XScale };

        if (isPieType) {
            const firstSeries = chartData.data.series[0];
            if (Array.isArray(firstSeries.data) && typeof firstSeries.data[0] === 'number') {
                if (chartData.data.series.length === 1) {
                    normSeries = firstSeries.data;
                } else {
                    normSeries = chartData.data.series.map(s => s.data[0] || 0);
                    if (normCategories.length === 0) normCategories = chartData.data.series.map(s => s.name || 'Unnamed');
                }
            } else if (Array.isArray(firstSeries.data) && firstSeries.data[0] && typeof firstSeries.data[0] === 'object' && 'x' in firstSeries.data[0]) {
                // 트리맵과 같은 [{x,y}] 모양도 받는다 — 못 받으면 "series-1 0" 빈 도넛이 나왔다
                normSeries = firstSeries.data.map((d: any) => Number(d?.y) || 0);
                normCategories = firstSeries.data.map((d: any) => String(d?.x ?? ''));
            } else {
                normSeries = [];
            }
        } else if (isTreemapType) {
            const rawSeries = chartData.data.series;
            if (rawSeries.length > 1) {
                // 다중 시리즈 형식: 시리즈 하나 = 트리맵 셀 하나 (name=라벨, data[0]=값)
                normSeries = [{
                    data: rawSeries.map((s: any) => ({
                        x: s.name || 'Unnamed',
                        y: Number(s.data?.[0]) || 0
                    }))
                }];
            } else {
                // 단일 시리즈: data 는 [{x,y}] 객체 또는 categories 와 짝을 이루는 숫자
                normSeries = [{
                    data: (rawSeries[0].data || []).map((d: any, i: number) => {
                        if (typeof d === 'object' && d !== null && 'x' in d) {
                            return { x: String(d.x), y: Number(d.y) || 0 };
                        }
                        return { x: normCategories[i] || `Item ${i + 1}`, y: Number(d) || 0 };
                    })
                }];
            }
        } else if (isHeatmapType) {
            // ApexCharts 히트맵은 **행마다** 시리즈 하나, 각 점은 {x: 열, y: 값} 을 원한다.
            // 다른 차트에서 이미 받는 두 모양을 모두 받는다: {x,y} 객체, 또는 `categories`(열)와
            // 위치로 짝지어지는 숫자 배열.
            const toCell = (v: any): number | null => {
                if (v === null || v === undefined || v === '') return null;
                const n = Number(v);
                return Number.isFinite(n) ? n : null;
            };
            const rows = chartData.data.series.map((s: any, rowIndex: number) => ({
                name: s.name || `Row ${rowIndex + 1}`,
                data: (s.data || []).map((d: any, i: number) => (
                    typeof d === 'object' && d !== null && 'x' in d
                        ? { x: String(d.x), y: toCell(d.y) }
                        : { x: normCategories[i] || `${i + 1}`, y: toCell(d) }
                )),
            }));
            // Apex 는 첫 시리즈를 **맨 아래**에 쌓는다. 뒤집어서 모델이 쓴 순서대로 위에서 아래로
            // 읽히게 한다.
            normSeries = [...rows].reverse();
            // 열 수가 아래 가로 스크롤 폭을 정한다 — 주어지지 않으면 데이터에서 구한다.
            if (normCategories.length === 0) {
                normCategories = [...new Set(rows.flatMap(r => r.data.map((c: any) => c.x)))] as string[];
            }
        } else {
            // 막대/선/산점도/레이더/영역
            let rawSeries = chartData.data.series;
            // 레이더 가드: 겹쳐서 못 읽게 되지 않도록 시리즈 3개로 제한
            if (isRadarType && rawSeries.length > 3) {
                rawSeries = rawSeries.slice(0, 3);
            }
            // 결측(null/undefined/빈값/NaN)은 0으로 바꾸지 않고 null 로 남긴다 — 0 으로 바꾸면 없는 데이터가
            // "0%" 직선으로 그려진다. ApexCharts 는 null 을 선 끊김(gap)으로 렌더하므로 모르는 구간이 그대로
            // 보인다. 진짜 0 은 그대로 0 이다.
            const toY = (v: any): number | null => {
                if (v === null || v === undefined || v === '') return null;
                const n = Number(v);
                return Number.isFinite(n) ? n : null;
            };
            const mapped = rawSeries.map(s => ({
                name: s.name,
                data: (s.data || []).map(d => {
                    if (typeof d === 'object' && d !== null) {
                        return { x: d.x, y: toY(d.y) };
                    }
                    return toY(d);
                })
            }));
            // 프롬프트 규칙("흩어진 수치로 차트 금지")을 모델이 어겨 null 투성이 선이 나왔다(점 1~2개짜리 시리즈).
            // 선·영역은 값 2개 미만 시리즈를 빼고, 남은 시리즈 중 값 3개 이상이 하나도 없으면 그리지 않는다 — 본문이 이미 수치를 말한다
            const filled = (sr: { data: any[] }) => sr.data.filter(v => v !== null && (typeof v !== 'object' || v.y !== null)).length;
            normSeries = (type === 'line' || type === 'area') ? mapped.filter(sr => filled(sr) >= 2) : mapped;
            if ((type === 'line' || type === 'area') && !normSeries.some((sr: any) => filled(sr) >= 3)) normSeries = [];
        }

        // x 축이 실제 좌표인지 범주인지 — 숫자 x 를 범주로 놓으면 간격이 사라진다(PLAN_CHART_AXIS_261105)
        let xScale: XScale = 'category';
        if (!isPieType && !isTreemapType && !isHeatmapType && !isRadarType && normSeries.length > 0) {
            const ax = resolveXAxis(type, normSeries, normCategories);
            normSeries = ax.series; normCategories = ax.categories; xScale = ax.scale;
        }

        // 카테고리 안전장치
        // numeric 축(산점도 포함)엔 가짜 범주를 주지 않는다 — 눈금이 "1..n" 으로 덮인다
        if (!isPieType && !isTreemapType && !isHeatmapType && xScale !== 'numeric' && normCategories.length === 0 && normSeries.length > 0) {
            const dataLength = normSeries[0].data?.length || 0;
            if (dataLength > 0) {
                normCategories = Array.from({ length: dataLength }, (_, i) => `${i + 1}`);
            }
        }

        return { series: normSeries, categories: normCategories, isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType, isHeatmap: isHeatmapType, xScale };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataKey]);

    useEffect(() => {
        if (series.length === 0) return;

        // 반응형 값 계산
        const baseHeight     = isMobile ? 200 : isTablet ? 250 : 300;
        // 히트맵 행은 고정 높이 셀이다 — 행이 많으면 기본 캔버스가 라벨이 겹칠 때까지 셀을 눌러
        // 버리므로, 행 수에 맞춰 캔버스를 키운다.
        const chartHeight    = isHeatmap
            ? Math.max(baseHeight, series.length * (isMobile ? 32 : 44) + 80)
            : baseHeight;
        const xFontSize      = isMobile ? '8px': isTablet ? '10px': '11px';
        const xRotate        = isMobile ? -55  : -45;
        const yFontSize      = isMobile ? '9px': isTablet ? '10px': '12px';
        const legendFontSize = isMobile ? '10px': '12px';
        const legendAlign    = (isMobile || series.length > 3) ? 'left' : 'center';
        const donutValueSize = isMobile ? '14px': isTablet ? '17px': '20px';
        // 레이더 라벨은 다각형 꼭짓점에 놓여 캔버스 밖으로 나간다.
        // 가로 패딩을 넉넉히 잡아 라벨이 잘리지 않게 한다.
        const gridPadding    = isRadar
            ? { top: 10, right: isMobile ? 50 : 80, bottom: 20, left: isMobile ? 50 : 80 }
            : isMobile
            // numeric 축은 끝 눈금이 데이터 끝과 같아 끝 라벨·마커가 카드 밖으로 잘린다 — 오른쪽 여백을 더 준다
            // 아래 8 은 x 라벨을 4px 내린 만큼 — Apex 는 라벨 offsetY 를 높이에 넣지 않아 회전 없는 라벨이 잘린다
            // 왼쪽 8 — 범주 축 선은 첫 점이 그래프 왼쪽 끝에 붙어 y 라벨을 넘어가 보였다(11-07)
            ? { top: 0, right: xScale === 'numeric' ? 16 : 8, bottom: 8, left: 8 }
            : { top: 0, right: xScale === 'numeric' ? 24 : 20, bottom: 0, left: 10 };
        // 레이더 다각형 반지름: 라벨이 그리드 패딩 안에 들어오도록 작게
        const radarSize      = isMobile ? 60 : isTablet ? 80 : 100;

        const numericXaxis = xScale === 'numeric' ? numericAxisOptions(series, isMobile) : {};

        const options: any = {
            chart: {
                type: type,
                height: chartHeight,
                // 선·영역에 같은 색의 옅은 그림자 — 카드 배경 위에서 선이 떠 보이게(장식이라 값 읽기와 무관)
                dropShadow: (type === 'line' || type === 'area')
                    ? { enabled: true, top: 4, left: 0, blur: 6, opacity: isDark ? 0.35 : 0.18, color: CHART_COLORS[0] }
                    : { enabled: false },
                width: '100%',
                fontFamily: 'Inter, sans-serif',
                background: 'transparent',
                toolbar: { show: false },
                animations: {
                    enabled: !hasAnimated.current,
                    easing: 'easeinout',
                    speed: 800,
                }
            },
            theme: {
                mode: isDark ? 'dark' : 'light',
                palette: 'palette1'
            },
            // 행렬은 **연속 척도 하나**가 필요하다(행마다 다른 색이 아니라) — 그렇지 않으면 색이
            // 값의 크기가 아니라 셀이 몇 번째 행인지를 나타낸다.
            colors: isHeatmap ? [CHART_COLORS[0]] : CHART_COLORS,
            series: series,
            xaxis: {
                // 히트맵 열은 각 점의 `x` 에서 오므로 라벨 대신 **빈 배열**을 넘긴다. 여기서 undefined 는
                // 절대 넘기지 않는다: ApexCharts 가 여러 곳에서 가드 없이 `.categories.length` 를 읽어
                // undefined 면 렌더 전체가 죽고 빈 차트 카드만
                // 남는다.
                categories: isHeatmap || xScale === 'numeric' ? [] : categories,
                ...numericXaxis,
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        // 레이더 라벨은 축 꼭짓점에 놓인다 — 글꼴을 줄여 겹침 방지
                        fontSize: isRadar ? (isMobile ? '8px' : '10px') : xFontSize,
                    },
                    // 레이더 라벨은 회전하면 안 된다(다각형 둘레에 배치됨)
                    rotate: isRadar || xScale === 'numeric' ? 0 : xRotate,
                    // 모바일은 y축 맨 아래 라벨과 x 첫 라벨이 0.6px 로 맞닿는다(11-07) — x 라벨을 내린다
                    offsetY: isMobile && !isRadar ? 4 : 0,
                    hideOverlappingLabels: true,
                    // numeric 축 눈금은 깔끔한 간격(chart-axis) 그대로 — 범주 문자열은 그대로
                    formatter: (value: any) => (xScale === 'numeric' ? numericTickLabel(value) : value),
                },
                axisBorder: { show: !isRadar, color: isDark ? '#334155' : '#e2e8f0' },
                // 모바일은 x 첫 눈금선이 y 맨 아래 라벨(1,300) 바로 옆으로 내려와 붙어 보인다(11-07) — 눈금선은 숨기고 라벨만
                axisTicks: { show: !isMobile && !isRadar },
                // numeric 축 호버 때 축 아래에 뜨는 큰 x값 상자 — 툴팁 머리에 같은 값이 이미 있다
                tooltip: { enabled: false },
            },
            yaxis: {
                // 레이더 y축 라벨(동심원 값)은 가운데를 어지럽힌다 — 숨김
                show: !isRadar,
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#64748b', fontSize: yFontSize },
                    // 히트맵 y 라벨은 크기가 아니라 **행 이름**이다 — 'k' 단축을 적용하면 이름이 숫자인
                    // 행이 깨진다. undefined 를 넘기지 말고 라벨을 그대로
                    // 돌려준다(위 xaxis 메모 참고).
                    formatter: (value: any) => {
                        if (isHeatmap) return value;
                        return formatAxisValue(value, language, yUnit);
                    }
                }
            },
            grid: {
                borderColor: isDark ? '#334155' : '#e2e8f0',
                strokeDashArray: 4,
                padding: gridPadding,
            },
            dataLabels: isTreemap
                ? {
                    enabled: true,
                    style: {
                        fontSize: isMobile ? '10px' : '12px',
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: '600',
                        colors: ['#fff'],
                    },
                    formatter: (text: string, op: any) =>
                        [text, op.value?.toLocaleString()],
                }
                : isHeatmap
                ? {
                    enabled: true,
                    style: {
                        fontSize: isMobile ? '9px' : '11px',
                        fontFamily: 'Inter, sans-serif',
                        fontWeight: '600',
                        colors: ['#fff'],
                    },
                    formatter: (value: number | null) =>
                        value === null || value === undefined ? '' : value.toLocaleString(),
                }
                : { enabled: false },
            legend: {
                // 단색 히트맵 범례는 같은 색 견본 옆에 행 이름만 늘어놓아
                // 아무 정보가 없다 — 행 이름은 이미 y축에 있다.
                show: !isHeatmap,
                position: 'bottom',
                horizontalAlign: legendAlign,
                fontSize: legendFontSize,
                labels: { colors: isDark ? '#e2e8f0' : '#334155' }
            },
            // 산점도·결측 선·점 적은 numeric 선만 점 표시 — 규칙은 chart-format markerSize
            // 호버한 점은 키워 테두리를 준다 — 어느 점을 읽는지 보이게
            markers: {
                size: markerSize(type, xScale, series),
                strokeColors: isDark ? '#1e293b' : '#ffffff',
                hover: { size: isMobile ? 5 : 6 },
            },
            // 툴팁은 축약 없이 원본 수치 + 단위(1,006,645명). 히트맵은 Apex 기본(행·열 이름이 함께 나온다)
            // 호버 툴팁은 Apex 기본(12px·넓은 여백)이 카드에 비해 커서 줄인다. 히트맵은 값 포맷만 Apex 기본
            tooltip: {
                style: { fontSize: isMobile ? '10px' : '11px' },
                ...(isHeatmap ? {} : { y: { formatter: (v: unknown) => formatTooltipValue(v, yUnit) } }),
            },
            stroke: {
                show: true,
                width: (isPie || isTreemap || isHeatmap) ? 0 : 3,
                // 'smooth' 는 점마다 접선을 수평으로 둬 직선 데이터(F = −kx 등)도 계단 물결이 된다 —
                // monotoneCubic 은 직선은 직선으로, 극값에서 넘치지 않는다
                // numeric 축은 straight — Apex 의 monotoneCubic 이 숫자 축에서 데이터 최솟값 아래로 꺼진다
                // (0,1,4,100 이 x=1 직후 0 아래로 2.4px, PLAN_CHART_AXIS_261105 §2). 범주 축은 매끄럽게 유지
                curve: xScale === 'numeric' ? 'straight' : 'monotoneCubic'
            },
            plotOptions: {
                bar: { borderRadius: 4, columnWidth: '60%' },
                pie: {
                    donut: {
                        size: '65%',
                        labels: {
                            show: true,
                            value: { fontSize: donutValueSize, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }
                        }
                    }
                },
                treemap: {
                    distributed: true,
                    enableShades: false
                },
                heatmap: {
                    radius: 4,
                    // 한 색을 값 크기로 음영 처리해 색이 "얼마나"를 뜻하게 하고, 범위는 Apex 가
                    // 데이터에서 구하게 둔다 — 값의 범위를 미리 알 수 없다.
                    enableShades: true,
                    shadeIntensity: 0.6,
                    useFillColorAsStroke: false,
                },
                radar: {
                    size: radarSize,
                    offsetY: -10,
                    polygons: {
                        strokeColors: isDark ? '#334155' : '#e2e8f0',
                        connectorColors: isDark ? '#334155' : '#e2e8f0',
                    }
                }
            }
        };

        if (isPie) {
            options.labels = categories;
        }

        if (chartInstance.current) {
            chartInstance.current.destroy();
        }

        if (chartRef.current) {
            const chart = new ApexCharts(chartRef.current, options);
            chart.render();
            chartInstance.current = chart;
            hasAnimated.current = true;
        }

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
                chartInstance.current = null;
            }
        };
    }, [series, categories, isPie, isDark, type, title, isTreemap, isHeatmap, isMobile, isTablet, xScale, yUnit, language]);

    const handleDownload = async () => {
        if (!chartInstance.current) return;
        try {
            const { imgURI } = await (chartInstance.current as any).dataURI();
            const a = document.createElement('a');
            a.href = imgURI;
            a.download = `${title || 'chart'}.png`;
            a.click();
        } catch {
            (chartInstance.current as any).exportToSVG();
        }
    };

    if (series.length === 0) return null;
    const dataCount = categories.length;
    // 가로 스크롤은 범주 축만 — numeric 축(함수·산점도)은 점 개수와 무관하게 전체 범위를 한 화면에
    // 12개월 같은 범주는 스크롤 없이 한 화면에 — 라벨은 Apex 가 회전·겹침 숨김으로 솎는다. 스크롤은 축이 너무 빽빽할 때만
    //   (11-07 모바일: 12개월이 스크롤되며 오른쪽 절반이 잘리고 y축이 같이 밀려났다)
    const scrolls = xScale !== 'numeric' && dataCount > SCROLL_CATEGORY_MIN;
    const chartMinWidth = scrolls ? dataCount * 28 : '100%';

    return (
        <div className="w-full my-4 sm:my-6 lg:my-8 animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
            <div className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white dark:bg-white/[0.07] dark:backdrop-blur-xl shadow-2xl shadow-slate-200/30 dark:shadow-none relative overflow-hidden flex flex-col group">

                {/* 헤더 */}
                {/* 좌우 여백은 카드 모서리(rounded-[2rem] = 32px) 곡선 안쪽으로 둔다 — 그보다 좁으면 점·다운로드
                    아이콘이 곡선 구간에 걸려 가장자리에 붙어 보인다. 다른 카드 헤더(Chemical px-4 sm:px-6 · Diagram px-5)와 같은 범위. */}
                <div className="px-5 sm:px-6 py-2.5 border-b border-slate-50 dark:border-white/5 flex items-center justify-between gap-3 bg-slate-50/30 dark:bg-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0"></div>
                        <h3 className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate leading-none">
                            {title || t.title}
                        </h3>
                        {yUnit && (
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-none whitespace-nowrap flex-shrink-0">
                                · {t.unit}: {yUnit}
                            </span>
                        )}
                    </div>
                    {/* p-2 -m-2: 터치 영역은 ~26px 로 넓히되 아이콘 위치는 헤더 여백선에 그대로 둔다. */}
                    <button
                        onClick={handleDownload}
                        className="flex items-center justify-center text-slate-400 hover:text-indigo-500 transition-colors p-2 -m-2 flex-shrink-0"
                        title={t.download}
                        aria-label={t.download}
                    >
                        <i className="fa-solid fa-download text-[10px] leading-none"></i>
                    </button>
                </div>

                {/* 차트 영역 */}
                <div className="p-2 sm:p-4 flex-1 relative min-h-[220px] sm:min-h-[270px] lg:min-h-[320px]">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    <div className={`w-full ${scrolls ? 'overflow-x-auto custom-scrollbar' : 'overflow-x-hidden'} overflow-y-hidden`}>
                        <div style={{ minWidth: chartMinWidth, width: '100%' }}>
                            <div ref={chartRef} className="w-full" />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ChartRenderer;
