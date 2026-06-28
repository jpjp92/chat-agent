import React from 'react';
import { Language } from '../types';

interface SuggestChipsProps {
    language: Language;
    onSelect: (sample: string) => void;
}

interface Chip { icon: string; label: string; sample: string; }

// 칩 라벨/샘플 — 4개 언어. 라벨은 아이콘이 의미를 보강하므로 짧게(es/fr는 명사 한 단어).
const CHIPS: Record<Language, Chip[]> = {
    ko: [
        { icon: 'fa-magnifying-glass', label: '실시간 검색', sample: '오늘 서울 날씨 어때?' },
        { icon: 'fa-film', label: '영화 상영표', sample: '강남 영화 상영시간표 알려줘' },
        { icon: 'fa-pills', label: '약 정보', sample: '타이레놀 효능과 복용법 알려줘' },
        { icon: 'fa-code', label: '코드 작성', sample: 'JavaScript로 이메일 형식 검사 함수 작성해줘' },
    ],
    en: [
        { icon: 'fa-magnifying-glass', label: 'Live search', sample: "What's the weather in Seoul today?" },
        { icon: 'fa-film', label: 'Movie times', sample: 'Show movie showtimes in Gangnam' },
        { icon: 'fa-pills', label: 'Drug info', sample: 'Tell me about Tylenol dosage and effects' },
        { icon: 'fa-code', label: 'Write code', sample: 'Write an email validation function in JavaScript' },
    ],
    es: [
        { icon: 'fa-magnifying-glass', label: 'Buscar', sample: '¿Qué tiempo hace hoy en Seúl?' },
        { icon: 'fa-film', label: 'Cine', sample: 'Muéstrame la cartelera de cine en Gangnam' },
        { icon: 'fa-pills', label: 'Medicinas', sample: 'Háblame de la dosis y efectos del Tylenol' },
        { icon: 'fa-code', label: 'Código', sample: 'Escribe una función de validación de email en JavaScript' },
    ],
    fr: [
        { icon: 'fa-magnifying-glass', label: 'Recherche', sample: "Quel temps fait-il à Séoul aujourd'hui ?" },
        { icon: 'fa-film', label: 'Cinéma', sample: 'Affiche les séances de cinéma à Gangnam' },
        { icon: 'fa-pills', label: 'Médicaments', sample: 'Parle-moi du dosage et des effets du Tylenol' },
        { icon: 'fa-code', label: 'Code', sample: "Écris une fonction de validation d'email en JavaScript" },
    ],
};

// 빈 화면 추천 칩 — 클릭 시 샘플 프롬프트를 입력창에 채운다(전송은 사용자가).
// 모바일: 가로 스크롤 1줄 / 데스크톱: wrap + 중앙.
const SuggestChips: React.FC<SuggestChipsProps> = ({ language, onSelect }) => {
    const chips = CHIPS[language] || CHIPS.ko;
    return (
        <div className="hidden sm:flex flex-wrap justify-center gap-1.5 sm:gap-2 w-full max-w-2xl px-1">
            {chips.map((c) => (
                <button
                    key={c.label}
                    type="button"
                    onClick={() => onSelect(c.sample)}
                    className="inline-flex items-center gap-1.5 sm:gap-2 shrink-0 border border-slate-200 dark:border-white/10 rounded-lg sm:rounded-xl px-2.5 py-1.5 sm:px-4 sm:py-2.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-white/[0.05] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 active:scale-[0.98] transition-colors"
                >
                    <i className={`fa-solid ${c.icon} text-[11px] sm:text-[13px] text-slate-500 dark:text-slate-400`}></i>
                    {c.label}
                </button>
            ))}
        </div>
    );
};

export default SuggestChips;
