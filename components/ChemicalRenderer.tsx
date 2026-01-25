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
            fontSizeLarge: 7, // 폰트 크기 살짝 키움
            fontSizeSmall: 5,
            padding: 10, // 여백 확보
            experimental: false
        };

        try {
            const d = new SmilesDrawer.SvgDrawer(options);
            setDrawer(d);
        } catch (e: any) {
            console.error('[ChemicalRenderer] Failed to init SvgDrawer:', e);
            setError('Renderer Init Failed');
        }
    }, [width, height]);

    // 2. 그리기 (SMILES 변경 시)
    useEffect(() => {
        if (!drawer || !svgRef.current || !smiles) return;

        // 테마 설정
        const isDark = document.documentElement.classList.contains('dark');
        const theme = isDark ? 'dark' : 'light';

        // 중요: 이전 그림 지우기 (SVG는 append 방식이므로)
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

    return (
        <div className="w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
            <div className="p-4 rounded-3xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-lg shadow-slate-200/50 dark:shadow-none min-h-[250px] relative overflow-hidden flex flex-col items-center justify-center group">

                {/* 배경 장식 */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                {error ? (
                    <div className="flex flex-col items-center gap-2 text-red-400 p-4">
                        <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                        <span className="text-sm font-medium">{error}</span>
                        <span className="text-xs opacity-50 font-mono break-all max-w-[300px] text-center">{smiles}</span>
                    </div>
                ) : (
                    <div className="relative w-full overflow-x-auto flex justify-center pb-2">
                        <svg
                            ref={svgRef}
                            width={width} // viewBox는 라이브러리가 설정하지만 width/height을 명시해야 안 잘림
                            height={height}
                            className="max-w-full h-auto transition-opacity duration-500"
                        />
                    </div>
                )}

                {/* SMILES 코드 표시 (마우스 오버 시) */}
                <div className="absolute bottom-2 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-black/30 px-2 py-1 rounded select-all cursor-text">
                        SMILES: {smiles}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default ChemicalRenderer;
