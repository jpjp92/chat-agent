import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import SmilesDrawer from 'smiles-drawer';

interface ChemicalRendererProps {
    smiles: string;
    name?: string;
    width?: number;
    height?: number;
}

const ChemicalRenderer: React.FC<ChemicalRendererProps> = ({ smiles, name, width = 450, height = 300 }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [drawer, setDrawer] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    // 1. SvgDrawer 초기화
    useEffect(() => {
        const options = {
            width: width,
            height: height,
            bondThickness: 1.2,
            bondLength: 18,
            shortBondLength: 0.85,
            bondSpacing: 0.18 * 18,
            atomVisualization: 'default',
            isometric: true,
            debug: false,
            terminalCarbons: true,
            explicitHydrogens: true,
            overlapSensitivity: 0.42,
            overlapResolutionIterations: 1,
            compactDrawing: false,
            fontSizeLarge: 7,
            fontSizeSmall: 5,
            padding: 10,
            experimental: false,
            themes: {
                dark: {
                    C: '#fff', O: '#ef4444', N: '#3b82f6', F: '#10b981', CL: '#10b981',
                    BR: '#f59e0b', I: '#8b5cf6', P: '#f59e0b', S: '#fbbf24', B: '#f59e0b',
                    SI: '#f59e0b', H: '#fff', BACKGROUND: 'transparent'
                },
                light: {
                    C: '#222', O: '#ef4444', N: '#3b82f6', F: '#10b981', CL: '#10b981',
                    BR: '#f59e0b', I: '#8b5cf6', P: '#f59e0b', S: '#fbbf24', B: '#f59e0b',
                    SI: '#f59e0b', H: '#222', BACKGROUND: 'transparent'
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

    // 2. 그리기
    useEffect(() => {
        if (!drawer || !svgRef.current || !smiles) return;

        const isDark = document.documentElement.classList.contains('dark');
        const theme = isDark ? 'dark' : 'light';

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

    }, [smiles, drawer]);

    const handleCopy = () => {
        navigator.clipboard.writeText(smiles);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        if (!svgRef.current) return;
        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = svgUrl;
        downloadLink.download = `${name || 'molecule'}.svg`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
    };

    return (
        <div className="w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-xl shadow-slate-200/40 dark:shadow-none relative overflow-hidden flex flex-col group">

                {/* Header */}
                {(name || error) && (
                    <div className="px-6 py-4 border-b border-slate-50 dark:border-white/5 flex items-center justify-between bg-slate-50/30 dark:bg-transparent">
                        <div className="flex items-center gap-2.5">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                            <h3 className="text-[14px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">
                                {name || (error ? 'Error' : 'Molecular Structure')}
                            </h3>
                        </div>
                        {!error && (
                            <button
                                onClick={handleDownload}
                                className="text-slate-400 hover:text-indigo-500 transition-colors p-1"
                                title="Download SVG"
                            >
                                <i className="fa-solid fa-download text-xs"></i>
                            </button>
                        )}
                    </div>
                )}

                {/* Structure Area */}
                <div className="p-8 flex flex-col items-center justify-center min-h-[280px] relative">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-500/5 via-emerald-500/5 to-cyan-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    {error ? (
                        <div className="flex flex-col items-center gap-3 text-red-400 p-4">
                            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <span className="text-sm font-semibold tracking-tight">{error}</span>
                        </div>
                    ) : (
                        <div className="relative w-full overflow-x-auto flex justify-center pb-2 custom-scrollbar">
                            <svg
                                ref={svgRef}
                                width={width}
                                height={height}
                                className="max-w-full h-auto transition-all duration-700 hover:scale-[1.02]"
                            />
                        </div>
                    )}
                </div>

                {/* Info & Code Footer */}
                <div className="border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-black/20 px-5 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="flex items-center gap-2 text-[11px] font-bold text-slate-400 hover:text-indigo-500 transition-all"
                        >
                            <i className={`fa-solid ${isExpanded ? 'fa-square-minus' : 'fa-square-plus'} text-[13px] opacity-70`}></i>
                            SMILES NOTATION
                        </button>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCopy}
                                className={`text-[11px] font-bold flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300 ${copied
                                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                    : 'bg-white dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10 hover:border-indigo-500 hover:text-indigo-500'
                                    }`}
                            >
                                <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                                {copied ? 'COPIED' : 'COPY SMILES'}
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
