import { useEffect, useState } from 'react';
import { createSession, deleteSession, fetchSessionMessages, fetchSessions, updateSessionTitle } from '../../services/geminiService';
import { ChatSession, Message, Role } from '../../types';

interface UseChatSessionsOptions {
  userId: number | null;
  language?: string;
  onError?: (message: string) => void;
}

const SESSION_ERRORS: Record<string, Record<string, string>> = {
  createSession: {
    ko: '세션 생성에 실패했습니다. 다시 시도해주세요.',
    en: 'Failed to create session. Please try again.',
    es: 'Error al crear la sesión. Por favor, inténtelo de nuevo.',
    fr: 'Échec de la création de la session. Veuillez réessayer.',
  },
  loadSessions: {
    ko: '세션 목록을 불러오지 못했습니다.',
    en: 'Failed to load sessions.',
    es: 'Error al cargar las sesiones.',
    fr: 'Échec du chargement des sessions.',
  },
  loadMessages: {
    ko: '메시지를 불러오지 못했습니다.',
    en: 'Failed to load session messages.',
    es: 'Error al cargar los mensajes.',
    fr: 'Échec du chargement des messages.',
  },
  deleteSession: {
    ko: '세션 삭제에 실패했습니다.',
    en: 'Failed to delete session.',
    es: 'Error al eliminar la sesión.',
    fr: 'Échec de la suppression de la session.',
  },
  renameSession: {
    ko: '세션 이름 변경에 실패했습니다.',
    en: 'Failed to rename session.',
    es: 'Error al renombrar la sesión.',
    fr: 'Échec du renommage de la session.',
  },
};

const EXT_MIME: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwpx: 'application/x-hwpx',
  csv:  'text/csv',
  mp4:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
};

const inferAttachment = (attachmentUrl: string): { fileName: string; mimeType: string; data: string } => {
  // attachment_url can be an HTTP URL (uploaded) or a bare mimeType string (base64 kept inline)
  if (!attachmentUrl.startsWith('http')) {
    // Stored as mimeType string — data cannot be recovered
    const mime = attachmentUrl;
    const fileName = mime.includes('pdf') ? 'document.pdf'
      : mime.includes('word') ? 'document.docx'
      : mime.includes('sheet') ? 'document.xlsx'
      : mime.includes('presentationml') ? 'document.pptx'
      : mime.includes('hwpx') || mime.includes('x-hwp') ? 'document.hwpx'
      : mime.includes('csv') ? 'document.csv'
      : mime.startsWith('video/') ? 'video.mp4'
      : mime.startsWith('image/') ? 'image_attached'
      : 'document';
    return { fileName, mimeType: mime, data: '' };
  }
  // HTTP URL — infer mimeType from file extension first, then bucket path
  const ext = attachmentUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext && EXT_MIME[ext]) {
    const mimeType = EXT_MIME[ext];
    const fileName = ext === 'pdf' ? 'document.pdf'
      : mimeType.startsWith('video/') ? `video.${ext}`
      : mimeType.startsWith('image/') ? 'image_attached'
      : `document.${ext}`;
    return { fileName, mimeType, data: attachmentUrl };
  }
  // Fallback: bucket path heuristic
  const mimeType = attachmentUrl.includes('/chat-videos/') ? 'video/mp4'
    : attachmentUrl.includes('/chat-docs/') ? 'application/pdf'
    : 'image/jpeg';
  const fileName = mimeType === 'application/pdf' ? 'document.pdf'
    : mimeType.startsWith('video/') ? 'video.mp4'
    : 'image_attached';
  return { fileName, mimeType, data: attachmentUrl };
};

const mapDbMessage = (message: any): Message => ({
  id: message.id,
  role: message.role === 'user' ? Role.USER : Role.MODEL,
  content: message.content,
  timestamp: new Date(message.created_at).getTime(),
  groundingSources: message.grounding_sources,
  attachment: message.attachment_url ? inferAttachment(message.attachment_url) : undefined,
});

const SESSIONS_CACHE_KEY = 'chat_sessions_cache_v1';

const readSessionsCache = (): ChatSession[] => {
  try {
    const raw = localStorage.getItem(SESSIONS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

const writeSessionsCache = (sessions: ChatSession[]) => {
  try {
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions.slice(0, 30)));
  } catch {}
};

export const useChatSessions = ({ userId, language, onError }: UseChatSessionsOptions) => {
  // Hydrate from localStorage cache for instant render; API refresh happens in background
  const [sessions, setSessions] = useState<ChatSession[]>(() => readSessionsCache());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  const lang = (['ko', 'en', 'es', 'fr'].includes(language ?? '')) ? language! : 'ko';

  const reportError = (key: keyof typeof SESSION_ERRORS) => {
    onError?.(SESSION_ERRORS[key][lang]);
  };

  const createNewSession = async (targetUserId?: number) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return null;
    }

    try {
      const { session, error } = await createSession(resolvedUserId);
      if (error || !session) {
        throw new Error(error || 'create_session_failed');
      }

      const newSession: ChatSession = {
        id: session.id,
        title: session.title,
        messages: [],
        createdAt: new Date(session.created_at).getTime(),
      };

      setSessions(prev => {
        const updated = [newSession, ...prev];
        writeSessionsCache(updated);
        return updated;
      });
      setCurrentSessionId(newSession.id);
      return newSession;
    } catch (error) {
      reportError('createSession');
      return null;
    }
  };

  const loadUserSessions = async (targetUserId?: number) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return;
    }

    setIsLoadingSessions(true);
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
        writeSessionsCache(mappedSessions);
        return;
      }

      await createNewSession(resolvedUserId);
    } catch (error) {
      console.error('Failed to load sessions', error);
      reportError('loadSessions');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      setSessions([]);
      setCurrentSessionId(null);
      // Do NOT clear cache when userId is null — this is transient auth-loading state.
      // Cache is only cleared on explicit user reset (handled by caller via window.location.reload).
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

    setIsLoadingMessages(true);
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
      reportError('loadMessages');
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const removeSession = async (id: string) => {
    try {
      await deleteSession(id);
      const updated = sessions.filter(session => session.id !== id);
      setSessions(updated);
      writeSessionsCache(updated);
      if (currentSessionId === id) {
        setCurrentSessionId(updated.length > 0 ? updated[0].id : null);
      }
      if (updated.length === 0) {
        await createNewSession();
      }
    } catch (error) {
      reportError('deleteSession');
    }
  };

  const renameSession = async (id: string, newTitle: string) => {
    try {
      await updateSessionTitle(id, newTitle);
      setSessions(prev => {
        const updated = prev.map(session => (session.id === id ? { ...session, title: newTitle } : session));
        writeSessionsCache(updated);
        return updated;
      });
    } catch (error) {
      console.error('Failed to rename session', error);
      reportError('renameSession');
    }
  };

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    isLoadingMessages,
    isLoadingSessions,
    currentSession: sessions.find(session => session.id === currentSessionId),
    loadUserSessions,
    createNewSession,
    selectSession,
    removeSession,
    renameSession,
  };
};