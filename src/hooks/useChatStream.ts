import { useState } from 'react';
import { createSession, fetchUrlContent, fetchYoutubeTranscript, streamChatResponse, summarizeConversation, updateSessionTitle, uploadToStorage } from '../../services/geminiService';
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

          if (!isVideo && estimatedSize < (3 * 1024 * 1024) && isBase64) {
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
      return {
        title: cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be') ? 'YouTube Video' : 'Web Link',
        uri: cleanUrl,
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
        try {
          setLoadingStatus(statusMessages.checkingYoutube);
          const metadata = await fetchUrlContent(url);
          const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?)|(shorts\/))\??v?=?([^#&?]*).*/;
          const match = regExp.exec(url);
          const videoId = match && match[8].length === 11 ? match[8] : null;

          let transcript = null;
          if (videoId) {
            transcript = await fetchYoutubeTranscript(videoId);
          }

          if (transcript) {
            setLoadingStatus(statusMessages.analyzingTranscript);
            webContext += `\n\n${metadata}\n\n[TRANSCRIPT]\n${transcript}`;
          } else {
            setLoadingStatus(statusMessages.watchingVideo);
            webContext += `\n\n${metadata}`;
          }

          youtubeContextUrl = url;
          setTimeout(() => setLoadingStatus(null), 3000);
        } catch (urlError: any) {
          console.error('[useChatStream] YouTube fetch error:', urlError);
          setLoadingStatus(null);
          urlFetchError = true;
        }
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

    try {
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
          setSessions(prev => prev.map(session => {
            if (session.id === activeSessionId) {
              return {
                ...session,
                messages: session.messages.map(message => {
                  if (message.id === modelMessageId) {
                    const allSources = [...manualGroundingSources, ...(sources || [])];
                    const uniqueSources = Array.from(new Map(allSources.map(item => [item.uri, item])).values());
                    return { ...message, groundingSources: uniqueSources.length > 0 ? uniqueSources : undefined };
                  }
                  return message;
                }),
              };
            }
            return session;
          }));
        },
        activeSessionId,
        finalAttachments,
        selectedModel,
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
          await updateSessionTitle(activeSessionId, newTitle);
        } catch (error) {
          console.error('Failed to update session title in DB', error);
        }
      }
    } catch (error: any) {
      hasError = true;
      onError(error.message);
    } finally {
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