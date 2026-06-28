
import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Dialog from './components/Dialog';
import Toast from './components/Toast';
import LoadingScreen from './components/LoadingScreen';
import WelcomeMessage from './components/WelcomeMessage';
import SuggestChips from './components/SuggestChips';
import ChatArea from './components/ChatArea';
import { updateRemoteUserProfile } from './services/geminiService';
import { UserProfile, Language, MessageAttachment } from './types';
import { useAuthSession } from './src/hooks/useAuthSession';
import { useChatSessions } from './src/hooks/useChatSessions';
import { useChatStream } from './src/hooks/useChatStream';
import { DEFAULT_CHAT_MODEL, isChatModelId, type ChatModelId } from './src/lib/models';
// katex CSS is imported inside ChatMessage.tsx (lazy chunk) to avoid bloating the critical CSS

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('ko');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ChatModelId>(() => {
    const storedModel = localStorage.getItem('preferred_model');
    return isChatModelId(storedModel) ? storedModel : DEFAULT_CHAT_MODEL;
  });
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  // 추천 칩 클릭 → 입력창 채움 (ts로 같은 칩 재클릭도 재발화)
  const [prefill, setPrefill] = useState<{ text: string; ts: number } | null>(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

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

  const { currentUser, setCurrentUser, isAuthLoading, clearStoredUser, hydratedUserProfile } = useAuthSession();
  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    isLoadingMessages,
    isLoadingSessions,
    isLoadingMore,
    hasMore,
    createNewSession,
    loadMoreSessions,
    selectSession,
    removeSession,
    renameSession,
  } = useChatSessions({
    userId: currentUser?.id ?? null,
    language,
    onError: (message) => showToast(message, 'error'),
  });



  const i18n = {
    ko: { profileUpdateFailed: "프로필 변경에 실패했습니다. 다시 시도해주세요." },
    en: { profileUpdateFailed: "Failed to update profile. Please try again." },
    es: { profileUpdateFailed: "Error al actualizar el perfil. Por favor, inténtelo de nuevo." },
    fr: { profileUpdateFailed: "Échec de la mise à jour du profil. Veuillez réessayer." },
  };

  const t = i18n[language] || i18n.ko;

  const {
    isTyping,
    loadingStatus,
    editingMessageContent,
    handleEditMessage,
    handleSendMessage,
  } = useChatStream({
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentUser,
    language,
    selectedModel,
    onError: (message) => showToast(message, 'error'),
  });

  useEffect(() => {
    const savedLang = localStorage.getItem('gemini_language') as Language;
    if (savedLang) setLanguage(savedLang);
  }, []);

  useEffect(() => {
    if (hydratedUserProfile) {
      setUserProfile(hydratedUserProfile);
    }
  }, [hydratedUserProfile]);

  const handleReset = () => {
    // React 상태 변경 없이 스토리지만 지우고 바로 reload
    // clearStoredUser()를 먼저 호출하면 currentUser=null 리렌더가 reload보다 먼저 실행돼 에러 화면이 순간 표시됨
    localStorage.removeItem('gemini_chat_user');
    localStorage.removeItem('chat_sessions_cache_v1');
    window.location.reload();
  };
  // Supabase 연동으로 인해 로컬스토리지 자동 저장은 비활성화하거나 유저 프로필만 남깁니다.
  useEffect(() => {
    // profile만 저장
  }, [userProfile]);


  const handleNewSession = async (userId?: number) => {
    await createNewSession(userId);
    setIsSidebarOpen(false);
  };

  const handleSelectSession = async (id: string) => {
    await selectSession(id);
    setIsSidebarOpen(false);
  };

  const handleModelChange = (model: ChatModelId) => {
    setSelectedModel(model);
    localStorage.setItem('preferred_model', model);
  };

  const handleDeleteSession = async (id: string) => {
    await removeSession(id);
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
    } catch (e: any) {
      showToast(t.profileUpdateFailed, "error");
    }
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('gemini_language', lang);
  };

  const handleRenameSession = async (id: string, newTitle: string) => {
    await renameSession(id, newTitle);
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

  useEffect(() => {
    const handleCustomToast = (e: Event) => {
      const customEvent = e as CustomEvent<{message: string, type: 'error' | 'success' | 'info'}>;
      setToast(customEvent.detail);
    };
    window.addEventListener('custom-toast', handleCustomToast);
    return () => window.removeEventListener('custom-toast', handleCustomToast);
  }, []);


  if (!currentUser && !isAuthLoading) {
    const errMsg = language === 'es' ? 'Error de conexión.' : language === 'fr' ? 'Erreur de connexion.' : language === 'en' ? 'Connection failed.' : '연결에 실패했습니다.';
    return (
      <LoadingScreen message={errMsg}>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-5 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 active:scale-95 transition text-white text-sm font-medium shadow"
        >
          {language === 'es' ? 'Reintentar' : language === 'fr' ? 'Réessayer' : language === 'en' ? 'Retry' : '다시 시도'}
        </button>
      </LoadingScreen>
    );
  }

  const isWelcome = !currentSession || currentSession.messages.length === 0;

  return (
    <div
      className="flex h-screen h-dvh w-full text-slate-900 dark:text-[#e3e3e3] overflow-hidden font-sans"
      style={{ background: isDark
        ? 'radial-gradient(ellipse at top left, #1a2b5c 0%, transparent 60%), radial-gradient(ellipse at bottom right, #0f1e3d 0%, transparent 55%), linear-gradient(160deg, #080d1a 0%, #0f1830 100%)'
        : 'linear-gradient(135deg, #f0f2ff 0%, #eef2ff 40%, #e6fff7 100%)'
      }}
    >
      {/* Ambient orbs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        {isDark ? (
          <>
            <div className="orb w-[520px] h-[520px] -top-20 -left-24" style={{background:'oklch(0.45 0.18 240)', opacity:0.45, animationDelay:'0s'}} />
            <div className="orb w-[640px] h-[640px] -bottom-48 -right-36" style={{background:'oklch(0.5 0.16 270)', opacity:0.32, animationDelay:'-7s'}} />
            <div className="orb w-[400px] h-[400px]" style={{background:'oklch(0.42 0.2 210)', opacity:0.25, top:'40%', left:'55%', animationDelay:'-13s'}} />
          </>
        ) : (
          <>
            <div className="orb w-[600px] h-[600px] -top-32 right-0" style={{background:'#c7d2fe', opacity:0.4, animationDelay:'0s'}} />
            <div className="orb w-[500px] h-[500px] bottom-0 -left-24" style={{background:'#bae6fd', opacity:0.32, animationDelay:'-8s'}} />
            <div className="orb w-[400px] h-[400px]" style={{background:'#ddd6fe', opacity:0.25, top:'50%', left:'50%', animationDelay:'-15s'}} />
          </>
        )}
      </div>
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        language={language}
        isOpen={isSidebarOpen}
        isCollapsed={isSidebarCollapsed}
        isLoadingSessions={isLoadingSessions}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={loadMoreSessions}
        onClose={() => setIsSidebarOpen(false)}
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        onLanguageChange={handleLanguageChange}
        onSelectSession={handleSelectSession}
        onNewSession={() => handleNewSession()}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        showConfirmDialog={showConfirmDialog}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full relative overflow-hidden">
        <Header
          userProfile={userProfile}
          onUpdateProfile={handleUpdateProfile}
          onMenuClick={() => setIsSidebarOpen(true)}
          showToast={showToast}
          onReset={handleReset}
          language={language}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
        />


        <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-10 lg:px-20 custom-scrollbar flex flex-col">
          <div className="flex-1 min-h-0 max-w-4xl w-full mx-auto flex flex-col relative">

            {/* Loading overlay — dims welcome msg & past messages, shows spinner */}
            {isLoadingMessages && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-in fade-in duration-300">
                {/* Spinner */}
                <div className="flex flex-col items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent 0%, rgba(99,102,241,0.15) 40%, #6366f1 100%)',
                      animation: 'spin 0.9s linear infinite',
                      WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                      mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Content — dims when loading */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${isLoadingMessages ? 'opacity-25 blur-[1.5px] pointer-events-none select-none' : 'opacity-100 blur-0'}`}>
              {isWelcome ? (
                /* 웰컴: 그리팅 → (데스크톱)입력창 중앙 → 칩. 모바일은 입력창을 하단(footer)에 둠 */
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 sm:gap-9 py-4">
                  <WelcomeMessage language={language} />
                  {/* 데스크톱만 중앙 입력창 (모바일은 footer 하단) */}
                  <div className="hidden md:block w-full max-w-4xl px-1 sm:px-2 mt-4 sm:mt-7">
                    <ChatInput
                      onSend={handleSendMessage}
                      disabled={isTyping || isAuthLoading}
                      language={language}
                      showToast={showToast}
                      editValue={editingMessageContent}
                      selectedModel={selectedModel}
                      onModelChange={handleModelChange}
                      welcome
                      prefill={prefill}
                    />
                  </div>
                  <SuggestChips language={language} onSelect={(s) => setPrefill({ text: s, ts: Date.now() })} />
                </div>
              ) : (
                <ChatArea
                  messages={currentSession?.messages || []}
                  userProfile={userProfile}
                  language={language}
                  isTyping={isTyping}
                  loadingStatus={loadingStatus}
                  isLoadingHistory={isLoadingMessages}
                  onEdit={handleEditMessage}
                />
              )}
            </div>
          </div>
        </main>

        <footer className="w-full max-w-4xl mx-auto p-2 sm:p-4 pt-0">
          {/* 입력창 하단 — 대화중: 항상 / 웰컴: 모바일만(데스크톱은 main 중앙이라 md:hidden) */}
          <div className={isWelcome ? 'md:hidden' : ''}>
            <ChatInput
              onSend={handleSendMessage}
              disabled={isTyping || isAuthLoading}
              language={language}
              showToast={showToast}
              editValue={editingMessageContent}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
            />
          </div>
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
