import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { Message, Role, UserProfile, Language } from '../types';

// Lazy load ChatMessage to defer react-markdown + react-syntax-highlighter + rehype-katex
// from the critical bundle. On initial load there are no messages, so this never blocks FCP/LCP.
const ChatMessage = lazy(() => import('./ChatMessage'));

interface ChatAreaProps {
    messages: Message[];
    userProfile: UserProfile;
    language: Language;
    isTyping: boolean;
    loadingStatus: string | null;
    isLoadingHistory?: boolean;
    onEdit: (content: string) => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({
    messages,
    userProfile,
    language,
    isTyping,
    loadingStatus,
    onEdit
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Preload ChatMessage chunk in the background after initial render,
    // so it's ready before the user sends their first message.
    useEffect(() => {
        const id = setTimeout(() => { import('./ChatMessage'); }, 200);
        return () => clearTimeout(id);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping, loadingStatus]);

    return (
        <div className="flex min-h-0 flex-col space-y-2 pt-4">
            <Suspense fallback={null}>
            {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} userProfile={userProfile} language={language} onEdit={onEdit} />
            ))}
            </Suspense>

            {((isTyping && messages.length > 0 && messages[messages.length - 1].role === Role.USER) || loadingStatus) && (
                <div className="flex items-start gap-4 mt-4 pl-1">
                    <div className="flex-shrink-0 mt-1">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-primary-500 to-violet-500 flex items-center justify-center shadow-lg shadow-primary-500/10">
                            <i className="fa-solid fa-sparkles text-white text-[10px]"></i>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 py-4">
                        <div className="w-2 h-2 bg-indigo-300 dark:bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s]"></div>
                        <div className="w-2 h-2 bg-indigo-300 dark:bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]"></div>
                        <div className="w-2 h-2 bg-indigo-300 dark:bg-indigo-400 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]"></div>
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} className="h-4 sm:h-10" />
        </div>
    );
};

export default ChatArea;
