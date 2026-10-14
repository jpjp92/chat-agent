import React, { lazy, Suspense, useEffect, useRef } from 'react';
import WaitingIndicator from './WaitingIndicator';
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
        <div className="flex min-h-0 flex-col pt-4">
            <Suspense fallback={null}>
            {messages.map((msg, idx) => (
                <ChatMessage
                    key={msg.id}
                    message={msg}
                    userProfile={userProfile}
                    language={language}
                    onEdit={onEdit}
                    isStreaming={isTyping && idx === messages.length - 1 && msg.role === Role.MODEL}
                />
            ))}
            </Suspense>

            {((isTyping && messages.length > 0 && messages[messages.length - 1].role === Role.USER) || loadingStatus) && (
                <WaitingIndicator status={loadingStatus} />
            )}

            <div ref={messagesEndRef} className="h-4 sm:h-10" />
        </div>
    );
};

export default ChatArea;
