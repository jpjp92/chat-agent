
import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Dialog from './components/Dialog';
import Toast from './components/Toast';
import LoadingScreen from './components/LoadingScreen';
import WelcomeMessage from './components/WelcomeMessage';
import ChatArea from './components/ChatArea';
import { updateRemoteUserProfile } from './services/geminiService';
import { UserProfile, Language, MessageAttachment } from './types';
import { useAuthSession } from './src/hooks/useAuthSession';
import { useChatSessions } from './src/hooks/useChatSessions';
import { useChatStream } from './src/hooks/useChatStream';
// katex CSS is imported inside ChatMessage.tsx (lazy chunk) to avoid bloating the critical CSS

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('ko');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-2.5-flash' | 'gemini-2.5-flash-lite'>(
    (localStorage.getItem('preferred_model') as 'gemini-2.5-flash' | 'gemini-2.5-flash-lite') || 'gemini-2.5-flash'
  );
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

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
    createNewSession,
    selectSession,
    removeSession,
    renameSession,
  } = useChatSessions({
    userId: currentUser?.id ?? null,
    onError: (message) => showToast(message, 'error'),
  });



  const i18n = {
    ko: {
      profileUpdated: "프로필 변경 완료",
      uploadFailed: "업로드 실패",
      renameFailed: "이름 변경 실패",
      analyzingImage: "이미지를 분석 중입니다...",
      analyzingDoc: "문서를 분석 중입니다...",
      analyzingFile: "파일을 분석 중입니다...",
      analyzingPaper: "논문 데이터를 정밀하게 분석 중입니다...",
      checkingYoutube: "유튜브 정보를 확인 중입니다...",
      analyzingTranscript: "자막 데이터를 분석 중입니다...",
      watchingVideo: "Gemini가 영상을 시청 중입니다... (1분 정도 소요될 수 있습니다)",
      analyzingVideo: "영상을 분석 중입니다...",
      fetchingUrl: "URL에서 내용을 가져오는 중...",
      preparingSession: "세션을 준비 중입니다",
      identifyingPill: "약품 식별 중... (약학정보원 DB 조회)"
    },
    en: {
      profileUpdated: "Profile updated",
      uploadFailed: "Upload failed",
      renameFailed: "Rename failed",
      analyzingImage: "Analyzing image...",
      analyzingDoc: "Analyzing document...",
      analyzingFile: "Analyzing file...",
      analyzingPaper: "Analyzing paper data in detail...",
      checkingYoutube: "Checking YouTube info...",
      analyzingTranscript: "Analyzing transcript data...",
      watchingVideo: "Gemini is watching the video... (May take about 1 min)",
      analyzingVideo: "Analyzing video...",
      fetchingUrl: "Fetching content from URL...",
      preparingSession: "Preparing session",
      identifyingPill: "Identifying medication... (Searching database)"
    },
    es: {
      profileUpdated: "Perfil actualizado",
      uploadFailed: "Error de subida",
      renameFailed: "Error al renombrar",
      analyzingImage: "Analizando imagen...",
      analyzingDoc: "Analizando documento...",
      analyzingFile: "Analizando archivo...",
      analyzingPaper: "Analizando datos del artículo...",
      checkingYoutube: "Comprobando información de YouTube...",
      analyzingTranscript: "Analizando transcripción...",
      watchingVideo: "Gemini está viendo el video... (Puede tomar 1 min)",
      analyzingVideo: "Analizando video...",
      fetchingUrl: "Obteniendo contenido de URL...",
      preparingSession: "Preparando sesión",
      identifyingPill: "Identificando medicamento... (Buscando base de datos)"
    },
    fr: {
      profileUpdated: "Profil à jour",
      uploadFailed: "Échec d'envoi",
      renameFailed: "Échec du renommage",
      analyzingImage: "Analyse de l'image...",
      analyzingDoc: "Analyse du document...",
      analyzingFile: "Analyse du fichier...",
      analyzingPaper: "Analyse des données de l'article...",
      checkingYoutube: "Vérification des infos YouTube...",
      analyzingTranscript: "Analyse de la transcription...",
      watchingVideo: "Gemini regarde la vidéo... (Peut prendre 1 min)",
      analyzingVideo: "Analyse de la vidéo...",
      fetchingUrl: "Récupération du contenu URL...",
      preparingSession: "Préparation de la session",
      identifyingPill: "Identification du médicament... (Recherche database)"
    }
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
    statusMessages: {
      uploadFailed: t.uploadFailed,
      analyzingImage: t.analyzingImage,
      analyzingPaper: t.analyzingPaper,
      checkingYoutube: t.checkingYoutube,
      analyzingTranscript: t.analyzingTranscript,
      watchingVideo: t.watchingVideo,
      fetchingUrl: t.fetchingUrl,
      identifyingPill: t.identifyingPill,
    },
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
      // showToast(t.profileUpdated, "success");
    } catch (e: any) {
      showToast(e.message, "error");
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


  if (isAuthLoading) {
    return (
      <LoadingScreen message={t.preparingSession} />
    );
  }

  if (!currentUser) {
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
          onModelChange={setSelectedModel}
        />


        <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-10 lg:px-20 custom-scrollbar flex flex-col">
          <div className="flex-1 min-h-0 max-w-3xl w-full mx-auto flex flex-col">
            {(!currentSession || currentSession.messages.length === 0) && (
              <WelcomeMessage language={language} />
            )}

            <ChatArea
              messages={currentSession?.messages || []}
              userProfile={userProfile}
              language={language}
              isTyping={isTyping}
              loadingStatus={loadingStatus}
              onEdit={handleEditMessage}
            />
          </div>
        </main>

        <footer className="w-full max-w-4xl mx-auto p-2 sm:p-4 pt-0">
          <ChatInput onSend={handleSendMessage} disabled={isTyping} language={language} showToast={showToast} editValue={editingMessageContent} />
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
