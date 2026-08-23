
import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Dialog from './components/Dialog';
import AuthModal from './components/AuthModal';
import Toast from './components/Toast';
import LoadingScreen from './components/LoadingScreen';
import WelcomeMessage from './components/WelcomeMessage';
import SuggestChips from './components/SuggestChips';
import ChatArea from './components/ChatArea';
import { UserProfile, Language, MessageAttachment } from './types';
import { useAuthSession } from './src/hooks/useAuthSession';
import { consumeOAuthError } from './lib/supabase/client';
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

  const { currentUser, isAuthLoading, isSigningOut, updateProfile, linkGoogle, signInWithGoogle, signOut, hydratedUserProfile } = useAuthSession();
  // null 이면 닫힘. 'limit' = 한도 도달 자동 유도, 'save' = 설정에서 사용자가 직접 연 경우.
  const [authModalReason, setAuthModalReason] = useState<'save' | 'limit' | null>(null);
  // OAuth 리다이렉트 **후** 거절은 예외가 아니라 URL 로 온다. 읽지 않으면 사용자는
  // 아무 설명 없이 돌아와 같은 버튼을 다시 누른다(실측: 무한 재시도).
  const [linkConflict, setLinkConflict] = useState(false);

  useEffect(() => {
    const code = consumeOAuthError();
    if (!code) return;
    if (code === 'identity_already_exists') {
      setLinkConflict(true);
      setAuthModalReason('save');
    } else {
      console.error('[Auth] OAuth 리다이렉트 에러:', code);
    }
  }, []);
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

  // 게스트가 승계할 실데이터가 있는가 — 빈 기본 세션('New Chat' + 메시지 0)이 아닌
  // 세션이 하나라도 있으면 참. 게스트 데이터는 전부 이 브라우저 안에 있으므로
  // 클라이언트 sessions 상태가 실시간 진실이다(profiles.message_count 는 로드 시점
  // 값이라 대화 직후엔 stale → 그걸 쓰면 대화한 게스트가 고아가 된다).
  // 빈 New Chat 은 로드 시 자동 생성돼 sessions.length 는 항상 ≥1이라 개수로는 못 센다.
  const guestHasData = sessions.some(s => !(s.title === 'New Chat' && s.messages.length === 0));



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
    onGuestLimit: () => setAuthModalReason('limit'),
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

  // '초기화' 버튼은 제거했다. localStorage 시절엔 로컬이 곧 원천이라 "신원 초기화"가
  // 의미를 가졌지만, 대화가 DB로 옮겨간 뒤엔 지워도 새로고침 즉시 복원돼 아무 일도
  // 하지 않는 껍데기가 됐다. 같은 의도(=새 사람으로 시작)는 signOut 이 정확히 수행한다.
  // Supabase 연동으로 인해 로컬스토리지 자동 저장은 비활성화하거나 유저 프로필만 남깁니다.
  useEffect(() => {
    // profile만 저장
  }, [userProfile]);


  const handleNewSession = async (userId?: string) => {
    const newSession = await createNewSession(userId);
    // 추천 칩 prefill은 현재 작성 중인 draft일 뿐 세션 데이터가 아니다. 부모 상태를
    // 비우지 않으면 새 웰컴 ChatInput이 마운트될 때 과거 추천 문구가 다시 주입된다.
    if (newSession) setPrefill(null);
    setIsSidebarOpen(false);
  };

  const handleSelectSession = async (id: string) => {
    setPrefill(null);
    await selectSession(id);
    setIsSidebarOpen(false);
  };

  const handleModelChange = (model: ChatModelId) => {
    setSelectedModel(model);
    localStorage.setItem('preferred_model', model);
  };

  // ChatInput은 전송 후 자신의 input을 비우지만 추천 원본은 App에 있다. 전송 성공 경로에
  // 진입하는 순간 부모 prefill도 소진해 이후 새 채팅/재마운트에서 복원되지 않게 한다.
  const handleSendWithPrefillReset = (
    message: string,
    attachment?: MessageAttachment,
    attachments: MessageAttachment[] = [],
  ) => {
    setPrefill(null);
    return handleSendMessage(message, attachment, attachments);
  };

  const handleDeleteSession = async (id: string) => {
    await removeSession(id);
  };

  const handleUpdateProfile = async (profile: UserProfile) => {
    try {
      // RLS가 본인 행만 허용하므로 클라이언트가 profiles를 직접 갱신한다(라우트 불필요).
      // 훅이 currentUser 상태까지 갱신하므로 로컬 캐시 동기화가 필요 없다.
      if (currentUser) {
        await updateProfile({ display_name: profile.name, avatar_url: profile.avatarUrl });
      }
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


  // 로그아웃은 currentUser 를 null 로 만들지만 실패가 아니다 — 리로드 직전까지
  // 에러 화면 대신 "로그아웃 중" 로딩을 그려 "연결 실패" 번쩍임을 막는다.
  if (isSigningOut) {
    // 정적 "…" 대신 LoadingScreen 의 애니메이션 점(children 없을 때 렌더)으로 말줄임을 대신한다 — 초기 로딩과 일관.
    const outMsg = language === 'es' ? 'Cerrando sesión' : language === 'fr' ? 'Déconnexion' : language === 'en' ? 'Signing out' : '로그아웃 중';
    return <LoadingScreen message={outMsg} />;
  }

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
          isGuest={currentUser?.is_guest ?? true}
          userEmail={currentUser?.email}
          onLogin={() => setAuthModalReason('save')}
          onSwitchAccount={signInWithGoogle}
          onSignOut={signOut}
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
                      onSend={handleSendWithPrefillReset}
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
              onSend={handleSendWithPrefillReset}
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

      <AuthModal
        isOpen={authModalReason !== null}
        reason={authModalReason ?? 'save'}
        onClose={() => { setAuthModalReason(null); setLinkConflict(false); }}
        guestName={userProfile.name}
        guestAvatarUrl={userProfile.avatarUrl}
        // 🔴 "승계할 실데이터가 있나"는 세션 개수가 아니라 message_count 로 판정한다.
        //    빈 New Chat 세션이 로드 시 자동 생성돼 sessions.length 는 항상 ≥1이라
        //    `=== 0` 은 영영 거짓 → 빈 게스트도 linkIdentity 를 타 충돌하던 버그(DEV_260719).
        sessionCount={guestHasData ? sessions.length : 0}
        // 승계할 게 없으면 연결이 아니라 로그인이다. 빈 게스트(= 캐시를 지운 사용자)에게
        // linkIdentity 를 태우면, 이미 쓰던 계정을 고른 순간 충돌로 튕겨나갔다가
        // "기존 계정으로 로그인"을 한 번 더 눌러야 한다. 잃을 게 없을 땐 처음부터 로그인으로.
        onLink={guestHasData ? linkGoogle : signInWithGoogle}
        // 충돌 재시도 — 방금 계정을 골라 돌아왔으니 select_account 를 빼 자동 통과시킨다(두 번 고르는 체감 제거).
        onSignIn={() => signInWithGoogle({ chooseAccount: false })}
        initialConflict={linkConflict}
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
