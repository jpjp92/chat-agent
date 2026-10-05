import React from 'react';
import { Language } from '../types';

interface SuggestChipsProps {
    language: Language;
    onSelect: (sample: string, attach?: boolean) => void;
}

interface Chip { icon: string; label: string; sample: string; attach?: boolean; }

// 칩 라벨/샘플 — 4개 언어. 라벨은 아이콘이 의미를 보강하므로 짧게(es/fr는 명사 한 단어).
// 기준: 매일 쓸 이유 · 카드/출처가 붙는 질문 · 첫 시도에 실패하지 않음 (PLAN_MOTION_UX_261005 §4).
// 영화 샘플에 "추천"·"요즘"을 넣지 않는다 — intent-rules 가 그 단어를 상영표 조회에서 제외해 카드가 안 뜬다.
const CHIPS: Record<Language, Chip[]> = {
    ko: [
        { icon: 'fa-cloud-sun', label: '오늘 날씨', sample: '오늘 서울 날씨 어때? 우산 챙겨야 할까?' },
        { icon: 'fa-film', label: '오늘 볼 영화', sample: '오늘 볼 수 있는 영화랑 상영시간 알려줘' },
        { icon: 'fa-newspaper', label: '최신 뉴스', sample: '오늘 주요 뉴스 5개를 출처와 함께 요약해줘' },
        { icon: 'fa-image', label: '이미지 분석', sample: '이 사진 속 내용을 설명하고 핵심을 정리해줘', attach: true },
    ],
    en: [
        { icon: 'fa-cloud-sun', label: "Today's weather", sample: "What's the weather in Seoul today? Do I need an umbrella?" },
        { icon: 'fa-film', label: 'Movies today', sample: 'What movies are showing today and what are the showtimes?' },
        { icon: 'fa-newspaper', label: 'Latest news', sample: "Summarize today's top 5 news stories with sources" },
        { icon: 'fa-image', label: 'Analyze image', sample: 'Describe what is in this photo and summarize the key points', attach: true },
    ],
    es: [
        { icon: 'fa-cloud-sun', label: 'Clima', sample: '¿Qué tiempo hace hoy en Seúl? ¿Necesito paraguas?' },
        { icon: 'fa-film', label: 'Cine hoy', sample: '¿Qué películas hay hoy y en qué horarios?' },
        { icon: 'fa-newspaper', label: 'Noticias', sample: 'Resume las 5 noticias principales de hoy con sus fuentes' },
        { icon: 'fa-image', label: 'Imagen', sample: 'Describe lo que hay en esta foto y resume los puntos clave', attach: true },
    ],
    fr: [
        { icon: 'fa-cloud-sun', label: 'Météo', sample: "Quel temps fait-il à Séoul aujourd'hui ? Faut-il un parapluie ?" },
        { icon: 'fa-film', label: "Films aujourd'hui", sample: "Quels films passent aujourd'hui et à quelles heures ?" },
        { icon: 'fa-newspaper', label: 'Actualités', sample: "Résume les 5 principales actualités du jour avec leurs sources" },
        { icon: 'fa-image', label: 'Analyser une image', sample: 'Décris le contenu de cette photo et résume les points clés', attach: true },
    ],
};

// 빈 화면 추천 칩 — 클릭 시 샘플 프롬프트를 입력창에 채운다(전송은 사용자가). attach 칩은 파일 선택 창도 연다.
// 데스크톱 전용(모바일 숨김은 의도된 설계).
const SuggestChips: React.FC<SuggestChipsProps> = ({ language, onSelect }) => {
    const chips = CHIPS[language] || CHIPS.ko;
    return (
        <div className="hidden sm:grid grid-cols-4 gap-2 w-full max-w-2xl px-1 mx-auto">
            {chips.map((c) => (
                <button
                    key={c.label}
                    type="button"
                    onClick={() => onSelect(c.sample, c.attach)}
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
