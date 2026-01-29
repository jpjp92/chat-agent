import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as NGL from 'ngl';
import { motion, AnimatePresence } from 'framer-motion';

interface BioData {
    type: 'sequence' | 'pdb';
    title?: string;
    data: {
        sequence?: string;
        pdbId?: string;
        name?: string;
        highlights?: Array<{ start: number; end: number; label: string; color?: string }>;
    };
}

interface BioRendererProps {
    bioData: BioData;
}

// 아미노산 색상 테마 (Hydrophobicity/Chemistry)
const AMINO_ACID_COLORS: Record<string, string> = {
    // Non-polar (Slate/Grey)
    'A': '#94a3b8', 'V': '#94a3b8', 'L': '#94a3b8', 'I': '#94a3b8', 'P': '#94a3b8', 'F': '#94a3b8', 'W': '#94a3b8', 'M': '#94a3b8',
    // Polar uncharged (Emerald/Green)
    'G': '#10b981', 'S': '#10b981', 'T': '#10b981', 'C': '#10b981', 'Y': '#10b981', 'N': '#10b981', 'Q': '#10b981',
    // Positive charge (Blue)
    'K': '#3b82f6', 'R': '#3b82f6', 'H': '#3b82f6',
    // Negative charge (Red)
    'D': '#ef4444', 'E': '#ef4444',
    // Default
    'default': '#cbd5e1'
};

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

const BioRenderer: React.FC<BioRendererProps> = ({ bioData }) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const nglStage = useRef<NGL.Stage | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, text: any } | null>(null);
    const { type, title, data } = bioData;
    const isDark = useThemeMode();

    // 1D Sequence View Component
    const SequenceView = () => {
        const seq = data.sequence || "";
        if (!seq) return <div className="text-slate-400">No sequence data</div>;

        return (
            <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                <div className="flex flex-wrap gap-1 min-w-max p-1">
                    {seq.split('').map((aa, idx) => {
                        const color = AMINO_ACID_COLORS[aa.toUpperCase()] || AMINO_ACID_COLORS['default'];
                        const isHighlighted = data.highlights?.some(h => (idx + 1) >= h.start && (idx + 1) <= h.end);
                        const highlight = data.highlights?.find(h => (idx + 1) >= h.start && (idx + 1) <= h.end);

                        return (
                            <div key={idx} className="flex flex-col items-center group relative">
                                <span className="text-[10px] text-slate-400 font-mono mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {idx + 1}
                                </span>
                                <motion.div
                                    whileHover={{ scale: 1.2, zIndex: 10 }}
                                    className={`w-7 h-9 flex items-center justify-center rounded-md font-mono font-bold text-white shadow-sm transition-all
                                        ${isHighlighted ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}`}
                                    style={{ backgroundColor: color }}
                                >
                                    {aa}
                                </motion.div>
                                {isHighlighted && highlight && (
                                    <div className="absolute top-[-25px] left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                                        {highlight.label}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // 3D PDB View Logic
    useEffect(() => {
        if (type !== 'pdb' || !data.pdbId || !stageRef.current) return;

        setIsLoading(true);
        setError(null);

        if (!nglStage.current) {
            nglStage.current = new NGL.Stage(stageRef.current, {
                backgroundColor: isDark ? "#111112" : "#f8fafc",
                sampleLevel: 0,
                tooltip: false, // 기본 툴팁 비활성화
            });
        } else {
            nglStage.current.setParameters({
                backgroundColor: isDark ? "#111112" : "#f8fafc"
            });
        }

        const stage = nglStage.current;
        stage.removeAllComponents();

        // 호버 감지 로직 개선
        stage.signals.hovered.removeAll();
        stage.signals.hovered.add((pickingProxy: any) => {
            if (pickingProxy && (pickingProxy.atom || pickingProxy.residue)) {
                const atom = pickingProxy.atom;
                const residue = pickingProxy.residue;

                setHoverInfo({
                    x: pickingProxy.canvasPos.x,
                    y: pickingProxy.canvasPos.y,
                    text: {
                        resname: residue ? residue.resname : (atom ? atom.resname : "Unknown"),
                        resno: residue ? residue.resno : (atom ? atom.resno : "?"),
                        chainname: residue ? residue.chainname : (atom ? atom.chainname : "-"),
                        element: atom ? atom.element : "",
                        atomname: atom ? atom.atomname : "CA"
                    }
                });
            } else {
                setHoverInfo(null);
            }
        });

        stage.loadFile(`rcsb://${data.pdbId}`).then((comp: any) => {
            comp.addRepresentation("cartoon", {
                colorScheme: "residueindex",
                quality: "high"
            });
            comp.autoView();
            setIsLoading(false);

            setTimeout(() => {
                stage.handleResize();
            }, 100);
        }).catch((err) => {
            console.error("NGL Load Error:", err);
            setError("Failed to load PDB structure");
            setIsLoading(false);
        });

        const handleResize = () => stage.handleResize();
        window.addEventListener('resize', handleResize);

        const resizeObserver = new ResizeObserver(() => {
            stage.handleResize();
        });
        if (stageRef.current) {
            resizeObserver.observe(stageRef.current);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            if (nglStage.current) {
                nglStage.current.signals.hovered.removeAll();
            }
        };
    }, [type, data.pdbId, isDark]);

    const handleDownloadSVG = () => {
        // SVG download logic (placeholder for 1D, NGL download for 3D)
        if (type === 'pdb' && nglStage.current) {
            nglStage.current.makeImage({ factor: 2, antialias: true, trim: true }).then((blob: Blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${data.pdbId || 'structure'}.png`;
                link.click();
            });
        }
    };

    return (
        <div className="w-full my-6 animate-in fade-in zoom-in-95 duration-1000 ease-out">
            <div className={`rounded-[2.5rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1e1e1f] shadow-2xl shadow-slate-200/50 dark:shadow-none relative overflow-hidden flex flex-col group transition-all duration-500`}>

                {type === 'pdb' ? (
                    /* Immersive 3D Layout */
                    <div className="relative">
                        {/* Floating Header */}
                        <div className="absolute top-4 left-4 right-4 z-20 flex items-start justify-between pointer-events-none">
                            <div className="flex flex-col gap-1 pointer-events-auto">
                                <div className="flex items-center gap-2 bg-white/70 dark:bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 dark:border-white/5 shadow-sm max-w-[200px] sm:max-w-md">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0"></div>
                                    <span
                                        className="text-[11px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider truncate"
                                        title={title || data.pdbId}
                                    >
                                        {title || data.pdbId}
                                    </span>
                                </div>
                                {data.name && data.name !== title && (
                                    <div className="bg-white/50 dark:bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 w-fit ml-4 shadow-sm">
                                        <span className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tight">{data.name}</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={handleDownloadSVG}
                                className="pointer-events-auto w-10 h-10 rounded-full bg-white/70 dark:bg-black/40 backdrop-blur-md border border-white/20 dark:border-white/5 flex items-center justify-center text-slate-400 hover:text-blue-500 transition-all shadow-sm hover:scale-110 active:scale-95"
                                title="Capture Snapshot"
                            >
                                <i className="fa-solid fa-camera text-sm"></i>
                            </button>
                        </div>

                        {/* Immersive Canvas Area */}
                        <div className="aspect-[4/3] sm:aspect-video min-h-[350px] relative w-full overflow-hidden bg-[#f8fafc] dark:bg-[#111112]">
                            {isLoading && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#f8fafc]/80 dark:bg-[#111112]/80 z-10 backdrop-blur-md">
                                    <div className="relative">
                                        <div className="w-12 h-12 border-2 border-blue-500/20 rounded-full"></div>
                                        <div className="absolute inset-0 w-12 h-12 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                                    </div>
                                    <span className="mt-4 text-[10px] font-black text-blue-500/60 tracking-[0.3em] uppercase">Initializing 3D Environment</span>
                                </div>
                            )}
                            {error ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 px-10 text-center">
                                    <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                                        <i className="fa-solid fa-bug text-2xl"></i>
                                    </div>
                                    <span className="text-sm font-bold leading-relaxed">{error}</span>
                                </div>
                            ) : (
                                <div ref={stageRef} className="w-full h-full cursor-grab active:cursor-grabbing transition-opacity duration-1000" style={{ opacity: isLoading ? 0 : 1 }} />
                            )}

                            {/* Custom Premium Tooltip */}
                            <AnimatePresence>
                                {hoverInfo && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                        className="absolute z-50 pointer-events-none"
                                        style={{
                                            left: hoverInfo.x + 12,
                                            top: hoverInfo.y + 12
                                        }}
                                    >
                                        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg border border-slate-200 dark:border-white/10 rounded-2xl p-3 shadow-2xl flex flex-col gap-1 min-w-[120px]">
                                            <div className="flex items-center justify-between gap-4 border-b border-slate-100 dark:border-white/5 pb-1.5 mb-1.5">
                                                <span className="text-[12px] font-black text-blue-500 dark:text-blue-400 tracking-tighter uppercase">{hoverInfo.text.resname}</span>
                                                <span className="text-[10px] bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 font-mono">#{hoverInfo.text.resno}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-slate-400 uppercase font-bold tracking-widest">Chain</span>
                                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{hoverInfo.text.chainname}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-slate-400 uppercase font-bold tracking-widest">Atom</span>
                                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{hoverInfo.text.atomname}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-slate-400 uppercase font-bold tracking-widest">Element</span>
                                                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{hoverInfo.text.element}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Floating Footer Badges */}
                        <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between pointer-events-none">
                            <div className="flex items-center gap-2 bg-slate-900/5 dark:bg-white/5 backdrop-blur-[2px] px-3 py-1 rounded-full text-[9px] font-bold text-slate-400 tracking-tighter uppercase">
                                <i className="fa-solid fa-database opacity-50"></i> RCSB.ORG
                            </div>
                            <div className="flex items-center gap-2 bg-blue-500/10 dark:bg-blue-500/20 backdrop-blur-md px-3 py-1 rounded-full text-[9px] font-black text-blue-600 dark:text-blue-400 tracking-widest uppercase animate-pulse">
                                <i className="fa-solid fa-rotate"></i> Interactive 3D
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Clean Sequence Layout */
                    <>
                        <div className="px-6 py-4 border-b border-slate-50 dark:border-white/5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30"></div>
                                <div className="flex flex-col">
                                    <h3 className="text-[13px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-tight">{title || 'Sequence Map'}</h3>
                                    {data.name && <span className="text-[10px] text-slate-400 font-medium">{data.name}</span>}
                                </div>
                            </div>
                            <div className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black tracking-widest uppercase">
                                1D Map
                            </div>
                        </div>
                        <div className="p-6">
                            <SequenceView />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BioRenderer;
