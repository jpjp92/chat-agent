import React from 'react';
import { ThinkingOrb } from 'thinking-orbs';

/**
 * 응답 대기 표시 — Thinking Orb + 상태 문구. 채팅 화면(ChatArea)과 미리보기(/dev/loading-preview)가 같이 쓴다.
 * 오브가 아바타 자리(w-8)를 대신한다 — 답변이 시작되면 같은 자리에 아바타가 들어와 위치가 튀지 않는다.
 * Thinking Orb 는 reduced-motion·화면 밖·숨은 탭에서 스스로 멈춘다.
 */
const WaitingIndicator: React.FC<{ status: string | null }> = ({ status }) => (
    <div className="flex items-start mt-4 pl-1">
        <div className="flex items-center gap-4 mt-1" role="status" aria-live="polite">
            <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                <ThinkingOrb state="working" size={32} theme="auto" color="#a5b4fc" aria-hidden="true" />
            </span>
            {status && (
                <span key={status} className="status-shimmer text-sm">{status}</span>
            )}
        </div>
    </div>
);

export default WaitingIndicator;
