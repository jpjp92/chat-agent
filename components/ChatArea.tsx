import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
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
                <div className="flex items-start mt-4 pl-1">
                    {/* 대기 표시 — 첫 텍스트 조각이 오면 답변 말풍선이 생기면서 이 블록이 빠진다(useChatStream).
                        오브가 아바타 자리(w-8)를 대신한다 — 답변이 시작되면 같은 자리에 아바타가 들어와 위치가 튀지 않는다.
                        Thinking Orb 는 reduced-motion·화면 밖·숨은 탭에서 스스로 멈춘다. */}
                    <div className="flex items-center gap-4 mt-1" role="status" aria-live="polite">
                        <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                            <ThinkingOrb state="working" size={32} theme="auto" color="#a5b4fc" aria-hidden="true" />
                        </span>
                        {loadingStatus && (
                            <span key={loadingStatus} className="status-shimmer text-sm">{loadingStatus}</span>
                        )}
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} className="h-4 sm:h-10" />
        </div>
    );
};

export default ChatArea;
