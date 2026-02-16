import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PillVisual {
    shape: 'round' | 'oval' | 'capsule' | 'triangle' | 'pentagon' | 'hexagon';
    color: string;
    imprint_front?: string;
    imprint_back?: string;
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
}

interface DrugRendererProps {
    data: DrugData;
    language?: 'ko' | 'en' | 'es' | 'fr';
}

export const DrugRenderer: React.FC<DrugRendererProps> = ({ data, language = 'ko' }) => {
    const [imageError, setImageError] = useState(false);
    const [syncedUrl, setSyncedUrl] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(!!data.image_url);
    const [serverPillVisual, setServerPillVisual] = useState<any>(null); // Server-extracted pill visual


    const i18n = {
        ko: {
            ingredient: '핵심 성분',
            category: '약물 분류',
            dosage: '복용 안내',
            efficacy: '주요 효능 및 효과',
            noImage: '이미지 준비 중',
            syncing: '이미지 정보를 찾는 중...',
            details: '자세히',
            features: '식별 정보'
        },
        en: {
            ingredient: 'Active Ingredients',
            category: 'Category',
            dosage: 'Dosage',
            efficacy: 'Efficacy & Effects',
            noImage: 'No Image',
            details: 'View',
            features: 'Identification'
        },
        es: {
            ingredient: 'Ingredientes',
            category: 'Categoría',
            dosage: 'Dosis',
            efficacy: 'Eficacia y Efectos',
            noImage: 'Sin Imagen',
            details: 'Detalles',
            features: 'Identificación'
        },
        fr: {
            ingredient: 'Ingrédients',
            category: 'Catégorie',
            dosage: 'Dosage',
            efficacy: 'Efficacité',
            noImage: 'Pas d\'image',
            details: 'Détails',
            features: 'Identification'
        }
    };
    const t = i18n[language as keyof typeof i18n] || i18n.ko;

    // Helper: Map efficacy label to FontAwesome icon
    const getEfficacyIcon = (label: string, providedIcon?: string): string => {
        const iconMap: Record<string, string> = {
            // Respiratory & Cold (Free icons)
            '콧물': 'fa-wind',
            '코막힘': 'fa-wind',
            '비염': 'fa-wind',
            '재채기': 'fa-wind',
            '기침': 'fa-head-side-mask',
            '가래': 'fa-head-side-mask',
            '인후': 'fa-lungs',
            '목구멍': 'fa-lungs',
            '감기': 'fa-head-side-mask', // General cold symptom

            // Pain & Fever (Free icons)
            '해열': 'fa-temperature-arrow-down',
            '발열': 'fa-temperature-high', // Keeping this as it's a valid FA icon
            '오한': 'fa-temperature-low', // Keeping this as it's a valid FA icon
            '두통': 'fa-brain',
            '통증': 'fa-hand-holding-medical',
            '치통': 'fa-tooth',
            '신경통': 'fa-bolt',
            '근육통': 'fa-bone',
            '관절통': 'fa-bone',

            // Digestive (Free icons - fa-stomach is Pro)
            '복통': 'fa-pills',
            '위장': 'fa-pills',
            '소화': 'fa-pills',
            '설사': 'fa-droplet',
            '변비': 'fa-pills',
            '구역': 'fa-pills',
            '구토': 'fa-pills',

            // Systemic (Free icons)
            '면역': 'fa-shield-halved',
            '예방': 'fa-shield-halved',
            '고지혈': 'fa-droplet',
            '혈압': 'fa-heart-pulse',
            '당뇨': 'fa-droplet',
            '심장': 'fa-heart-pulse',
            '피로': 'fa-battery-quarter',

            // Eye & Others (Free icons)
            '눈': 'fa-eye',
            '시력': 'fa-eye',
            '야맹증': 'fa-eye-low-vision',

            // Metabolism (Free icons)
            '식욕': 'fa-utensils',
            '비만': 'fa-weight-scale',
            '체중': 'fa-weight-scale',
            '대사': 'fa-bolt',
            '지방': 'fa-fire'
        };

        // Priority 1: Curated Keyword Map
        for (const [key, value] of Object.entries(iconMap)) {
            if (label.includes(key)) return value;
        }

        // Priority 2: AI Provided Icon (if valid and not default)
        if (providedIcon && providedIcon.startsWith('fa-') && providedIcon !== 'fa-circle-check' && providedIcon !== 'fa-pills') {
            return providedIcon;
        }

        // Final Fallback
        return 'fa-pills';
    };

    const isValidUrl = (url: string | undefined): boolean => {
        if (!url) return false;
        try {
            new URL(url);
            return url.startsWith('http');
        } catch {
            return false;
        }
    };

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

    useEffect(() => {
        const syncImage = async () => {
            if (isValidUrl(data.image_url) && !syncedUrl) {
                setSyncing(true);
                try {
                    const response = await fetch('/api/sync-drug-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url: data.image_url,
                            imprint_front: data.pill_visual?.imprint_front,
                            imprint_back: data.pill_visual?.imprint_back
                        })
                    });

                    if (response.ok) {
                        const { publicUrl, pillVisual } = await response.json();
                        setSyncedUrl(publicUrl);
                        if (pillVisual) {
                            console.log('[DrugRenderer] Server extracted pill visual:', pillVisual);
                            setServerPillVisual(pillVisual);
                        }
                        setImageError(false);
                    } else {
                        setImageError(true);
                    }
                } catch (error) {
                    console.error('[DrugRenderer] Image sync error:', error);
                    setImageError(true);
                } finally {
                    setSyncing(false);
                }
            } else {
                setSyncing(false);
            }
        };

        syncImage();
    }, [data.image_url, syncedUrl]);



    return (
        <div className="w-full my-6">
            <div className="max-w-2xl mx-auto rounded-[1.5rem] border border-slate-200/60 dark:border-white/10 bg-white dark:bg-[#1c1c1e] shadow-lg overflow-hidden">

                {/* Hero Section: Integrated Title & Image */}
                <div className="relative bg-gradient-to-br from-indigo-500/5 via-transparent to-purple-500/5 dark:from-transparent dark:to-transparent border-b border-slate-100 dark:border-white/5">
                    <div className="p-8 pb-6">
                        <div className="flex flex-col gap-6">
                            {/* Title & Badge */}
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-1">
                                    {data.category.split(/[,/()]+/).filter(Boolean).map((cat, idx) => (
                                        <span key={idx} className="px-1.5 py-0.5 bg-indigo-500/10 dark:bg-indigo-500/20 text-[8px] sm:text-[10px] font-black text-indigo-600 dark:text-indigo-400 rounded-full uppercase tracking-tighter border border-indigo-200/50 dark:border-indigo-500/30">
                                            {cat.trim()}
                                        </span>
                                    ))}
                                </div>
                                <h2 className="text-3xl font-black text-slate-900 dark:text-white leading-tight tracking-tight">
                                    {data.name}
                                    {data.engName && (
                                        <div className="text-sm font-medium text-slate-400 dark:text-slate-500 mt-1">{data.engName}</div>
                                    )}
                                </h2>
                            </div>

                            {/* Main Image Viewport in Hero */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 px-1">
                                    <i className="fa-solid fa-camera text-[10px] text-indigo-500/70"></i>
                                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                        {language === 'ko' ? '외형 사진' : 'Reference Photo'}
                                    </span>
                                </div>
                                <div className="relative group w-full">
                                    {/* Digital Specimen Slide Look: Unified dark background */}
                                    <div className="w-full min-h-[14rem] sm:min-h-[16rem] bg-slate-50/50 dark:bg-white/[0.02] rounded-2xl border border-slate-200/50 dark:border-white/5 flex items-center justify-center overflow-hidden transition-all duration-500">
                                        <AnimatePresence mode="wait">
                                            {syncing && !syncedUrl ? (
                                                <motion.div
                                                    key="shimmer"
                                                    initial={{ opacity: 1 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                    className="w-full h-full flex flex-col items-center justify-center gap-4 bg-indigo-500/[0.02] dark:bg-indigo-500/[0.01]"
                                                >
                                                    <div className="relative">
                                                        <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full animate-pulse"></div>
                                                        <div className="relative w-16 h-16 bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 flex items-center justify-center shadow-xl">
                                                            <i className="fa-solid fa-rotate fa-spin text-xl text-indigo-500 dark:text-indigo-400/80"></i>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-[10px] font-black text-indigo-600/60 dark:text-indigo-400/50 uppercase tracking-[0.2em] animate-pulse">
                                                            {language === 'ko' ? '이미지 동기화 중' : 'Syncing Specimen'}
                                                        </span>
                                                        <div className="w-12 h-0.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                                                            <div className="w-full h-full bg-indigo-500/50 animate-[shimmer_1.5s_infinite]"></div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ) : !proxiedImageUrl || imageError ? (
                                                <motion.div
                                                    key="no-image"
                                                    initial={{ opacity: 1 }}
                                                    animate={{ opacity: 1 }}
                                                    className="flex flex-col items-center gap-3 text-slate-300 dark:text-slate-700"
                                                >
                                                    <i className="fa-solid fa-pills text-5xl opacity-20"></i>
                                                    <span className="text-xs font-bold tracking-tight">{t.noImage}</span>
                                                </motion.div>
                                            ) : (
                                                <motion.div
                                                    key="image"
                                                    initial={{ opacity: 1, scale: 1 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                                    className="relative w-full h-full flex items-center justify-center p-6"
                                                >
                                                    <img
                                                        src={proxiedImageUrl}
                                                        alt={data.name}
                                                        onError={() => setImageError(true)}
                                                        className="max-w-full max-h-full object-contain drop-shadow-xl transition-transform duration-500 group-hover:scale-110"
                                                    />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    {/* Action Hint */}
                                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-6 h-6 rounded-lg bg-black/20 backdrop-blur-md border border-white/10 flex items-center justify-center">
                                            <i className="fa-solid fa-expand text-[10px] text-white/50"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-8 space-y-8">
                    {/* Identification Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-[11px] font-black text-slate-400 dark:text-indigo-400 uppercase tracking-widest">{t.features}</span>
                            <div className="h-px flex-1 bg-slate-100 dark:bg-white/5"></div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {/* Shape Badge */}
                            <div className="px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-2">
                                <i className="fa-solid fa-shapes text-[10px] text-indigo-500"></i>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-slate-400 leading-none mb-1">{language === 'ko' ? '모양' : 'Shape'}</span>
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200">{serverPillVisual?.shape || data.pill_visual?.shape || '-'}</span>
                                </div>
                            </div>
                            {/* Color Badge */}
                            <div className="px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-2">
                                <i className="fa-solid fa-palette text-[10px] text-purple-500"></i>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-slate-400 leading-none mb-1">{language === 'ko' ? '색상' : 'Color'}</span>
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200">{serverPillVisual?.color || data.pill_visual?.color || '-'}</span>
                                </div>
                            </div>
                            {/* Front Imprint Badge */}
                            <div className="px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-2">
                                <i className="fa-solid fa-font text-[10px] text-blue-500"></i>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-slate-400 leading-none mb-1">{language === 'ko' ? '앞면' : 'Front'}</span>
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis">{serverPillVisual?.imprint_front || data.pill_visual?.imprint_front || (language === 'ko' ? '없음' : 'None')}</span>
                                </div>
                            </div>
                            {/* Back Imprint Badge */}
                            <div className="px-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl flex items-center gap-2">
                                <i className="fa-solid fa-font text-[10px] text-teal-500"></i>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold text-slate-400 leading-none mb-1">{language === 'ko' ? '뒷면' : 'Back'}</span>
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap overflow-hidden text-ellipsis">{serverPillVisual?.imprint_back || data.pill_visual?.imprint_back || (language === 'ko' ? '없음' : 'None')}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Unified Info Section (Ingredients & Dosage) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Ingredients */}
                        <div className="flex flex-col p-6 bg-slate-50/80 dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center border border-indigo-200/50 dark:border-indigo-500/30">
                                    <i className="fa-solid fa-microscope text-indigo-500 text-sm"></i>
                                </div>
                                <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{t.ingredient}</span>
                            </div>
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
                                {data.ingredient}
                            </p>
                        </div>

                        {/* Dosage */}
                        <div className="flex flex-col p-6 bg-slate-50/80 dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center border border-indigo-200/50 dark:border-indigo-500/30">
                                    <i className="fa-solid fa-clock-rotate-left text-indigo-500 text-sm"></i>
                                </div>
                                <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{t.dosage}</span>
                            </div>
                            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
                                {data.dosage || (language === 'ko' ? '복용 전 의사·약사와 상의하세요.' : 'Please consult a doctor or pharmacist.')}
                            </p>
                        </div>
                    </div>

                    {/* Efficacy Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{t.efficacy}</span>
                            <div className="h-px flex-1 bg-slate-100 dark:bg-white/5"></div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {data.efficacy?.map((eff, i) => (
                                <div
                                    key={i}
                                    className="p-4 bg-white dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 rounded-2xl flex flex-col items-center justify-center text-center gap-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-all shadow-sm"
                                >
                                    <div className="w-10 h-10 rounded-2xl bg-slate-50 dark:bg-black/30 flex items-center justify-center border border-slate-100 dark:border-white/5">
                                        <i className={`fa-solid ${getEfficacyIcon(eff.label, eff.icon)} text-indigo-500 text-lg`}></i>
                                    </div>
                                    <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 leading-tight">
                                        {eff.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Refined Footer */}
                <div className="px-8 py-5 bg-slate-50/50 dark:bg-black/20 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-400 tracking-[0.2em] uppercase">Medicine Index</span>
                    </div>
                    <a
                        href={`https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=${encodeURIComponent(data.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-black text-indigo-500 hover:text-indigo-600 transition-all"
                    >
                        {t.details} <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    </a>
                </div>
            </div>
        </div>
    );
};
