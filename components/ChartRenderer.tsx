import React, { useEffect, useRef, useMemo } from 'react';
import ApexCharts from 'apexcharts';

interface ChartData {
    type: 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'radar' | 'treemap';
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

    const i18n = {
        ko: { title: '데이터 시각화', download: 'SVG 다운로드' },
        en: { title: 'Data Visualization', download: 'Download SVG' },
        es: { title: 'Visualización de Datos', download: 'Descargar SVG' },
        fr: { title: 'Visualisation des Données', download: 'Télécharger SVG' }
    };
    const t = i18n[language] || i18n.en;
    const { type, title, data } = chartData;

    // --- 데이터 정규화 (Normalization) ---
    const { series, categories, isPie, isRadar, isTreemap } = useMemo(() => {
        const type = chartData.type;
        const isPieType = type === 'pie' || type === 'donut';
        const isRadarType = type === 'radar';
        const isTreemapType = type === 'treemap';
        let normSeries: any = [];
        let normCategories: string[] = chartData.data?.categories || [];

        if (!chartData.data || !chartData.data.series)
            return { series: [], categories: [], isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType };

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
            normSeries = [{
                data: (chartData.data.series[0].data || []).map((d: any, i: number) => ({
                    x: normCategories[i] || `Item ${i + 1}`,
                    y: Number(d) || 0
                }))
            }];
        } else {
            // Bar/Line/Scatter/Radar/Area
            normSeries = chartData.data.series.map(s => ({
                name: s.name,
                data: (s.data || []).map(d => {
                    if (typeof d === 'object' && d !== null) {
                        return { x: d.x, y: Number(d.y) || 0 };
                    }
                    return Number(d) || 0;
                })
            }));
        }

        // 카테고리 안전장치
        if (!isPieType && !isTreemapType && normCategories.length === 0 && normSeries.length > 0) {
            const dataLength = normSeries[0].data?.length || 0;
            if (dataLength > 0) {
                normCategories = Array.from({ length: dataLength }, (_, i) => `${i + 1}`);
            }
        }

        return { series: normSeries, categories: normCategories, isPie: isPieType, isRadar: isRadarType, isTreemap: isTreemapType };
    }, [chartData]);

    useEffect(() => {
        if (series.length === 0) return;

        const options: any = {
            chart: {
                type: type,
                height: 320,
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
            colors: CHART_COLORS,
            series: series,
            xaxis: {
                categories: categories,
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        fontSize: '11px'
                    },
                    rotate: -45,
                    hideOverlappingLabels: true,
                },
                axisBorder: { show: true, color: isDark ? '#334155' : '#e2e8f0' }
            },
            yaxis: {
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#64748b' },
                    formatter: (value: number) => {
                        if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                        return value;
                    }
                }
            },
            grid: {
                borderColor: isDark ? '#334155' : '#e2e8f0',
                strokeDashArray: 4,
                padding: { top: 0, right: 20, bottom: 0, left: 10 }
            },
            dataLabels: { enabled: false },
            legend: {
                position: 'bottom',
                labels: { colors: isDark ? '#e2e8f0' : '#334155' }
            },
            stroke: {
                show: true,
                width: (isPie || isTreemap) ? 0 : 3,
                curve: 'smooth'
            },
            plotOptions: {
                bar: { borderRadius: 4, columnWidth: '60%' },
                pie: {
                    donut: {
                        size: '65%',
                        labels: {
                            show: true,
                            value: { fontSize: '20px', fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }
                        }
                    }
                },
                treemap: {
                    distributed: true,
                    enableShades: false
                },
                radar: {
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
    }, [series, categories, isPie, isDark, type, title, isTreemap]);

    const handleDownload = () => {
        if (chartInstance.current) {
            (chartInstance.current as any).exportToSVG();
        }
    };

    const dataCount = categories.length;
    const chartMinWidth = dataCount > 10 ? Math.max(600, dataCount * 40) : '100%';

    return (
        <div className="w-full my-8 animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
            <div className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white dark:bg-[#1e1e1f] shadow-2xl shadow-slate-200/30 dark:shadow-none relative overflow-hidden flex flex-col group">

                {/* Header */}
                <div className="px-4 sm:px-6 py-4 border-b border-slate-50 dark:border-white/5 flex items-start justify-between bg-slate-50/30 dark:bg-transparent">
                    <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm mt-1.5 flex-shrink-0"></div>
                        <h3 className="text-[12px] sm:text-[14px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight break-all sm:break-keep line-clamp-2 leading-relaxed">
                            {title || t.title}
                        </h3>
                    </div>
                    <button
                        onClick={handleDownload}
                        className="text-slate-400 hover:text-indigo-500 transition-colors p-1 flex-shrink-0 ml-2"
                        title={t.download}
                    >
                        <i className="fa-solid fa-download text-xs"></i>
                    </button>
                </div>

                {/* Chart Area */}
                <div className="p-5 flex-1 relative min-h-[340px]">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                        <div style={{ minWidth: chartMinWidth, width: '100%' }}>
                            <div ref={chartRef} className="w-full" />
                        </div>
                    </div>

                    {dataCount > 10 && (
                        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white dark:from-[#1e1e1f] to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChartRenderer;
