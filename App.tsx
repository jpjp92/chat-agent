
import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ChatSidebar from './components/ChatSidebar';
import ChatMessage from './components/ChatMessage';
import ChatInput from './components/ChatInput';
import Dialog from './components/Dialog';
import Toast from './components/Toast';
import LoadingScreen from './components/LoadingScreen';
import WelcomeMessage from './components/WelcomeMessage';
import ChatArea from './components/ChatArea';
import { streamChatResponse, summarizeConversation, fetchUrlContent, fetchYoutubeTranscript, loginUser, fetchSessions, createSession, deleteSession, updateSessionTitle, updateRemoteUserProfile, uploadToStorage, fetchSessionMessages } from './services/geminiService';
import { Role, Message, ChatSession, UserProfile, Language, GroundingSource, MessageAttachment } from './types';
import 'katex/dist/katex.min.css';

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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



  const i18n = {
    ko: {
      profileUpdated: "프로필이 업데이트되었습니다.",
      uploadFailed: "파일 업로드에 실패했습니다.",
      renameFailed: "채팅방 이름 변경에 실패했습니다.",
      analyzingImage: "이미지를 분석 중입니다...",
      analyzingDoc: "문서를 분석 중입니다...",
      analyzingFile: "파일을 분석 중입니다...",
      analyzingPaper: "논문 데이터를 정밀하게 분석 중입니다...",
      checkingYoutube: "유튜브 정보를 확인 중입니다...",
      analyzingTranscript: "자막 데이터를 분석 중입니다...",
      watchingVideo: "Gemini가 영상을 시청 중입니다... (1분 정도 소요될 수 있습니다)",
      analyzingVideo: "영상을 분석 중입니다...",
      fetchingUrl: "URL에서 내용을 가져오는 중...",
      preparingSession: "세션을 준비 중입니다"
    },
    en: {
      profileUpdated: "Profile updated.",
      uploadFailed: "File upload failed.",
      renameFailed: "Failed to rename chat.",
      analyzingImage: "Analyzing image...",
      analyzingDoc: "Analyzing document...",
      analyzingFile: "Analyzing file...",
      analyzingPaper: "Analyzing paper data in detail...",
      checkingYoutube: "Checking YouTube info...",
      analyzingTranscript: "Analyzing transcript data...",
      watchingVideo: "Gemini is watching the video... (May take about 1 min)",
      analyzingVideo: "Analyzing video...",
      fetchingUrl: "Fetching content from URL...",
      preparingSession: "Preparing session"
    },
    es: {
      profileUpdated: "Perfil actualizado.",
      uploadFailed: "Error al subir archivo.",
      renameFailed: "Error al cambiar nombre del chat.",
      analyzingImage: "Analizando imagen...",
      analyzingDoc: "Analizando documento...",
      analyzingFile: "Analizando archivo...",
      analyzingPaper: "Analizando datos del artículo...",
      checkingYoutube: "Comprobando información de YouTube...",
      analyzingTranscript: "Analizando transcripción...",
      watchingVideo: "Gemini está viendo el video... (Puede tomar 1 min)",
      analyzingVideo: "Analizando video...",
      fetchingUrl: "Obteniendo contenido de URL...",
      preparingSession: "Preparando sesión"
    },
    fr: {
      profileUpdated: "Profil mis à jour.",
      uploadFailed: "Échec du téléchargement.",
      renameFailed: "Échec du renommage du chat.",
      analyzingImage: "Analyse de l'image...",
      analyzingDoc: "Analyse du document...",
      analyzingFile: "Analyse du fichier...",
      analyzingPaper: "Analyse des données de l'article...",
      checkingYoutube: "Vérification des infos YouTube...",
      analyzingTranscript: "Analyse de la transcription...",
      watchingVideo: "Gemini regarde la vidéo... (Peut prendre 1 min)",
      analyzingVideo: "Analyse de la vidéo...",
      fetchingUrl: "Récupération du contenu URL...",
      preparingSession: "Préparation de la session"
    }
  };

  const t = i18n[language] || i18n.ko;

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
      showToast(t.profileUpdated, "success");
    } catch (e: any) {
      showToast(e.message, "error");
    }
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('gemini_language', lang);
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const handleSendMessage = async (content: string, _old_attachment?: MessageAttachment, attachments: MessageAttachment[] = []) => {
    if (!currentSessionId || (!content.trim() && attachments.length === 0)) return;

    // 0. 첨부파일들이 있는 경우 Supabase Storage에 순차적으로 업로드
    let finalAttachments: MessageAttachment[] = [];

    if (attachments.length > 0) {
      try {
        for (const attachment of attachments) {
          const isImage = attachment.mimeType.startsWith('image/');
          const isVideo = attachment.mimeType.startsWith('video/');
          const isPDF = attachment.mimeType === 'application/pdf';

          // 자연스러운 로딩 문구 설정 (여러 개일 경우 개별 파일명 포함)
          setLoadingStatus(`${attachment.fileName || '파일'} 업로드 중...`);

          const bucket = isVideo ? 'chat-videos' : isImage ? 'chat-imgs' : 'chat-docs';
          const uploadResult = await uploadToStorage({
            fileName: attachment.fileName || (attachment.mimeType.includes('pdf') ? 'document.pdf' : isVideo ? 'video.mp4' : 'image.png'),
            data: attachment.data,
            mimeType: attachment.mimeType
          }, bucket);

          if (uploadResult.error) throw new Error(uploadResult.error);

          // 업로드된 실제 URL로 교체된 새 객체 추가
          finalAttachments.push({ ...attachment, data: uploadResult.url });
        }
      } catch (e: any) {
        showToast(t.uploadFailed, "error");
        console.error("Upload error:", e);
        setLoadingStatus(null);
        return;
      } finally {
        setLoadingStatus(null);
      }
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: Role.USER,
      content,
      timestamp: Date.now(),
      attachments: finalAttachments,
      // 하위 호환성 위해 첫 번째 파일 유지
      attachment: finalAttachments.length > 0 ? finalAttachments[0] : undefined
    };

    let latestHistory: Message[] = [];
    setSessions(prev => prev.map(s => {
      if (s.id === currentSessionId) {
        latestHistory = [...s.messages, userMessage];

        // 여러 문서가 업로드된 경우, 마지막 문서를 컨텍스트로 우선 저장 (향후 다중 컨텍스트 병합 고려 가능)
        const docs = finalAttachments.filter(a => a.extractedText || a.mimeType === 'application/pdf');
        const lastDoc = docs.length > 0 ? docs[docs.length - 1] : undefined;

        return {
          ...s,
          messages: latestHistory,
          lastActiveDoc: lastDoc ? lastDoc : s.lastActiveDoc,
          lastActiveAttachments: finalAttachments.length > 0 ? finalAttachments : s.lastActiveAttachments
        };
      }
      return s;
    }));

    setIsTyping(true);
    let modelResponse = '';
    const modelMessageId = (Date.now() + 1).toString();

    // 지능형 컨텍스트 추출
    const currentSession = sessions.find(s => s.id === currentSessionId);
    let webContext = "";

    // 1. 현재 첨부된 모든 문서들의 텍스트를 컨텍스트에 포함
    if (finalAttachments.length > 0) {
      finalAttachments.forEach(att => {
        if (att.extractedText) {
          webContext += `\n[EXTRACTED_CONTENT: ${att.fileName}]\n${att.extractedText}\n`;
        }
      });
    }

    // 2. 현재 첨부된 문서가 없지만, 세션에 저장된 이전 문서 컨텍스트가 있다면 보조 적용
    if (webContext === "" && currentSession?.lastActiveDoc?.extractedText) {
      const isVideoContext = currentSession.lastActiveDoc.mimeType?.startsWith('video/');
      const tag = isVideoContext ? "[VIDEO_ANALYSIS_SUMMARY]" : "[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT]";
      webContext = `${tag}: ${currentSession.lastActiveDoc.fileName}]\n${currentSession.lastActiveDoc.extractedText}`;
    }

    // URL 감지 로직
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const urls = content.match(urlRegex);
    if (urls && urls.length > 0) {
      let url = urls[0].replace(/[.\)\]\!,?]+$/, '');
      const isArxiv = url.includes('arxiv.org');
      const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

      if (isArxiv) {
        setLoadingStatus(t.analyzingPaper);
        webContext += `\n\n[ARXIV_CONTENT: ${url}]\n` + await fetchUrlContent(url);
        setLoadingStatus(null);
      } else if (isYoutube) {
        setLoadingStatus(t.checkingYoutube);
        const metadata = await fetchUrlContent(url);
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = regExp.exec(url);
        const videoId = (match && match[7].length === 11) ? match[7] : null;

        let transcript = null;
        if (videoId) transcript = await fetchYoutubeTranscript(videoId);

        if (transcript) {
          setLoadingStatus(t.analyzingTranscript);
          webContext += `\n\n[YOUTUBE_CONTENT: ${url}]\n${metadata}\n\n[TRANSCRIPT]\n${transcript}`;
        } else {
          setLoadingStatus(t.watchingVideo);
          webContext += `\n\n[YOUTUBE_METADATA: ${url}]\n${metadata}`;
        }
        setTimeout(() => setLoadingStatus(null), 3000);
      } else {
        setLoadingStatus(t.fetchingUrl);
        webContext += `\n\n[URL_CONTENT: ${url}]\n` + await fetchUrlContent(url);
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
        undefined, // single attachment is deprecated in favor of webContext and internal multi-image handling
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
        currentSessionId,
        finalAttachments // New: Pass multiple attachments to service
      );

      // 영상 분석인 경우, AI의 요약본을 다음 대화를 위한 텍스트 컨텍스트로 저장
      const videoAttachment = finalAttachments.find(a => a.mimeType?.startsWith('video/'));
      if (videoAttachment && modelResponse) {
        setSessions(prev => prev.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              lastActiveDoc: {
                ...videoAttachment,
                extractedText: modelResponse
              }
            };
          }
          return s;
        }));
      }

      // 제목 자동 업데이트
      if (latestHistory.length <= 2) {
        const newTitle = await summarizeConversation([...latestHistory, { id: modelMessageId, role: Role.MODEL, content: modelResponse, timestamp: Date.now() }], language);
        setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title: newTitle } : s));
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
      showToast(t.renameFailed, "error");
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


  if (isAuthLoading || !currentUser) {
    return (
      <LoadingScreen message={t.preparingSession} />
    );
  }

  return (
    <div className="flex h-screen h-dvh w-full bg-white dark:bg-[#131314] text-slate-900 dark:text-[#e3e3e3] overflow-hidden font-sans">
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

      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        <Header
          userProfile={userProfile}
          onUpdateProfile={handleUpdateProfile}
          onMenuClick={() => setIsSidebarOpen(true)}
          showToast={showToast}
          onReset={handleReset}
          language={language}
        />


        <main className="flex-1 overflow-y-auto px-4 sm:px-10 lg:px-20 custom-scrollbar flex flex-col">
          <div className="flex-1 max-w-3xl w-full mx-auto flex flex-col">
            {(!currentSession || currentSession.messages.length === 0) && (
              <WelcomeMessage language={language} />
            )}

            <ChatArea
              messages={currentSession?.messages || []}
              userProfile={userProfile}
              language={language}
              isTyping={isTyping}
              loadingStatus={loadingStatus}
            />
          </div>
        </main>

        <footer className="w-full max-w-4xl mx-auto p-2 sm:p-4 pt-0">
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
