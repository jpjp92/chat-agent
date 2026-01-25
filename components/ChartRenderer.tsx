import React, { useEffect, useRef, useMemo } from 'react';
import ApexCharts from 'apexcharts';

interface ChartData {
    type: 'bar' | 'line' | 'area' | 'pie' | 'donut';
    title?: string;
    data: {
        categories?: string[];
        series: Array<{
            name?: string;
            data: number[];
        }>;
    };
}

interface ChartRendererProps {
    chartData: ChartData;
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

const ChartRenderer: React.FC<ChartRendererProps> = ({ chartData }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<ApexCharts | null>(null);
    const isDark = useThemeMode();
    const { type, title, data } = chartData;

    // --- 데이터 정규화 (Normalization) - 렌더링 전 수행 ---
    const { series, categories, isPie } = useMemo(() => {
        const isPieType = type === 'pie' || type === 'donut';
        let normSeries: any = [];
        let normCategories: string[] = data?.categories || [];

        if (!data || !data.series) return { series: [], categories: [], isPie: isPieType };

        if (isPieType) {
            const firstSeries = data.series[0];
            if (Array.isArray(firstSeries.data) && typeof firstSeries.data[0] === 'number') {
                if (data.series.length === 1) {
                    normSeries = firstSeries.data;
                } else {
                    normSeries = data.series.map(s => s.data[0] || 0);
                    if (normCategories.length === 0) normCategories = data.series.map(s => s.name || 'Unnamed');
                }
            } else {
                normSeries = [0, 0, 0];
            }
        } else {
            // Bar/Line
            const firstSeries = data.series[0];
            const firstDataPoint = firstSeries.data?.[0];

            if (typeof firstDataPoint === 'object' && firstDataPoint !== null && 'x' in firstDataPoint) {
                if (normCategories.length === 0 && firstSeries.data) {
                    normCategories = (firstSeries.data as any[]).map((d: any) => String(d.x));
                }
                normSeries = data.series.map(s => ({
                    name: s.name,
                    data: (s.data as any[]).map((d: any) => {
                        const val = Number(d.y);
                        return isNaN(val) ? 0 : val;
                    })
                }));
            } else {
                normSeries = data.series.map(s => ({
                    name: s.name,
                    data: (s.data as any[]).map(d => {
                        const val = Number(d);
                        return isNaN(val) ? 0 : val;
                    })
                }));
            }
        }

        // 카테고리 안전장치
        if (!isPieType && (type === 'bar' || type === 'line' || type === 'area') && normCategories.length === 0 && normSeries.length > 0) {
            const dataLength = normSeries[0].data?.length || 0;
            if (dataLength > 0) {
                normCategories = Array.from({ length: dataLength }, (_, i) => `${i + 1}`);
            }
        }

        return { series: normSeries, categories: normCategories, isPie: isPieType };
    }, [data, type]);

    useEffect(() => {
        // 데이터 없으면 중단
        if (series.length === 0) return;

        // 옵션 구성
        const options: any = {
            chart: {
                type: type,
                height: 320,
                width: '100%',
                fontFamily: 'SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
                background: 'transparent',
                toolbar: { show: false },
                animations: {
                    enabled: true,
                    easing: 'easeinout',
                    speed: 800,
                    animateGradually: { enabled: true, delay: 150 },
                    dynamicAnimation: { enabled: true, speed: 350 }
                }
            },
            theme: {
                mode: isDark ? 'dark' : 'light',
                palette: 'palette1'
            },
            colors: CHART_COLORS,
            title: {
                text: title || '',
                align: 'left',
                style: {
                    fontSize: '16px',
                    fontWeight: 700,
                    color: isDark ? '#f1f5f9' : '#1e293b',
                    fontFamily: 'inherit'
                },
                offsetY: 10
            },
            series: series,
            xaxis: {
                categories: categories,
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        fontSize: '11px',
                        fontFamily: 'inherit'
                    },
                    rotate: -45,
                    rotateAlways: false,
                    hideOverlappingLabels: true,
                    trim: true
                },
                axisBorder: {
                    show: true,
                    color: isDark ? '#334155' : '#e2e8f0'
                },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: {
                        colors: isDark ? '#94a3b8' : '#64748b',
                        fontFamily: 'inherit'
                    },
                    formatter: (value: number) => {
                        if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                        return value;
                    }
                }
            },
            grid: {
                borderColor: isDark ? '#334155' : '#e2e8f0',
                strokeDashArray: 4,
                yaxis: { lines: { show: true } },
                xaxis: { lines: { show: false } },
                padding: { top: 0, right: 20, bottom: 0, left: 10 }
            },
            dataLabels: {
                enabled: false
            },
            legend: {
                position: 'bottom',
                offsetY: 8,
                labels: {
                    colors: isDark ? '#e2e8f0' : '#334155'
                },
                itemMargin: { horizontal: 10, vertical: 5 }
            },
            tooltip: {
                theme: isDark ? 'dark' : 'light',
                y: {
                    formatter: (val: number) => val
                },
                style: {
                    fontSize: '12px',
                    fontFamily: 'inherit'
                }
            },
            stroke: {
                show: true,
                width: isPie ? 0 : 3,
                curve: 'smooth',
                colors: isPie ? undefined : ['transparent']
            },
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    columnWidth: '60%',
                    distributed: false
                },
                pie: {
                    donut: {
                        size: '65%',
                        labels: {
                            show: true,
                            name: { show: true, fontSize: '12px', color: isDark ? '#cbd5e1' : '#475569' },
                            value: { show: true, fontSize: '20px', fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' },
                            total: { show: false }
                        }
                    }
                }
            }
        };

        if (isPie) {
            options.stroke.colors = CHART_COLORS;
            options.labels = categories;
        }

        // 기존 차트 파괴 후 재생성
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
    }, [series, categories, isPie, isDark, type, title]); // 의존성 배열에 정규화된 데이터 포함

    // 렌더링
    if (!data || !data.series || series.length === 0) {
        return <div className="p-4 text-red-500 bg-red-50 rounded-lg text-sm">데이터 없음</div>;
    }

    // 동적 너비 계산 (스크롤)
    const dataCount = categories.length;
    // 막대 하나당 40px 정도 확보, 단 최소값은 100%
    const chartMinWidth = dataCount > 10 ? Math.max(600, dataCount * 40) : '100%';

    return (
        <div className="w-full my-6 animate-in fade-in slide-in-from-bottom-3 duration-700 ease-out">
            <div className="p-5 rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg shadow-slate-200/50 dark:shadow-none min-h-[340px] relative overflow-hidden group">

                {/* 배경 장식 */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                {/* 스크롤 가능 영역 */}
                <div className="w-full overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                    <div style={{ minWidth: chartMinWidth, width: '100%' }}>
                        <div ref={chartRef} className="w-full" />
                    </div>
                </div>

                {/* 스크롤 힌트 (우측 페이드) - 데이터 많을 때만 표시 */}
                {dataCount > 10 && (
                    <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white dark:from-[#1e1e1f] to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"></div>
                )}
            </div>
        </div>
    );
};

export default ChartRenderer;
