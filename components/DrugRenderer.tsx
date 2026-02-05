import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PillVisual {
    shape: 'round' | 'oval' | 'capsule' | 'triangle' | 'pentagon' | 'hexagon';
    color: string;
    imprint?: string;
    size?: string;
}

interface Efficacy {
    label: string;
    icon?: string; // FontAwesome icon class
}

interface DrugData {
    name: string;
    engName?: string;
    ingredient: string;
    category: string;
    dosage?: string;
    image_url?: string;
    pill_visual?: PillVisual;
    efficacy?: Efficacy[];
    smiles?: string;
}

interface DrugRendererProps {
    data: DrugData;
    language?: 'ko' | 'en';
}

export const DrugRenderer: React.FC<DrugRendererProps> = ({ data, language = 'ko' }) => {
    const [imageError, setImageError] = useState(false);
    const [syncedUrl, setSyncedUrl] = useState<string | null>(null);

    const i18n = {
        ko: {
            ingredient: '성분',
            category: '분류',
            dosage: '용법',
            efficacy: '효능',
            noImage: '이미지 준비 중',
            details: '상세 정보',
            features: '형태 및 특징'
        },
        en: {
            ingredient: 'Ingredient',
            category: 'Category',
            dosage: 'Dosage',
            efficacy: 'Efficacy',
            noImage: 'No Image',
            details: 'Details',
            features: 'Features'
        }
    };
    const t = i18n[language] || i18n.ko;

    // Helper: Map efficacy label to FontAwesome icon
    const getEfficacyIcon = (label: string, providedIcon?: string): string => {
        if (providedIcon && providedIcon.startsWith('fa-') && providedIcon !== 'fa-circle-check') {
            return providedIcon;
        }

        const iconMap: Record<string, string> = {
            '코막힘': 'fa-nose-bubble',
            '비염': 'fa-wind',
            '두통': 'fa-head-side-mask',
            '통증': 'fa-hand-holding-medical',
            '해열': 'fa-temperature-arrow-down',
            '발열': 'fa-temperature-high',
            '염증': 'fa-fire-flame-curved',
            '감염': 'fa-microbe',
            '세균': 'fa-bacteria',
            '항생': 'fa-capsules',
            '알레르기': 'fa-hand-dots',
            '피부': 'fa-hand-dots',
            '가려움': 'fa-hand-dots',
            '복통': 'fa-stomach',
            '설사': 'fa-droplet',
            '위장': 'fa-stomach',
            '궤양': 'fa-stomach',
            '기침': 'fa-head-side-cough',
            '가래': 'fa-head-side-mask',
            '치료': 'fa-vial-circle-check',
            '예방': 'fa-shield-halved',
            '고지혈': 'fa-droplet',
            '혈압': 'fa-droplet',
            '당뇨': 'fa-droplet',
            '심장': 'fa-heart-pulse'
        };

        for (const [key, value] of Object.entries(iconMap)) {
            if (label.includes(key)) return value;
        }

        return providedIcon || 'fa-circle-check';
    };

    // Use Proxy only for valid URLs
    const isValidUrl = (url: string | undefined): boolean => {
        if (!url) return false;
        try {
            new URL(url);
            return url.startsWith('http');
        } catch {
            return false;
        }
    };

    console.log(`[DrugRenderer] Initializing for ${data.name}. image_url:`, data.image_url);

    const isSearchOrEntryPage =
        data.image_url?.includes('search_result') ||
        data.image_url?.includes('terms.naver.com') ||
        data.image_url?.includes('pharm.or.kr') ||
        data.image_url?.includes('health.kr');

    const proxiedImageUrl = syncedUrl
        ? syncedUrl
        : (isValidUrl(data.image_url) && !isSearchOrEntryPage)
            ? `/api/proxy-image?url=${encodeURIComponent(data.image_url!)}`
            : null;

    if (proxiedImageUrl) {
        console.log('[DrugRenderer] Final source being used:', proxiedImageUrl);
    } else {
        console.log('[DrugRenderer] No valid source available.');
    }

    useEffect(() => {
        const syncImage = async () => {
            if (isValidUrl(data.image_url) && !syncedUrl) {
                try {
                    console.log(`[DrugRenderer] Requesting sync for: ${data.image_url}`);
                    const response = await fetch('/api/sync-drug-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: data.image_url })
                    });

                    if (response.ok) {
                        const { publicUrl } = await response.json();
                        setSyncedUrl(publicUrl);
                        setImageError(false); // ✅ Reset error state to try new URL
                        console.log(`[DrugRenderer] ✅ Image synced to Supabase: ${publicUrl}`);
                    } else if (response.status === 404) {
                        console.warn(`[DrugRenderer] ⚠️ Image not found at source for: ${data.name}`);
                    } else {
                        const err = await response.json();
                        console.error(`[DrugRenderer] ❌ Sync failed (${response.status}):`, err.message);
                    }
                } catch (error) {
                    console.error('[DrugRenderer] ❌ Network error during image sync:', error);
                }
            }
        };

        syncImage();
    }, [data.image_url, syncedUrl]);

    return (
        <div className="w-full my-4 animate-in fade-in zoom-in-95 duration-500 ease-out">
            <div className="max-w-3xl mx-auto rounded-[1.5rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] shadow-xl overflow-hidden">

                {/* Compact Header */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between bg-slate-50/50 dark:bg-black/20">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                            {data.name}
                            {data.engName && (
                                <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">{data.engName}</span>
                            )}
                        </h2>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* Visual & Features Row */}
                    <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                        {/* Smaller Image Area */}
                        <div className="w-40 h-40 flex-shrink-0 bg-slate-50 dark:bg-black/30 rounded-2xl border border-slate-100 dark:border-white/5 flex items-center justify-center overflow-hidden">
                            {!proxiedImageUrl || imageError ? (
                                <div className="flex flex-col items-center gap-2 text-slate-300 dark:text-slate-600">
                                    <i className="fa-solid fa-image text-3xl opacity-30"></i>
                                    <span className="text-[10px] font-bold">{t.noImage}</span>
                                </div>
                            ) : (
                                <img
                                    src={proxiedImageUrl}
                                    alt={data.name}
                                    onError={() => setImageError(true)}
                                    className="w-full h-full object-contain p-2"
                                />
                            )}
                        </div>

                        {/* Pill Features as Text (Integrated below or beside image) */}
                        <div className="flex-1 space-y-4">
                            <div className="bg-slate-50 dark:bg-white/[0.03] p-4 rounded-xl">
                                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-2 block">{t.features}</span>
                                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                        <span className="text-[11px] text-slate-400">모양:</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{data.pill_visual?.shape || '정보 없음'}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                        <span className="text-[11px] text-slate-400">색상:</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{data.pill_visual?.color || '정보 없음'}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                        <span className="text-[11px] text-slate-400">각인:</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{data.pill_visual?.imprint || '정보 없음'}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                        <span className="text-[11px] text-slate-400">크기:</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{data.pill_visual?.size || '정보 없음'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Metadata Grid (Compact) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-4 bg-slate-50/50 dark:bg-white/[0.02] rounded-xl border border-slate-100 dark:border-white/5">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{t.ingredient}</span>
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 italic">{data.ingredient}</p>
                        </div>
                        <div className="p-4 bg-slate-50/50 dark:bg-white/[0.02] rounded-xl border border-slate-100 dark:border-white/5">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">{t.category}</span>
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{data.category}</p>
                        </div>
                    </div>

                    {/* Dosage (Single Row) */}
                    {data.dosage && (
                        <div className="p-4 bg-indigo-50/50 dark:bg-indigo-500/5 rounded-xl border border-indigo-100/50 dark:border-indigo-500/10">
                            <div className="flex items-center gap-2 mb-1">
                                <i className="fa-solid fa-clock-rotate-left text-indigo-500 text-[10px]"></i>
                                <span className="text-[9px] font-black text-indigo-500/70 uppercase tracking-widest">{t.dosage}</span>
                            </div>
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{data.dosage}</p>
                        </div>
                    )}

                    {/* Efficacy (Compact List) */}
                    {data.efficacy && data.efficacy.length > 0 && (
                        <div className="space-y-4 pt-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] pl-1">{t.efficacy}</span>
                            <div className="flex flex-wrap gap-2">
                                {data.efficacy.map((eff, i) => (
                                    <div key={i} className="px-3 py-2 bg-white dark:bg-white/[0.04] border border-slate-100 dark:border-white/5 rounded-lg flex items-center gap-2 shadow-sm">
                                        <i className={`fa-solid ${getEfficacyIcon(eff.label, eff.icon)} text-indigo-500 text-[10px]`}></i>
                                        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{eff.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Minimal Footer */}
                <div className="px-6 py-3 bg-slate-50/50 dark:bg-black/30 flex items-center justify-between border-t border-slate-100 dark:border-white/5">
                    <span className="text-[8px] font-black text-slate-400 tracking-[0.3em] uppercase">Medicine Indexer v1.1</span>
                    <button className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 transition-colors flex items-center gap-1">
                        {t.details} <i className="fa-solid fa-chevron-right text-[8px]"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
