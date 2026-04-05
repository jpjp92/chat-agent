import { useEffect, useState } from 'react';
import { createSession, deleteSession, fetchSessionMessages, fetchSessions, updateSessionTitle } from '../../services/geminiService';
import { ChatSession, Message, Role } from '../../types';

interface UseChatSessionsOptions {
  userId: number | null;
  onError?: (message: string) => void;
}

const mapDbMessage = (message: any): Message => ({
  id: message.id,
  role: message.role === 'user' ? Role.USER : Role.MODEL,
  content: message.content,
  timestamp: new Date(message.created_at).getTime(),
  groundingSources: message.grounding_sources,
  attachment: message.attachment_url
    ? {
        fileName: message.attachment_url.includes('pdf') ? 'document.pdf' : 'image_attached',
        mimeType: message.attachment_url,
        data: '',
      }
    : undefined,
});

export const useChatSessions = ({ userId, onError }: UseChatSessionsOptions) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const reportError = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    onError?.(message);
  };

  const createNewSession = async (targetUserId?: number) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return null;
    }

    try {
      const { session, error } = await createSession(resolvedUserId);
      if (error || !session) {
        throw new Error(error || 'Failed to create session');
      }

      const newSession: ChatSession = {
        id: session.id,
        title: session.title,
        messages: [],
        createdAt: new Date(session.created_at).getTime(),
      };

      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      return newSession;
    } catch (error) {
      reportError(error, 'Failed to create session');
      return null;
    }
  };

  const loadUserSessions = async (targetUserId?: number) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return;
    }

    try {
      const { sessions: dbSessions } = await fetchSessions(resolvedUserId);

      if (dbSessions && dbSessions.length > 0) {
        const mappedSessions: ChatSession[] = dbSessions.map((session: any) => ({
          id: session.id,
          title: session.title,
          messages: [],
          createdAt: new Date(session.created_at).getTime(),
        }));
        setSessions(mappedSessions);
        return;
      }

      await createNewSession(resolvedUserId);
    } catch (error) {
      console.error('Failed to load sessions', error);
      reportError(error, 'Failed to load sessions');
    }
  };

  useEffect(() => {
    if (!userId) {
      setSessions([]);
      setCurrentSessionId(null);
      return;
    }

    void loadUserSessions(userId);
  }, [userId]);

  const selectSession = async (id: string) => {
    setCurrentSessionId(id);

    const session = sessions.find(item => item.id === id);
    if (!session || session.messages.length > 0) {
      return;
    }

    try {
      const { messages, error } = await fetchSessionMessages(id);
      if (error) {
        throw new Error(error);
      }

      if (messages) {
        const mappedMessages = messages.map(mapDbMessage);
        setSessions(prev => prev.map(item => (item.id === id ? { ...item, messages: mappedMessages } : item)));
      }
    } catch (error) {
      reportError(error, 'Failed to load session messages');
    }
  };

  const removeSession = async (id: string) => {
    try {
      await deleteSession(id);
      const updated = sessions.filter(session => session.id !== id);
      setSessions(updated);
      if (currentSessionId === id) {
        setCurrentSessionId(updated.length > 0 ? updated[0].id : null);
      }
      if (updated.length === 0) {
        await createNewSession();
      }
    } catch (error) {
      reportError(error, 'Failed to delete session');
    }
  };

  const renameSession = async (id: string, newTitle: string) => {
    try {
      await updateSessionTitle(id, newTitle);
      setSessions(prev => prev.map(session => (session.id === id ? { ...session, title: newTitle } : session)));
    } catch (error) {
      console.error('Failed to rename session', error);
      reportError(error, 'Failed to rename session');
    }
  };

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession: sessions.find(session => session.id === currentSessionId),
    loadUserSessions,
    createNewSession,
    selectSession,
    removeSession,
    renameSession,
  };
};