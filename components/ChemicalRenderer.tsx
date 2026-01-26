import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import SmilesDrawer from 'smiles-drawer';

interface ChemicalRendererProps {
    smiles: string;
    width?: number;
    height?: number;
}

const ChemicalRenderer: React.FC<ChemicalRendererProps> = ({ smiles, width = 450, height = 300 }) => {
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

    return (
        <div className="w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <div className="rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg shadow-slate-200/50 dark:shadow-none relative overflow-hidden flex flex-col group">

                {/* Structure Area */}
                <div className="p-6 flex flex-col items-center justify-center min-h-[250px] relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                    {error ? (
                        <div className="flex flex-col items-center gap-2 text-red-400 p-4">
                            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                            <span className="text-sm font-medium">{error}</span>
                        </div>
                    ) : (
                        <div className="relative w-full overflow-x-auto flex justify-center pb-2">
                            <svg
                                ref={svgRef}
                                width={width}
                                height={height}
                                className="max-w-full h-auto transition-opacity duration-500"
                            />
                        </div>
                    )}
                </div>

                {/* Info & Code Footer */}
                <div className="border-t border-slate-50 dark:border-white/5 bg-slate-50/50 dark:bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 hover:text-indigo-500 transition-colors"
                        >
                            <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} transition-transform`}></i>
                            SMILES STRING
                        </button>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCopy}
                                className={`text-[11px] flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-300 ${copied
                                        ? 'bg-emerald-500/10 text-emerald-500'
                                        : 'bg-slate-200/50 dark:bg-white/5 text-slate-500 hover:text-indigo-500'
                                    }`}
                            >
                                <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    {isExpanded && (
                        <div className="mt-2 animate-in slide-in-from-top-1 duration-300">
                            <div className="p-3 bg-white dark:bg-black/40 rounded-xl border border-slate-200/50 dark:border-white/5 shadow-inner">
                                <code className="text-[10px] font-mono text-slate-400 break-all leading-relaxed block max-h-[100px] overflow-y-auto custom-scrollbar">
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
