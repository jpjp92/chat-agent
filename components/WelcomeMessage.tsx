import React from 'react';
import { Language } from '../types';

interface WelcomeMessageProps {
    language: Language;
}

// 웰컴 한 줄 그리팅 (2단 → 1단 간결화). 중앙 정렬은 부모(App 웰컴 그룹)가 담당.
const greetings: Record<string, string> = {
    ko: "무엇을 도와드릴까요?",
    en: "What's on your mind?",
    es: "¿De qué hablamos hoy?",
    fr: "De quoi parlons-nous ?",
};

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ language }) => {
    const greeting = greetings[language] || greetings.ko;

    return (
        <div className="text-center">
            <h1 className="text-2xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-blue-500 via-purple-500 to-red-500 bg-clip-text text-transparent px-4">
                {greeting}
            </h1>
        </div>
    );
};

export default WelcomeMessage;
