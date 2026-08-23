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
        { icon: 'fa-magnifying-glass', label: '최신 AI 뉴스', sample: '오늘 나온 AI 주요 뉴스 5개를 출처와 함께 알려줘' },
        { icon: 'fa-film', label: '오늘 볼 영화', sample: '오늘 강남 CGV에서 볼 수 있는 영화와 상영시간 알려줘' },
        { icon: 'fa-pills', label: '약 복용 확인', sample: '타이레놀의 복용법과 주의사항을 쉽게 설명해줘' },
        { icon: 'fa-code', label: 'Python 자동화', sample: 'Python으로 엑셀 파일의 중복된 행을 제거하는 코드 작성해줘' },
    ],
    en: [
        { icon: 'fa-magnifying-glass', label: 'Latest AI news', sample: 'Show me five major AI news stories from today with sources' },
        { icon: 'fa-film', label: 'Movies today', sample: 'What movies and showtimes are available at CGV Gangnam today?' },
        { icon: 'fa-pills', label: 'Check dosage', sample: 'Explain how to take Tylenol and its precautions in simple terms' },
        { icon: 'fa-code', label: 'Python automation', sample: 'Write Python code to remove duplicate rows from an Excel file' },
    ],
    es: [
        { icon: 'fa-magnifying-glass', label: 'Noticias de IA', sample: 'Muéstrame cinco noticias importantes de IA de hoy con sus fuentes' },
        { icon: 'fa-film', label: 'Cine hoy', sample: '¿Qué películas y horarios hay hoy en CGV Gangnam?' },
        { icon: 'fa-pills', label: 'Revisar dosis', sample: 'Explica de forma sencilla cómo tomar Tylenol y sus precauciones' },
        { icon: 'fa-code', label: 'Automatizar con Python', sample: 'Escribe código Python para eliminar filas duplicadas de un archivo Excel' },
    ],
    fr: [
        { icon: 'fa-magnifying-glass', label: "Actualités de l'IA", sample: "Présente-moi cinq actualités majeures sur l'IA publiées aujourd'hui avec leurs sources" },
        { icon: 'fa-film', label: "Films aujourd'hui", sample: "Quels films et quelles séances sont disponibles aujourd'hui au CGV Gangnam ?" },
        { icon: 'fa-pills', label: 'Vérifier la dose', sample: 'Explique simplement comment prendre du Tylenol et les précautions à connaître' },
        { icon: 'fa-code', label: 'Automatiser en Python', sample: "Écris du code Python pour supprimer les lignes en double d'un fichier Excel" },
    ],
};

// 빈 화면 추천 칩 — 클릭 시 샘플 프롬프트를 입력창에 채운다(전송은 사용자가).
// 모바일: 가로 스크롤 1줄 / 데스크톱: wrap + 중앙.
const SuggestChips: React.FC<SuggestChipsProps> = ({ language, onSelect }) => {
    const chips = CHIPS[language] || CHIPS.ko;
    return (
        <div className="hidden sm:grid grid-cols-4 gap-2 w-full max-w-2xl px-1 mx-auto">
            {chips.map((c) => (
                <button
                    key={c.label}
                    type="button"
                    onClick={() => onSelect(c.sample)}
                    className="flex items-center justify-center gap-2 min-w-0 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-white/[0.05] hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 active:scale-[0.98] transition-colors"
                >
                    <i className={`fa-solid ${c.icon} text-[13px] shrink-0 text-slate-500 dark:text-slate-400`}></i>
                    <span className="truncate">{c.label}</span>
                </button>
            ))}
        </div>
    );
};

export default SuggestChips;
