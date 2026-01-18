
import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Dialog from './components/Dialog';
import Toast from './components/Toast';
import { streamChatResponse, summarizeConversation, fetchUrlContent, fetchYoutubeTranscript, loginUser, fetchSessions, createSession, deleteSession, updateSessionTitle, updateRemoteUserProfile, uploadToStorage, fetchSessionMessages } from './services/geminiService';
import { Role, Message, ChatSession, UserProfile, Language, GroundingSource, MessageAttachment } from './types';

interface SupabaseUser {
  id: number;
  nickname: string;
  created_at: string;
  display_name?: string;
  avatar_url?: string;
}

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('ko');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [loginNickname, setLoginNickname] = useState('');

  // Dialog & Toast State
  const [dialogConfig, setDialogConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'danger' | 'info';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    onConfirm: () => { }
  });

  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>({
    name: 'User',
    avatarUrl: 'https://ui-avatars.com/api/?name=U&background=6366f1&color=fff&rounded=true&bold=true'
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const welcomeMessages = {
    ko: { title: "반가워요!", subtitle: "오늘은 어떤 이야기를 나눌까요?", desc: "궁금한 질문이나 실시간 검색을 해보세요." },
    en: { title: "Hello there!", subtitle: "What's on your mind?", desc: "Ask questions or search in real-time." },
    es: { title: "¡Hola!", subtitle: "¿De qué hablamos hoy?", desc: "Haz preguntas or busca en tempo real." },
    fr: { title: "Bonjour!", subtitle: "De quoi parlons-nous ?", desc: "Posez des questions ou cherchez en direct." }
  };

  useEffect(() => {
    const initAuth = async () => {
      let user: SupabaseUser | null = null;
      const savedUser = localStorage.getItem('gemini_chat_user');

      if (savedUser) {
        user = JSON.parse(savedUser);
      } else {
        // 자동 익명 로그인 처리
        const randomID = Math.random().toString(36).substring(2, 6).toUpperCase();
        const guestNickname = `사용자_${randomID}`;
        try {
          const { user: newUser, error } = await loginUser(guestNickname);
          if (!error && newUser) {
            user = newUser;
            localStorage.setItem('gemini_chat_user', JSON.stringify(newUser));
          }
        } catch (e) {
          console.error("Auto-login failed:", e);
        }
      }

      if (user) {
        setCurrentUser(user);
        setUserProfile({
          name: user.display_name || user.nickname,
          avatarUrl: user.avatar_url || "https://images.unsplash.com/photo-1591160690555-5debfba289f0?w=200&h=200&fit=crop"
        });
        await loadUserSessions(user.id);
      }
      setIsAuthLoading(false);
    };

    initAuth();

    const savedLang = localStorage.getItem('gemini_language') as Language;
    if (savedLang) setLanguage(savedLang);
  }, []);

  const loadUserSessions = async (userId: number) => {
    try {
      const { sessions: dbSessions } = await fetchSessions(userId);
      if (dbSessions && dbSessions.length > 0) {
        // Map DB sessions to ChatSession type
        const mappedSessions: ChatSession[] = await Promise.all(dbSessions.map(async (s: any) => {
          // 각 세션의 마지막 메시지들을 미리 가져오지는 않고, 선택 시 가져옴
          return {
            id: s.id,
            title: s.title,
            messages: [], // 초기엔 빈 배열, 선택 시 로드
            createdAt: new Date(s.created_at).getTime()
          };
        }));
        setSessions(mappedSessions);
        if (mappedSessions.length > 0) handleSelectSession(mappedSessions[0].id);
      } else {
        await handleNewSession(userId);
      }
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  };

  const handleReset = () => {
    localStorage.removeItem('gemini_chat_user');
    window.location.reload(); // 새로고침하여 새로운 익명 사용자로 다시 시작
  };
  // Supabase 연동으로 인해 로컬스토리지 자동 저장은 비활성화하거나 유저 프로필만 남깁니다.
  useEffect(() => {
    // profile만 저장
  }, [userProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, currentSessionId, isTyping]);

  const handleNewSession = async (userId?: number) => {
    const targetUserId = userId || currentUser?.id;
    if (!targetUserId) return;

    try {
      const { session, error } = await createSession(targetUserId);
      if (error) throw new Error(error);

      const newSession: ChatSession = {
        id: session.id,
        title: session.title,
        messages: [],
        createdAt: new Date(session.created_at).getTime()
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setIsSidebarOpen(false);
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleSelectSession = async (id: string) => {
    setCurrentSessionId(id);
    setIsSidebarOpen(false);

    // 해당 세션의 메시지 로드 (비어있는 경우에만)
    const session = sessions.find(s => s.id === id);
    if (session && session.messages.length === 0) {
      try {
        const { messages, error } = await fetchSessionMessages(id);
        if (error) throw new Error(error);
        if (messages) {
          const mappedMessages: Message[] = messages.map((m: any) => ({
            id: m.id,
            role: m.role === 'user' ? Role.USER : Role.MODEL,
            content: m.content,
            timestamp: new Date(m.created_at).getTime(),
            groundingSources: m.grounding_sources,
            attachment: m.attachment_url ? {
              fileName: m.attachment_url.includes('pdf') ? 'document.pdf' : 'image_attached',
              mimeType: m.attachment_url,
              data: '' // 실제 데이터는 스토리지가 아니어서 없음
            } : undefined
          }));
          setSessions(prev => prev.map(s => s.id === id ? { ...s, messages: mappedMessages } : s));
        }
      } catch (e: any) {
        showToast(e.message, "error");
      }
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id);
      const updated = sessions.filter(s => s.id !== id);
      setSessions(updated);
      if (currentSessionId === id) setCurrentSessionId(updated.length > 0 ? updated[0].id : null);
      if (updated.length === 0) await handleNewSession();
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleUpdateProfile = async (profile: UserProfile) => {
    try {
      if (currentUser) {
        // 1. Supabase DB 업데이트
        await updateRemoteUserProfile(currentUser.id, {
          display_name: profile.name,
          avatar_url: profile.avatarUrl
        });

        // 2. 현재 유저 상태 업데이트 (변경된 정보 반영)
        const updatedUser = {
          ...currentUser,
          display_name: profile.name,
          avatar_url: profile.avatarUrl
        };
        setCurrentUser(updatedUser);
        localStorage.setItem('gemini_chat_user', JSON.stringify(updatedUser));
      }

      // 3. UI 프로필 상태 업데이트
      setUserProfile(profile);
      showToast(language === 'ko' ? "프로필이 업데이트되었습니다." : "Profile updated.", "success");
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('gemini_language', lang);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const handleSendMessage = async (content: string, attachment?: MessageAttachment) => {
    if (!currentSessionId || (!content.trim() && !attachment)) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: Role.USER,
      content,
      timestamp: Date.now(),
      attachment
    };

    // 0. 첨부파일이 있는 경우 Supabase Storage에 먼저 업로드
    let finalAttachment = attachment;
    if (attachment && attachment.data) {
      try {
        const isImage = attachment.mimeType.startsWith('image/');
        const isPDF = attachment.mimeType === 'application/pdf';

        // 자연스러운 로딩 문구 설정
        const loadingMsgs = {
          ko: isImage ? "이미지를 분석 중입니다..." : isPDF ? "문서를 분석 중입니다..." : "파일을 분석 중입니다...",
          en: isImage ? "Analyzing image..." : isPDF ? "Analyzing document..." : "Analyzing file...",
          es: isImage ? "Analizando imagen..." : isPDF ? "Analizando documento..." : "Analizando archivo...",
          fr: isImage ? "Analyse de l'image..." : isPDF ? "Analyse du document..." : "Analyse du fichier..."
        };

        setLoadingStatus(loadingMsgs[language as keyof typeof loadingMsgs] || loadingMsgs.ko);

        const bucket = isImage ? 'chat-imgs' : 'chat-docs';
        const uploadResult = await uploadToStorage({
          fileName: attachment.fileName || (attachment.mimeType.includes('pdf') ? 'document.pdf' : 'image.png'),
          data: attachment.data,
          mimeType: attachment.mimeType
        }, bucket);

        if (uploadResult.error) throw new Error(uploadResult.error);

        // 업로드된 실제 URL로 교체
        finalAttachment = { ...attachment, data: uploadResult.url };
      } catch (e: any) {
        showToast(language === 'ko' ? "파일 업로드에 실패했습니다." : "File upload failed.", "error");
        console.error("Upload error:", e);
      } finally {
        setLoadingStatus(null);
      }
    }

    let latestHistory: Message[] = [];
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        // UI에는 즉시 표시 (원본 base64 또는 URL 둘 다 ChatMessage에서 지원됨)
        latestHistory = [...s.messages, { ...userMessage, attachment: finalAttachment }];
        return { ...s, messages: latestHistory };
      }
      return s;
    }));

    setIsTyping(true);
    let modelResponse = '';
    const modelMessageId = (Date.now() + 1).toString();

    // URL 감지 및 지능형 텍스트 추출
    let webContext = "";
    // 더 정교한 URL 정규식 (괄호나 문장부호 포함 가능성 고려)
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const urls = content.match(urlRegex);
    if (urls && urls.length > 0) {
      // 끝에 붙은 문장부호 제거 (., ), ], ,, !, ?)
      let url = urls[0].replace(/[.\)\]\!,?]+$/, '');
      const isArxiv = url.includes('arxiv.org');
      const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

      if (isArxiv) {
        setLoadingStatus(language === 'ko' ? "논문 데이터를 정밀하게 분석 중입니다..." : "Analyzing paper data in detail...");
        webContext = await fetchUrlContent(url);
        setLoadingStatus(null);
      } else if (isYoutube) {
        setLoadingStatus(language === 'ko' ? "유튜브 정보를 확인 중입니다..." : "Checking YouTube info...");

        // 1. 기본 메타데이터 (제목, 채널 등) 가져오기 - 0.2초
        const metadata = await fetchUrlContent(url);

        // 2. 자막 추출 시도 - 1초
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = regExp.exec(url);
        const videoId = (match && match[7].length === 11) ? match[7] : null;

        let transcript = null;
        if (videoId) {
          transcript = await fetchYoutubeTranscript(videoId);
        }

        if (transcript) {
          // 자막 있음: Fast Path (3초)
          setLoadingStatus(language === 'ko' ? "자막 데이터를 분석 중입니다..." : "Analyzing transcript data...");
          webContext = `${metadata}\n\n[TRANSCRIPT]\n${transcript}`;
        } else {
          // 자막 없음: Slow Path (Gemini Video Vision - 60초)
          // Native Video Analysis (api/chat.ts에서 처리됨)
          setLoadingStatus(language === 'ko' ? "Gemini가 영상을 시청 중입니다... (1분 정도 소요될 수 있습니다)" : "Gemini is watching the video... (May take about 1 min)");
          webContext = metadata; // 메타데이터만 줌 -> api/chat.ts가 비디오 처리
        }

        // 잠시 후 로딩 상태 해제 (스트리밍 시작되면 자연스럽게 넘어감)
        setTimeout(() => setLoadingStatus(null), 3000);

      } else {
        setLoadingStatus(language === 'ko' ? "URL에서 내용을 가져오는 중..." : "Fetching content from URL...");
        webContext = await fetchUrlContent(url);
        setLoadingStatus(null);
      }
    }

    try {
      await streamChatResponse(
        content,
        currentSession?.messages || [],
        (chunk, isReset) => {
          if (isReset) modelResponse = "";
          modelResponse += chunk;
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              const existingMsgIndex = s.messages.findIndex(m => m.id === modelMessageId);
              if (existingMsgIndex > -1) {
                const updatedMessages = [...s.messages];
                updatedMessages[existingMsgIndex] = { ...updatedMessages[existingMsgIndex], content: modelResponse };
                return { ...s, messages: updatedMessages };
              } else {
                const newModelMsg: Message = { id: modelMessageId, role: Role.MODEL, content: modelResponse, timestamp: Date.now() };
                return { ...s, messages: [...s.messages, newModelMsg] };
              }
            }
            return s;
          }));
        },
        language,
        attachment,
        webContext,
        'text',
        (sources) => {
          setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
              return {
                ...s,
                messages: s.messages.map(m => m.id === modelMessageId ? { ...m, groundingSources: sources } : m)
              };
            }
            return s;
          }));
        },
        currentSessionId
      );

      // 제목 자동 업데이트
      if (latestHistory.length <= 2) {
        const newTitle = await summarizeConversation([...latestHistory, { id: modelMessageId, role: Role.MODEL, content: modelResponse, timestamp: Date.now() }], language);
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title: newTitle } : s));

        // Supabase DB에도 반영
        try {
          await updateSessionTitle(currentSessionId, newTitle);
        } catch (e) {
          console.error("Failed to update session title in DB", e);
        }
      }

    } catch (error: any) {
      setLoadingStatus(error.message);
      setTimeout(() => setLoadingStatus(null), 5000);
    } finally {
      setIsTyping(false);
    }
  };

  const handleRenameSession = async (id: string, newTitle: string) => {
    try {
      await updateSessionTitle(id, newTitle);
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
    } catch (e) {
      console.error("Failed to rename session", e);
      showToast(language === 'ko' ? "채팅방 이름 변경에 실패했습니다." :
        language === 'es' ? "Error al cambiar el nombre del chat." :
          language === 'fr' ? "Échec du renommage du chat." :
            "Failed to rename chat.", "error");
    }
  };

  const showConfirmDialog = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'info' = 'info') => {
    setDialogConfig({
      isOpen: true,
      title,
      message,
      type,
      onConfirm: () => {
        onConfirm();
        setDialogConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToast({ message, type });
  };

  const currentWelcome = (welcomeMessages as any)[language] || welcomeMessages.ko;

  if (isAuthLoading || !currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-[#131314]">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            {language === 'ko' ? '세션을 준비 중입니다...' : 'Preparing session...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white dark:bg-[#131314] text-slate-900 dark:text-[#e3e3e3] overflow-hidden font-sans">
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        language={language}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLanguageChange={handleLanguageChange}
        onSelectSession={handleSelectSession}
        onNewSession={() => handleNewSession()}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        showConfirmDialog={showConfirmDialog}
      />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <Header
          userProfile={userProfile}
          onUpdateProfile={handleUpdateProfile}
          onMenuClick={() => setIsSidebarOpen(true)}
          showToast={showToast}
          onReset={handleReset}
          language={language}
        />

        <main className="flex-1 overflow-y-auto px-2 sm:px-10 lg:px-20 custom-scrollbar pt-2 sm:pt-4">
          <div className="max-w-3xl mx-auto flex flex-col h-full">
            {currentSession?.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 py-4 sm:py-20 animate-in fade-in zoom-in-95 duration-1000">
                <div className="text-center">
                  <h1 className="text-4xl sm:text-6xl font-medium tracking-tight bg-gradient-to-r from-blue-500 via-purple-500 to-red-500 bg-clip-text text-transparent mb-2 sm:mb-6">
                    {currentWelcome.title}
                  </h1>
                  <p className="text-slate-400 dark:text-slate-500 text-sm sm:text-2xl font-medium px-4">
                    {currentWelcome.subtitle}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col space-y-2">
              {currentSession?.messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} userProfile={userProfile} language={language} />
              ))}
            </div>

            {isTyping && currentSession?.messages && currentSession.messages.length > 0 && currentSession.messages[currentSession.messages.length - 1].role === Role.USER && (
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

            {loadingStatus && (
              <div className="mt-4 p-4 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 text-primary-600 dark:text-primary-400 text-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <i className="fa-solid fa-circle-notch fa-spin"></i>
                  <span>{loadingStatus}</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} className="h-4 sm:h-10" />
          </div>
        </main>

        <footer className="p-1 sm:p-4 pt-0">
          <ChatInput onSend={handleSendMessage} disabled={isTyping} language={language} showToast={showToast} />
          <div className="mt-1 text-center">
            <p className="text-[8px] sm:text-[11px] text-slate-400 dark:text-slate-500 px-4 opacity-70">
              {language === 'ko' ? 'Gemini는 실수할 수 있습니다. (URL 직접 분석 및 PDF 지원)' :
                language === 'es' ? 'Gemini puede cometer errores. (Análisis de URL y soporte PDF)' :
                  language === 'fr' ? 'Gemini peut faire des erreurs. (Analyse URL et support PDF)' :
                    'Gemini may display inaccurate info. (URL analysis & PDF support)'}
            </p>
          </div>
        </footer>
      </div>

      {/* Global Dialog */}
      <Dialog
        isOpen={dialogConfig.isOpen}
        title={dialogConfig.title}
        message={dialogConfig.message}
        type={dialogConfig.type}
        onConfirm={dialogConfig.onConfirm}
        onCancel={() => setDialogConfig(prev => ({ ...prev, isOpen: false }))}
        language={language}
      />

      {/* Global Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default App;
