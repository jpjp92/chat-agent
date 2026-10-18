import React, { useEffect, useRef, useMemo } from 'react';
import ApexCharts from 'apexcharts';

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

const ChartRenderer: React.FC<ChartRendererProps> = ({ chartData, language = 'ko' }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<ApexCharts | null>(null);
    const isDark = useThemeMode();
    const screenWidth = useScreenWidth();
    const isMobile = screenWidth < 480;
    const isTablet = screenWidth >= 480 && screenWidth < 768;

    const i18n = {
        ko: { title: '데이터 시각화', download: 'PNG 다운로드' },
        en: { title: 'Data Visualization', download: 'Download PNG' },
        es: { title: 'Visualización de Datos', download: 'Descargar PNG' },
        fr: { title: 'Visualisation des Données', download: 'Télécharger PNG' }
    };
    const t = i18n[language] || i18n.en;
    const { type, title } = chartData;

    // --- 데이터 정규화 (Normalization) ---
    const { series, categories, isPie, isRadar, isTreemap, isHeatmap } = useMemo(() => {
        const type = chartData.type;
        const isPieType = type === 'pie' || type === 'donut';
        const isRadarType = type === 'radar';
        const isTreemapType = type === 'treemap';
        const isHeatmapType = type === 'heatmap';
        let normSeries: any = [];
        let normCategories: string[] = chartData.data?.categories || [];

        if (!chartData.data || !chartData.data.series)
            return { series: [], categories: [], isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType, isHeatmap: isHeatmapType };

        if (isPieType) {
            const firstSeries = chartData.data.series[0];
            if (Array.isArray(firstSeries.data) && typeof firstSeries.data[0] === 'number') {
                if (chartData.data.series.length === 1) {
                    normSeries = firstSeries.data;
                } else {
                    normSeries = chartData.data.series.map(s => s.data[0] || 0);
                    if (normCategories.length === 0) normCategories = chartData.data.series.map(s => s.name || 'Unnamed');
                }
            } else {
                normSeries = [0, 0, 0];
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
            normSeries = rawSeries.map(s => ({
                name: s.name,
                data: (s.data || []).map(d => {
                    if (typeof d === 'object' && d !== null) {
                        return { x: d.x, y: toY(d.y) };
                    }
                    return toY(d);
                })
            }));
        }

        // 카테고리 안전장치
        if (!isPieType && !isTreemapType && !isHeatmapType && normCategories.length === 0 && normSeries.length > 0) {
            const dataLength = normSeries[0].data?.length || 0;
            if (dataLength > 0) {
                normCategories = Array.from({ length: dataLength }, (_, i) => `${i + 1}`);
            }
        }

        return { series: normSeries, categories: normCategories, isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType, isHeatmap: isHeatmapType };
    }, [chartData]);

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
            ? { top: 0, right: 8, bottom: 0, left: 0 }
            : { top: 0, right: 20, bottom: 0, left: 10 };
        // 레이더 다각형 반지름: 라벨이 그리드 패딩 안에 들어오도록 작게
        const radarSize      = isMobile ? 60 : isTablet ? 80 : 100;

        const options: any = {
            chart: {
                type: type,
                height: chartHeight,
                width: '100%',
                fontFamily: 'Inter, sans-serif',
                background: 'transparent',
                toolbar: { show: false },
                animations: {
                    enabled: true,
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
                categories: isHeatmap ? [] : categories,
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        // 레이더 라벨은 축 꼭짓점에 놓인다 — 글꼴을 줄여 겹침 방지
                        fontSize: isRadar ? (isMobile ? '8px' : '10px') : xFontSize,
                    },
                    // 레이더 라벨은 회전하면 안 된다(다각형 둘레에 배치됨)
                    rotate: isRadar ? 0 : xRotate,
                    hideOverlappingLabels: true,
                },
                axisBorder: { show: !isRadar, color: isDark ? '#334155' : '#e2e8f0' }
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
                        if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                        return value;
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
            stroke: {
                show: true,
                width: (isPie || isTreemap || isHeatmap) ? 0 : 3,
                curve: 'smooth'
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
        }

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
                chartInstance.current = null;
            }
        };
    }, [series, categories, isPie, isDark, type, title, isTreemap, isHeatmap, isMobile, isTablet]);

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

    const dataCount = categories.length;
    const chartMinWidth = dataCount > 10 ? Math.max(600, dataCount * 40) : '100%';

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

                    <div className={`w-full ${dataCount > 10 ? 'overflow-x-auto custom-scrollbar' : 'overflow-x-hidden'}`}>
                        <div style={{ minWidth: chartMinWidth, width: '100%' }}>
                            <div ref={chartRef} className="w-full" />
                        </div>
                    </div>

                    {dataCount > 10 && (
                        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white dark:from-slate-900 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChartRenderer;
