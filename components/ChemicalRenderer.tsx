import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import SmilesDrawer from 'smiles-drawer';

interface ChemicalRendererProps {
    smiles: string;
    name?: string;
    width?: number;
    height?: number;
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

const ChemicalRenderer: React.FC<ChemicalRendererProps> = ({ smiles, name, width = 600, height = 300, language = 'ko' }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [drawer, setDrawer] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const isDark = useThemeMode();

    const i18n = {
        ko: { smiles: 'SMILES', copy: '복사', copied: '복사됨', structure: '분자 구조', error: '오류' },
        en: { smiles: 'SMILES', copy: 'COPY', copied: 'COPIED', structure: 'Molecular Structure', error: 'Error' },
        es: { smiles: 'SMILES', copy: 'COPIAR', copied: 'COPIADO', structure: 'Estructura Molecular', error: 'Error' },
        fr: { smiles: 'SMILES', copy: 'COPIER', copied: 'COPIÉ', structure: 'Structure Moléculaire', error: 'Erreur' }
    };
    const t = i18n[language] || i18n.en;

    // 1. SvgDrawer 초기화
    useEffect(() => {
        const options = {
            width: width,
            height: height,
            bondThickness: 2.0,
            bondLength: 35.0,
            shortBondLength: 0.85,
            bondSpacing: 0.18 * 35.0,
            atomVisualization: 'default',
            isometric: true,
            debug: false,
            terminalCarbons: true,
            explicitHydrogens: true,
            overlapSensitivity: 0.42,
            overlapResolutionIterations: 2,
            compactDrawing: false,
            fontSizeLarge: 16,
            fontSizeSmall: 12,
            padding: 20,
            experimental: false,
            themes: {
                dark: {
                    C: '#fff', O: '#ef4444', N: '#3b82f6', F: '#34d399', CL: '#10b981',
                    BR: '#f59e0b', I: '#a855f7', P: '#f59e0b', S: '#fbbf24', B: '#f59e0b',
                    SI: '#94a3b8', H: '#fff', BACKGROUND: 'transparent'
                },
                light: {
                    C: '#222', O: '#ef4444', N: '#3b82f6', F: '#34d399', CL: '#10b981',
                    BR: '#f59e0b', I: '#a855f7', P: '#f59e0b', S: '#fbbf24', B: '#f59e0b',
                    SI: '#64748b', H: '#222', BACKGROUND: 'transparent'
                }
            }
        };

        try {
            const d = new SmilesDrawer.SvgDrawer(options);
            setDrawer(d);
        } catch (e: any) {
            console.error('[ChemicalRenderer] Failed to init SvgDrawer:', e);
            setError('Renderer Init Failed');
        }
    }, [width, height]);

    // 2. 그리기 - isDark 의존성 추가
    useEffect(() => {
        if (!drawer || !svgRef.current || !smiles) return;

        const theme = isDark ? 'dark' : 'light';

        // 이전 자식 요소(이미 그려진 내용) 삭제
        while (svgRef.current.firstChild) {
            svgRef.current.removeChild(svgRef.current.firstChild);
        }

        SmilesDrawer.parse(smiles, (tree: any) => {
            try {
                drawer.draw(tree, svgRef.current, theme);
                setError(null);
            } catch (drawErr: any) {
                console.error('[ChemicalRenderer] Draw Error:', drawErr);
                setError('Invalid Chemical Structure');
            }
        }, (parseErr: any) => {
            console.error('[ChemicalRenderer] Parse Error:', parseErr);
            setError('Invalid SMILES Code');
        });

    }, [smiles, drawer, isDark]); // 테마 변경 시 다시 그리도록 isDark 추가

    const handleCopy = () => {
        navigator.clipboard.writeText(smiles);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        if (!svgRef.current || !smiles || !drawer) return;

        // 원활한 문서 활용을 위해 다운로드용 SVG는 항상 'light' 테마(검은색 선)로 다시 그려서 내보냅니다.
        // 또는 배경색을 포함하여 내보내기 위해 임시 캔버스를 사용합니다.
        const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        tempSvg.setAttribute("width", width.toString());
        tempSvg.setAttribute("height", height.toString());

        SmilesDrawer.parse(smiles, (tree: any) => {
            try {
                // 다운로드용은 항상 투명 배경 대신 흰색 배경을 넣거나, 라이트 테마로 그립니다.
                drawer.draw(tree, tempSvg, 'light');

                // 배경색 사각형 추가 (다운로드한 파일이 어디서든 잘 보이도록)
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("width", "100%");
                rect.setAttribute("height", "100%");
                rect.setAttribute("fill", "white");
                tempSvg.insertBefore(rect, tempSvg.firstChild);

                const svgData = new XMLSerializer().serializeToString(tempSvg);
                const svgBlob = new Blob(['<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + svgData], { type: "image/svg+xml;charset=utf-8" });
                const svgUrl = URL.createObjectURL(svgBlob);
                const downloadLink = document.createElement("a");
                downloadLink.href = svgUrl;
                downloadLink.download = `${name || 'molecule'}.svg`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(svgUrl);
            } catch (e) {
                console.error("Download render error:", e);
            }
        });
    };

    return (
        <div className="w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-xl shadow-slate-200/40 dark:shadow-none relative overflow-hidden flex flex-col group">

                {/* Header */}
                {(name || error) && (
                    <div className="px-4 sm:px-6 py-4 border-b border-slate-50 dark:border-white/5 flex items-start justify-between bg-slate-50/30 dark:bg-transparent">
                        <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0 animate-pulse"></div>
                            <h3 className="text-[12px] sm:text-[14px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight break-all sm:break-keep line-clamp-2 leading-relaxed">
                                {name || (error ? t.error : t.structure)}
                            </h3>
                        </div>
                        {!error && (
                            <button
                                onClick={handleDownload}
                                className="text-slate-400 hover:text-indigo-500 transition-colors p-1 flex-shrink-0 ml-2"
                                title="Download SVG"
                            >
                                <i className="fa-solid fa-download text-xs"></i>
                            </button>
                        )}
                    </div>
                )}

                {/* Structure Area */}
                <div className="p-8 flex flex-col items-center justify-center min-h-[200px] relative">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-500/5 via-emerald-500/5 to-cyan-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    {error ? (
                        <div className="flex flex-col items-center gap-3 text-red-400 p-4">
                            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <span className="text-sm font-semibold tracking-tight">{error}</span>
                        </div>
                    ) : (
                        <div className="relative w-full flex justify-center">
                            <div className="w-full max-w-3xl">
                                <svg
                                    ref={svgRef}
                                    viewBox={`0 0 ${width} ${height}`}
                                    width="100%"
                                    height="auto"
                                    preserveAspectRatio="xMidYMid meet"
                                    className="transition-all duration-700 hover:scale-[1.02]"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Info & Code Footer */}
                <div className="border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-black/20 px-4 sm:px-5 py-3">
                    <div className="flex items-center justify-between gap-2 sm:gap-4">
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold text-slate-400 hover:text-indigo-500 transition-all flex-shrink-0"
                        >
                            <i className={`fa-solid ${isExpanded ? 'fa-square-minus' : 'fa-square-plus'} text-[12px] sm:text-[13px] opacity-70`}></i>
                            <span className="truncate uppercase">{t.smiles}</span>
                        </button>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={handleCopy}
                                className={`text-[10px] sm:text-[11px] font-bold flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all duration-300 ${copied
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                    : 'bg-white dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10 hover:border-indigo-500 hover:text-indigo-500'
                                    }`}
                            >
                                <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                                <span>{copied ? t.copied : t.copy}</span>
                            </button>
                        </div>
                    </div>

                    {isExpanded && (
                        <div className="mt-3 animate-in slide-in-from-top-2 duration-300">
                            <div className="p-4 bg-white dark:bg-black/40 rounded-2xl border border-slate-200/60 dark:border-white/5 shadow-inner select-all">
                                <code className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all leading-relaxed block max-h-[120px] overflow-y-auto custom-scrollbar">
                                    {smiles}
                                </code>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChemicalRenderer;
