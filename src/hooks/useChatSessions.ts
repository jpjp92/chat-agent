import { useEffect, useRef, useState } from 'react';
import { createSession, deleteSession, fetchSessionMessages, fetchSessions, updateSessionTitle } from '../../services/geminiService';
import { ChatSession, Message, Role } from '../../types';

interface UseChatSessionsOptions {
  userId: string | null;
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
const SESSION_PAGE_SIZE = 30;
const DEFAULT_SESSION_TITLE = 'New Chat';

/**
 * 🔴 캐시에는 **소유자를 새긴다.**
 *
 * 예전엔 전역 키 하나에 세션 목록만 담았다. 그래서 로그아웃 후 새 게스트가 이전 유저의
 * **대화 제목을 그대로 봤다**(실측). RLS 는 DB 를 지키지만 localStorage 는 못 지킨다 —
 * 캐시가 유저를 구분하지 않으면 화면에서 새어나간다.
 *
 * 소유자가 바뀌면 캐시는 버린다. 유저 전환은 signOut(→새 게스트) 과
 * signInWithGoogle(→다른 uuid) 두 경로로 일어난다. linkIdentity 는 uuid 가 유지되므로
 * 캐시가 그대로 유효하다.
 */
interface SessionsCache {
  ownerId: string;
  sessions: ChatSession[];
}

const readSessionsCacheRaw = (): SessionsCache | null => {
  try {
    const raw = localStorage.getItem(SESSIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 소유자가 없는 구버전 캐시는 신뢰할 수 없다 → 버린다.
    if (!parsed?.ownerId || !Array.isArray(parsed.sessions)) return null;
    return {
      ownerId: parsed.ownerId,
      sessions: parsed.sessions.filter(
        (session: ChatSession) => !(session.title === DEFAULT_SESSION_TITLE && session.messages.length === 0)
      ),
    };
  } catch { return null; }
};

export const clearSessionsCache = () => {
  try { localStorage.removeItem(SESSIONS_CACHE_KEY); } catch {}
};

export const writeSessionsCache = (sessions: ChatSession[], ownerId: string | null) => {
  // 소유자를 모르면 쓰지 않는다. 주인 없는 캐시가 다음 유저에게 새는 걸 막는다.
  if (!ownerId) return;
  try {
    // 메시지는 캐시하지 않는다 — DB(chat_messages)가 메시지의 단일 출처.
    // 과거엔 부분 스냅샷(1턴)만 캐시에 남아 멀티턴 재로드 시 나머지 턴이 가려졌다.
    // 세션 목록 메타(title 등)만 캐시해 즉시 렌더하고, 메시지는 selectSession에서 DB lazy-load.
    const metaOnly = sessions.slice(0, 30).map(session => ({ ...session, messages: [] }));
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify({ ownerId, sessions: metaOnly }));
  } catch {}
};

const mergeSessionsPreservingLocalMessages = (localSessions: ChatSession[], dbSessions: ChatSession[]) => {
  const localById = new Map(localSessions.map(session => [session.id, session]));
  const dbIds = new Set(dbSessions.map(session => session.id));

  const mergedDbSessions = dbSessions.map(dbSession => {
    const localSession = localById.get(dbSession.id);
    if (!localSession) return dbSession;

    return {
      ...dbSession,
      title: localSession.title !== DEFAULT_SESSION_TITLE ? localSession.title : dbSession.title,
      messages: localSession.messages.length > 0 ? localSession.messages : dbSession.messages,
      lastActiveDoc: localSession.lastActiveDoc ?? dbSession.lastActiveDoc,
    };
  });

  const localOnlySessions = localSessions.filter(session => !dbIds.has(session.id));
  return [...localOnlySessions, ...mergedDbSessions];
};

export const useChatSessions = ({ userId, language, onError }: UseChatSessionsOptions) => {
  // Hydrate from localStorage cache for instant render; API refresh happens in background.
  // 마운트 시점엔 아직 userId 를 모른다(익명 로그인이 진행 중) → 일단 그리고, 아래 effect 가
  // 소유자를 확인해 남의 캐시면 즉시 버린다.
  const cachedRef = useRef(readSessionsCacheRaw());
  const [sessions, setSessions] = useState<ChatSession[]>(() => cachedRef.current?.sessions ?? []);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sessionOffset, setSessionOffset] = useState(0);

  const lang = (['ko', 'en', 'es', 'fr'].includes(language ?? '')) ? language! : 'ko';

  const reportError = (key: keyof typeof SESSION_ERRORS) => {
    onError?.(SESSION_ERRORS[key][lang]);
  };

  // 유저가 바뀌면 남의 캐시를 즉시 버린다. signOut 이 미리 지우지만, signInWithGoogle
  // (다른 uuid 로 로그인)로도 전환이 일어나므로 여기서 한 번 더 막는다.
  useEffect(() => {
    if (!userId) return;
    const cached = cachedRef.current;
    if (cached && cached.ownerId !== userId) {
      cachedRef.current = null;
      clearSessionsCache();
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [userId]);

  const createNewSession = async (targetUserId?: string) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return null;
    }

    try {
      const { session, error } = await createSession();
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
        writeSessionsCache(updated, userId);
        return updated;
      });
      setCurrentSessionId(newSession.id);
      return newSession;
    } catch (error) {
      reportError('createSession');
      return null;
    }
  };

  const loadUserSessions = async (targetUserId?: string) => {
    const resolvedUserId = targetUserId ?? userId;
    if (!resolvedUserId) {
      return;
    }

    setIsLoadingSessions(true);
    try {
      const { sessions: dbSessions, hasMore: apiHasMore } = await fetchSessions(0, SESSION_PAGE_SIZE);

      if (dbSessions && dbSessions.length > 0) {
        const mappedSessions: ChatSession[] = dbSessions.map((session: any) => ({
          id: session.id,
          title: session.title,
          messages: [],
          createdAt: new Date(session.created_at).getTime(),
        }));
        setSessions(prev => {
          const updated = mergeSessionsPreservingLocalMessages(prev, mappedSessions);
          writeSessionsCache(updated, userId);
          return updated;
        });
        setSessionOffset(SESSION_PAGE_SIZE);
        setHasMore(apiHasMore ?? false);
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

  const loadMoreSessions = async () => {
    if (!userId || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const { sessions: dbSessions, hasMore: apiHasMore } = await fetchSessions(sessionOffset, SESSION_PAGE_SIZE);
      if (dbSessions && dbSessions.length > 0) {
        const mappedSessions: ChatSession[] = dbSessions.map((session: any) => ({
          id: session.id,
          title: session.title,
          messages: [],
          createdAt: new Date(session.created_at).getTime(),
        }));
        setSessions(prev => {
          const existingIds = new Set(prev.map(s => s.id));
          const newSessions = mappedSessions.filter(s => !existingIds.has(s.id));
          return [...prev, ...newSessions];
        });
        setSessionOffset(prev => prev + SESSION_PAGE_SIZE);
        setHasMore(apiHasMore ?? false);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more sessions', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      // userId null = auth 초기화 중인 transient 상태.
      // sessions는 localStorage 캐시 hydration 값을 유지해 세션 목록 깜빡임 방지.
      // 실제 유저 리셋은 호출부에서 window.location.reload()로 처리.
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
      writeSessionsCache(updated, userId);
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
        writeSessionsCache(updated, userId);
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
    isLoadingMore,
    hasMore,
    currentSession: sessions.find(session => session.id === currentSessionId),
    loadUserSessions,
    loadMoreSessions,
    createNewSession,
    selectSession,
    removeSession,
    renameSession,
  };
};
