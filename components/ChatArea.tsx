import React, { lazy, Suspense, useEffect, useRef } from 'react';
import WaitingIndicator from './WaitingIndicator';
import { Message, Role, UserProfile, Language } from '../types';

// ChatMessage 를 지연 로드해 react-markdown + react-syntax-highlighter + rehype-katex 를
// 초기 번들에서 뺀다. 첫 로드엔 메시지가 없으므로 FCP/LCP 를 막지 않는다.
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

    // 첫 렌더 후 백그라운드에서 ChatMessage 청크를 미리 받아,
    // 사용자가 첫 메시지를 보내기 전에 준비해 둔다.
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
