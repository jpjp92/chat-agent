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
    '#6366f1', // Primary (Indigo)
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#3b82f6', // Blue
    '#f43f5e', // Rose
    '#06b6d4', // Cyan
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
    const { type, title, data } = chartData;

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
                // Multiple series format: each series = one treemap cell (name=label, data[0]=value)
                normSeries = [{
                    data: rawSeries.map((s: any) => ({
                        x: s.name || 'Unnamed',
                        y: Number(s.data?.[0]) || 0
                    }))
                }];
            } else {
                // Single series: data is [{x,y}] objects or numbers paired with categories
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
            // ApexCharts heatmap wants one series per ROW, each point {x: column, y: value}.
            // Accept both shapes we already accept elsewhere: {x,y} objects, or a plain number
            // array paired positionally with `categories` (the columns).
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
            // Apex stacks the first series at the BOTTOM. Reverse so the matrix reads top-down
            // in the same order the model wrote it.
            normSeries = [...rows].reverse();
            // Columns drive the horizontal-scroll width below; derive them when not supplied.
            if (normCategories.length === 0) {
                normCategories = [...new Set(rows.flatMap(r => r.data.map((c: any) => c.x)))] as string[];
            }
        } else {
            // Bar/Line/Scatter/Radar/Area
            let rawSeries = chartData.data.series;
            // Radar chart guard: cap at 3 series to prevent unreadable overlapping
            if (isRadarType && rawSeries.length > 3) {
                rawSeries = rawSeries.slice(0, 3);
            }
            // 결측(null/undefined/빈값/NaN)은 **0으로 바꾸지 않고 null 로 남긴다**.
            // 예전엔 `Number(d) || 0` 이라 결측이 전부 0이 됐고, "GDP 성장률 0%" 같은 **없는 데이터가
            // 그려졌다**(실측: 값 3개 + null 20개 → 0에 붙은 평평한 직선). ApexCharts 는 null 을 선 끊김
            // (gap)으로 렌더하므로 "모르는 구간"이 그대로 보인다. 진짜 0 은 그대로 0 으로 남는다.
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
        // Heatmap rows are fixed-height cells: with many rows the default canvas squashes them
        // until the labels collide, so grow the canvas with the row count instead.
        const chartHeight    = isHeatmap
            ? Math.max(baseHeight, series.length * (isMobile ? 32 : 44) + 80)
            : baseHeight;
        const xFontSize      = isMobile ? '8px': isTablet ? '10px': '11px';
        const xRotate        = isMobile ? -55  : -45;
        const yFontSize      = isMobile ? '9px': isTablet ? '10px': '12px';
        const legendFontSize = isMobile ? '10px': '12px';
        const legendAlign    = (isMobile || series.length > 3) ? 'left' : 'center';
        const donutValueSize = isMobile ? '14px': isTablet ? '17px': '20px';
        // Radar labels sit at polygon vertices and extend beyond the canvas edge.
        // Large horizontal padding reserves space so labels are not clipped by overflow.
        const gridPadding    = isRadar
            ? { top: 10, right: isMobile ? 50 : 80, bottom: 20, left: isMobile ? 50 : 80 }
            : isMobile
            ? { top: 0, right: 8, bottom: 0, left: 0 }
            : { top: 0, right: 20, bottom: 0, left: 10 };
        // Radar polygon radius: smaller than before to keep labels inside grid padding bounds
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
            // A matrix needs ONE continuous scale, not a different hue per row — otherwise the
            // colour encodes which row a cell is in rather than how large its value is.
            colors: isHeatmap ? [CHART_COLORS[0]] : CHART_COLORS,
            series: series,
            xaxis: {
                // Heatmap columns come from each point's `x`, so pass the EMPTY array rather than
                // the labels. Never pass undefined here: ApexCharts reads `.categories.length`
                // in several places without a guard, so an undefined kills the whole render and
                // leaves an empty chart card behind.
                categories: isHeatmap ? [] : categories,
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        // Radar labels sit at axis vertices — smaller font prevents overlap
                        fontSize: isRadar ? (isMobile ? '8px' : '10px') : xFontSize,
                    },
                    // Radar labels must not rotate (they're positioned around the polygon)
                    rotate: isRadar ? 0 : xRotate,
                    hideOverlappingLabels: true,
                },
                axisBorder: { show: !isRadar, color: isDark ? '#334155' : '#e2e8f0' }
            },
            yaxis: {
                // Radar yaxis labels (concentric ring values) clutter the center — hide them
                show: !isRadar,
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#64748b', fontSize: yFontSize },
                    // Heatmap y labels are ROW NAMES, not magnitudes — the 'k' shortening
                    // would corrupt any row whose name happens to be numeric. Return the label
                    // untouched instead of passing undefined (see the xaxis note above).
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
                // A single-hue heatmap legend would list row names next to identical swatches,
                // which says nothing — the y-axis already names the rows.
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
                    // Shade one hue by magnitude so the colour means "how much", and let Apex
                    // derive the range from the data — the domain is unknown ahead of time.
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

                {/* Header */}
                {/* Side padding tracks the chart area below (p-2 sm:p-4) so the title starts on the
                    same line as the body at every breakpoint — px-3 sat 4px outside it on desktop
                    and 4px inside it on mobile, so the mismatch flipped direction by breakpoint. */}
                <div className="px-2 sm:px-4 py-1.5 border-b border-slate-50 dark:border-white/5 flex items-center justify-between bg-slate-50/30 dark:bg-white/[0.04]">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0"></div>
                        <h3 className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate leading-none">
                            {title || t.title}
                        </h3>
                    </div>
                    {/* -mr-1 cancels the button's own px-1 so the ICON's optical edge lands on the
                        container padding, matching the dot's gutter on the left. mr-2 put the icon
                        at 24px while the dot sat at 12px — twice the gutter. */}
                    <button
                        onClick={handleDownload}
                        className="flex items-center text-slate-400 hover:text-indigo-500 transition-colors px-1 flex-shrink-0 ml-2 -mr-1"
                        title={t.download}
                    >
                        <i className="fa-solid fa-download text-[9px] leading-none"></i>
                    </button>
                </div>

                {/* Chart Area */}
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
