import React, { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import { Message, Role, UserProfile, Language } from '../types';

interface ChatAreaProps {
    messages: Message[];
    userProfile: UserProfile;
    language: Language;
    isTyping: boolean;
    loadingStatus: string | null;
}

const ChatArea: React.FC<ChatAreaProps> = ({
    messages,
    userProfile,
    language,
    isTyping,
    loadingStatus
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping, loadingStatus]);

    return (
        <div className="flex flex-col space-y-2">
            {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} userProfile={userProfile} language={language} />
            ))}

            {((isTyping && messages.length > 0 && messages[messages.length - 1].role === Role.USER) || loadingStatus) && (
                <div className="flex items-start gap-4 mt-4 pl-1">
                    <div className="flex-shrink-0 mt-1">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-primary-500 to-violet-500 flex items-center justify-center shadow-lg shadow-primary-500/10">
                            <i className="fa-solid fa-sparkles text-white text-[10px]"></i>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 py-4">
                        <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s]"></div>
                        <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]"></div>
                        <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]"></div>
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} className="h-4 sm:h-10" />
        </div>
    );
};

export default ChatArea;
