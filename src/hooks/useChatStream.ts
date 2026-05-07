import { useState, useEffect, useRef } from 'react';
import { createSession, fetchUrlContent, streamChatResponse, summarizeConversation, updateSessionTitle, uploadToStorage } from '../../services/geminiService';
import { ChatSession, Language, Message, MessageAttachment, Role } from '../../types';
import { SupabaseUser } from './useAuthSession';

interface ChatStreamMessages {
  uploadFailed: string;
  analyzingImage: string;
  analyzingPaper: string;
  checkingYoutube: string;
  analyzingTranscript: string;
  watchingVideo: string;
  fetchingUrl: string;
  identifyingPill: string;
}

interface UseChatStreamOptions {
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  currentSessionId: string | null;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  currentUser: SupabaseUser | null;
  language: Language;
  selectedModel: 'gemini-2.5-flash' | 'gemini-2.5-flash-lite';
  statusMessages: ChatStreamMessages;
  onError: (message: string) => void;
}

export const useChatStream = ({
  sessions,
  setSessions,
  currentSessionId,
  setCurrentSessionId,
  currentUser,
  language,
  selectedModel,
  statusMessages,
  onError,
}: UseChatStreamOptions) => {
  const [isTyping, setIsTyping] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState<string | undefined>(undefined);

  const prevSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = currentSessionId;
    // null → sessionId 전환은 새 세션 생성(handleSendMessage 내부) — 리셋 생략
    // sessionId → anything 전환은 사용자 세션 전환 — isTyping/loadingStatus 리셋
    if (prev === null && currentSessionId !== null) return;
    setIsTyping(false);
    setLoadingStatus(null);
  }, [currentSessionId]);

  const handleEditMessage = (content: string) => {
    setEditingMessageContent(content);
  };

  const handleSendMessage = async (content: string, _oldAttachment?: MessageAttachment, attachments: MessageAttachment[] = []) => {
    if (!content.trim() && attachments.length === 0) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: Role.USER,
      content,
      timestamp: Date.now(),
      attachments,
      attachment: attachments.length > 0 ? attachments[0] : undefined,
    };

    const docs = attachments.filter(attachment => attachment.extractedText || attachment.mimeType === 'application/pdf');
    const lastDoc = docs.length > 0 ? docs[docs.length - 1] : undefined;

    let activeSessionId = currentSessionId;
    let latestHistory: Message[] = [];

    if (!activeSessionId) {
      const targetUserId = currentUser?.id;
      if (!targetUserId) return;
      setIsTyping(true);
      try {
        const { session, error } = await createSession(targetUserId);
        if (error || !session) {
          setIsTyping(false);
          onError(error || 'Failed to create session');
          return;
        }

        latestHistory = [userMessage];
        const newSession: ChatSession = {
          id: session.id,
          title: session.title,
          messages: latestHistory,
          createdAt: new Date(session.created_at).getTime(),
          lastActiveDoc: lastDoc ?? undefined,
        };
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(session.id);
        activeSessionId = session.id;
      } catch (error: any) {
        setIsTyping(false);
        onError(error.message);
        return;
      }
    } else {
      setSessions(prev => prev.map(session => {
        if (session.id === activeSessionId) {
          latestHistory = [...session.messages, userMessage];
          return {
            ...session,
            messages: latestHistory,
            lastActiveDoc: lastDoc ? lastDoc : session.lastActiveDoc,
          };
        }
        return session;
      }));
    }

    setIsTyping(true);

    let finalAttachments: MessageAttachment[] = [];

    if (attachments.length > 0) {
      try {
        for (const attachment of attachments) {
          const isImage = attachment.mimeType.startsWith('image/');
          const isVideo = attachment.mimeType.startsWith('video/');
          const isBase64 = !attachment.data.startsWith('http');
          const base64Data = attachment.data.includes(',') ? attachment.data.split(',')[1] : attachment.data;
          const estimatedSize = isBase64 ? (base64Data.length * 0.75) : 0;

          // 이미지: 크기 무관하게 항상 Supabase 업로드 (히스토리 미리보기 복원을 위해)
          // 비디오: 항상 업로드 (크기 이슈)
          // 문서: 1MB 미만 base64 inline 허용 (Vercel payload 4.5MB 제한 우회)
          if (!isImage && !isVideo && estimatedSize < (1 * 1024 * 1024) && isBase64) {
            finalAttachments.push(attachment);
            continue;
          }

          setLoadingStatus(`${attachment.fileName || '파일'} 업로드 중...`);

          const bucket = isVideo ? 'chat-videos' : isImage ? 'chat-imgs' : 'chat-docs';
          const uploadResult = await uploadToStorage({
            fileName: attachment.fileName || (attachment.mimeType.includes('pdf') ? 'document.pdf' : isVideo ? 'video.mp4' : 'image.png'),
            data: attachment.data,
            mimeType: attachment.mimeType,
          }, bucket);

          finalAttachments.push({ ...attachment, data: uploadResult.url });
        }
      } catch (error: any) {
        console.error('Upload error:', error);
        onError(statusMessages.uploadFailed);
        setLoadingStatus(null);
        setIsTyping(false);
        return;
      } finally {
        setLoadingStatus(null);
      }
    }

    latestHistory = latestHistory.map((message, index) => {
      if (index === latestHistory.length - 1) {
        return {
          ...message,
          attachments: finalAttachments,
          attachment: finalAttachments.length > 0 ? finalAttachments[0] : undefined,
        };
      }
      return message;
    });

    let modelResponse = '';
    let pendingSources: any[] = [];
    const modelMessageId = (Date.now() + 1).toString();

    const hasLargeFile = finalAttachments.some(attachment => attachment.mimeType === 'application/pdf');
    const pillKeywords = ['알약', '약품', '정', '캡슐', '명칭', '식별', '무슨 약'];
    const hasPillKeyword = pillKeywords.some(keyword => content.includes(keyword)) || /(?:^|\s)약(?:$|\s|이|을|은|에|과|도|은|는)/.test(content);
    const hasImage = finalAttachments.some(attachment => attachment.mimeType.startsWith('image/'));

    if (hasPillKeyword && hasImage) {
      setLoadingStatus(statusMessages.identifyingPill);
    } else if (hasLargeFile) {
      setLoadingStatus('Gemini가 대용량 문서를 정교하게 분석 중입니다 (10~20초 소요 가능)...');
    } else if (hasImage) {
      setLoadingStatus(statusMessages.analyzingImage);
    } else if (finalAttachments.length > 0) {
      setLoadingStatus('첨부파일 분석 중...');
    }

    const activeSession = sessions.find(session => session.id === activeSessionId);
    let webContext = '';

    if (finalAttachments.length > 0) {
      finalAttachments.forEach(attachment => {
        if (attachment.extractedText) {
          webContext += `\n[EXTRACTED_CONTENT: ${attachment.fileName}]\n${attachment.extractedText}\n`;
        }
      });
    }

    if (webContext === '' && activeSession?.lastActiveDoc?.extractedText) {
      const isVideoContext = activeSession.lastActiveDoc.mimeType?.startsWith('video/');
      const tag = isVideoContext ? 'VIDEO_ANALYSIS_SUMMARY' : 'PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT';
      webContext = `[${tag}: ${activeSession.lastActiveDoc.fileName}]\n${activeSession.lastActiveDoc.extractedText}`;
    }

    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const urls = content.match(urlRegex);
    const manualGroundingSources = (urls || []).map(url => {
      const cleanUrl = url.replace(/[.\)\]\!,?]+$/, '');
      const isYt = cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be');
      // Normalize YouTube URL to canonical form — backend sources use youtube.com/watch?v=ID,
      // so dedup (Map keyed by uri) works correctly regardless of original URL format (youtu.be, shorts, etc.)
      let normalizedUrl = cleanUrl;
      if (isYt) {
        const ytIdMatch = cleanUrl.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
        if (ytIdMatch) normalizedUrl = `https://www.youtube.com/watch?v=${ytIdMatch[1]}`;
      }
      return {
        title: isYt ? 'YouTube Video' : 'Web Link',
        uri: normalizedUrl,
      };
    });

    let youtubeContextUrl = '';

    if (urls && urls.length > 0) {
      const rawUrl = urls[0].replace(/[.\)\]\!,?]+$/, '');
      let url = rawUrl;
      let isArxiv = false;
      let isPdf = false;
      let isYoutube = false;
      let urlFetchError = false;

      try {
        const parsedUrl = new URL(rawUrl);
        const paramsToStrip = ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
        let hasStripped = false;

        paramsToStrip.forEach(param => {
          if (parsedUrl.searchParams.has(param)) {
            parsedUrl.searchParams.delete(param);
            hasStripped = true;
          }
        });

        if (hasStripped) {
          url = parsedUrl.toString();
        }

        isArxiv = parsedUrl.hostname.includes('arxiv.org');
        isYoutube = parsedUrl.hostname.includes('youtube.com') || parsedUrl.hostname.includes('youtu.be');
        isPdf = parsedUrl.pathname.toLowerCase().endsWith('.pdf');
      } catch {
        isArxiv = url.includes('arxiv.org');
        isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
        isPdf = url.toLowerCase().endsWith('.pdf');
      }

      if (isArxiv) {
        setLoadingStatus(statusMessages.analyzingPaper);
        finalAttachments.push({ fileName: 'arxiv.pdf', mimeType: 'application/pdf', data: url });
        webContext += '\n[ARXIV_PDF_LINK_QUEUED]';
        setLoadingStatus(null);
      } else if (isYoutube) {
        // fetch-url.ts 호출 제거: Gemini가 fileData로 영상을 직접 분석하므로 중복
        // 제목/채널/description 텍스트 사전 수집 불필요 → 8~10초 절감
        setLoadingStatus(statusMessages.watchingVideo);
        youtubeContextUrl = url;
        setTimeout(() => setLoadingStatus(null), 3000);
      } else if (isPdf) {
        finalAttachments.push({ fileName: 'document.pdf', mimeType: 'application/pdf', data: url });
        webContext += '\n[URL_PDF_LINK_QUEUED]';
      } else {
        try {
          setLoadingStatus(statusMessages.fetchingUrl);
          const pageContent = await fetchUrlContent(url);
          if (pageContent) {
            webContext += `\n\n[URL_CONTENT: ${url}]\n${pageContent}`;
          } else {
            console.warn('[useChatStream] URL fetch returned empty — skipping URL_CONTENT tag, Google Search will be used');
            urlFetchError = true;
          }
          setLoadingStatus(null);
        } catch (urlError: any) {
          console.error('[useChatStream] URL fetch error:', urlError);
          setLoadingStatus(null);
          urlFetchError = true;
        }
      }

      // URL fetch 실패 시 에러를 띄우지 않음 — Google Search가 자동으로 대체
      // (URL_CONTENT 태그가 없으면 generator에서 useGoogleSearch=true 유지)
    }

    let hasError = false;

    const attemptStream = async (attempt: number) => {
      // 재시도 시 이전 부분 응답 초기화
      if (attempt > 0) {
        modelResponse = '';
        setSessions(prev => prev.map(session => {
          if (session.id !== activeSessionId) return session;
          return {
            ...session,
            messages: session.messages.map(msg =>
              msg.id === modelMessageId ? { ...msg, content: '' } : msg
            ),
          };
        }));
        setLoadingStatus('재시도 중...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      await streamChatResponse(
        content,
        activeSession?.messages || [],
        (chunk, isReset) => {
          if (isReset) modelResponse = '';
          modelResponse += chunk;

          setSessions(prev => prev.map(session => {
            if (session.id === activeSessionId) {
              const existingMsgIndex = session.messages.findIndex(message => message.id === modelMessageId);
              if (existingMsgIndex > -1) {
                const updatedMessages = [...session.messages];
                updatedMessages[existingMsgIndex] = { ...updatedMessages[existingMsgIndex], content: modelResponse };
                return { ...session, messages: updatedMessages };
              }

              const newModelMessage: Message = {
                id: modelMessageId,
                role: Role.MODEL,
                content: modelResponse,
                timestamp: Date.now(),
                groundingSources: manualGroundingSources.length > 0 ? manualGroundingSources : undefined,
              };
              return { ...session, messages: [...session.messages, newModelMessage] };
            }
            return session;
          }));
        },
        language,
        undefined,
        webContext,
        'text',
        (sources) => {
          // Store sources to apply after streaming completes — avoids chips appearing mid-stream
          pendingSources = sources || [];
        },
        activeSessionId ?? undefined,
        finalAttachments,
        selectedModel,
        () => {
          // cutOff: 서버가 mid-stream 에러로 부분 응답만 반환한 경우
          setSessions(prev => prev.map(session => {
            if (session.id === activeSessionId) {
              return {
                ...session,
                messages: session.messages.map(msg =>
                  msg.id === modelMessageId ? { ...msg, isCutOff: true } : msg
                ),
              };
            }
            return session;
          }));
        },
      );

      const videoAttachment = finalAttachments.find(attachment => attachment.mimeType?.startsWith('video/'));
      if (videoAttachment && modelResponse) {
        setSessions(prev => prev.map(session => {
          if (session.id === activeSessionId) {
            return {
              ...session,
              lastActiveDoc: {
                ...videoAttachment,
                extractedText: modelResponse,
              },
            };
          }
          return session;
        }));
      }

      if (youtubeContextUrl && modelResponse) {
        setSessions(prev => prev.map(session => {
          if (session.id === activeSessionId) {
            return {
              ...session,
              lastActiveDoc: {
                fileName: youtubeContextUrl,
                mimeType: 'video/youtube',
                data: youtubeContextUrl,
                extractedText: modelResponse,
              },
            };
          }
          return session;
        }));
      }

      if (latestHistory.length <= 2) {
        const newTitle = await summarizeConversation([
          ...latestHistory,
          { id: modelMessageId, role: Role.MODEL, content: modelResponse, timestamp: Date.now() },
        ], language);
        setSessions(prev => prev.map(session => (session.id === activeSessionId ? { ...session, title: newTitle } : session)));
        try {
          await updateSessionTitle(activeSessionId!, newTitle);
        } catch (error) {
          console.error('Failed to update session title in DB', error);
        }
      }
    };

    try {
      try {
        await attemptStream(0);
      } catch (firstError: any) {
        // cold start / 일시 무응답 / 모바일 네트워크 에러 시 1회 자동 재시도
        const isRetryable = firstError.message?.includes('응답을 받지 못했습니다') ||
                            firstError.message?.includes('LLM returned empty response') ||
                            firstError.message?.includes('Failed to fetch') ||
                            firstError.name === 'TypeError';  // 네트워크 오류
        if (isRetryable) {
          console.warn('[useChatStream] Retrying after empty response...');
          await attemptStream(1);
        } else {
          throw firstError;
        }
      }
    } catch (error: any) {
      hasError = true;
      onError(error.message);
    } finally {
      // Apply any pending sources after streaming completes — chips appear only after full response
      if (pendingSources.length > 0) {
        setSessions(prev => prev.map(session => {
          if (session.id !== activeSessionId) return session;
          return {
            ...session,
            messages: session.messages.map(message => {
              if (message.id !== modelMessageId) return message;
              const allSources = [...manualGroundingSources, ...pendingSources];
              const uniqueSources = Array.from(new Map(allSources.map(item => [item.uri, item])).values());
              return { ...message, groundingSources: uniqueSources.length > 0 ? uniqueSources : undefined };
            }),
          };
        }));
      }
      setIsTyping(false);
      setLoadingStatus(null);
      setEditingMessageContent(undefined);
    }
  };

  return {
    isTyping,
    loadingStatus,
    editingMessageContent,
    handleEditMessage,
    handleSendMessage,
  };
};