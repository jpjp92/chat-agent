import React from 'react';
import { Language } from '../types';

interface WelcomeMessageProps {
    language: Language;
}

const welcomeMessages = {
    ko: { title: "반가워요!", subtitle: "오늘은 어떤 이야기를 나눌까요?", desc: "궁금한 질문이나 실시간 검색을 해보세요." },
    en: { title: "Hello there!", subtitle: "What's on your mind?", desc: "Ask questions or search in real-time." },
    es: { title: "¡Hola!", subtitle: "¿De qué hablamos hoy?", desc: "Haz preguntas or busca en tempo real." },
    fr: { title: "Bonjour!", subtitle: "De quoi parlons-nous ?", desc: "Posez des questions ou cherchez en direct." }
};

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ language }) => {
    const currentWelcome = (welcomeMessages as any)[language] || welcomeMessages.ko;

    return (
        <div className="flex flex-col items-center justify-center flex-1 py-8 sm:py-20">
            <div className="text-center">
                <h1 className="text-3xl sm:text-6xl font-bold tracking-tight bg-gradient-to-r from-blue-500 via-purple-500 to-red-500 bg-clip-text text-transparent mb-3 sm:mb-6">
                    {currentWelcome.title}
                </h1>
                <p className="text-slate-400 dark:text-slate-500 text-base sm:text-2xl font-medium px-4">
                    {currentWelcome.subtitle}
                </p>
            </div>
        </div>
    );
};

export default WelcomeMessage;
