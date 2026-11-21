import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createNewMessageTracker } from '../src/lib/new-messages';
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
    /** 세션이 바뀌면 그때 화면의 메시지는 기록이다 — 등장 모션을 주지 않는다 */
    sessionId?: string | null;
    onEdit: (content: string) => void;
}


const ChatArea: React.FC<ChatAreaProps> = ({
    messages,
    userProfile,
    language,
    isTyping,
    loadingStatus,
    isLoadingHistory = false,
    sessionId = null,
    onEdit
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 새 메시지 판정 — 기록 복원·세션 전환 때 대화 전체가 페이드되지 않게(PLAN_MOTION_UX_261005 §7-3)
    const [tracker] = useState(createNewMessageTracker);
    // 시각은 첫 마운트 판정에만 쓰인다 — 마운트 시각 한 번으로 충분하다
    const [mountedAt] = useState(Date.now);
    tracker.update({ messages, sessionId, isLoadingHistory, now: mountedAt });

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
                    isNew={tracker.isNew(msg.id)}
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
