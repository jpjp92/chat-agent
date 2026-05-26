import { useState, useEffect, useRef } from 'react';
import { createSession, fetchUrlData, streamChatResponse, summarizeConversation, updateSessionTitle, uploadToStorage } from '../../services/geminiService';
import { ChatSession, Language, Message, MessageAttachment, Role } from '../../types';
import { ChatModelId } from '../lib/models';
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
  selectedModel: ChatModelId;
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

          finalAttachments.push(isImage
            ? { ...attachment, storageUrl: uploadResult.url }
            : { ...attachment, data: uploadResult.url }
          );
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
      const MAX_DOC_CHARS = 30_000;
      const raw = activeSession.lastActiveDoc.extractedText;
      const body = raw.length > MAX_DOC_CHARS
        ? raw.slice(0, MAX_DOC_CHARS) + '\n[CONTENT_TRUNCATED: 문서가 길어 일부만 전달됩니다]'
        : raw;
      webContext = `[${tag}: ${activeSession.lastActiveDoc.fileName}]\n${body}`;
    }

    // 코드 블럭(``` ... ```, ~~~ ... ~~~, 인덴트 블럭) 제거 후 URL 추출 — 코드 안의 URL은 fetch 대상 아님
    const contentWithoutCode = content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/~~~[\s\S]*?~~~/g, '')
      .replace(/^( {4}|\t).*/gm, '');
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const urls = contentWithoutCode.match(urlRegex);
    const manualGroundingSources = (urls || [])
      .map(url => url.replace(/[.\)\]\!,?]+$/, ''))
      .filter(cleanUrl => { try { new URL(cleanUrl); return true; } catch { return false; } })
      .map(cleanUrl => {
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
      let isValidUrl = false;

      try {
        const parsedUrl = new URL(rawUrl);
        isValidUrl = true;
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
      } else if (!isValidUrl) {
        // URL 파싱 실패 — fetch 시도하지 않음
      } else {
        try {
          setLoadingStatus(statusMessages.fetchingUrl);
          const urlData = await fetchUrlData(url);
          const { content } = urlData;

          if (content && !content.startsWith('[FETCH_ERROR')) {
            webContext += `\n\n[URL_CONTENT: ${url}]\n${content}`;
          } else {
            const isSecurityBlock = content?.includes('보안 인증이 필요한');
            console.warn('[useChatStream] URL fetch failed —', isSecurityBlock ? 'security block' : 'empty/error');
            urlFetchError = true;
            if (isSecurityBlock) {
              webContext += `\n\n[URL_SECURITY_BLOCKED: ${url}]\n이 URL은 보안 인증(CAPTCHA/Cloudflare 차단)으로 인해 서버에서 직접 접근할 수 없습니다. 사용자에게 이 사실을 알리고, 페이지 본문을 직접 붙여넣거나 접근 가능한 URL을 제공해달라고 안내하세요. 다른 검색 결과로 대체하지 마세요.`;
            } else {
              webContext += `\n\n[URL_FETCH_FAILED: ${url}]\nExact URL content could not be retrieved. Do not summarize other search results or similarly titled pages as a substitute for this URL.`;
            }
          }
          setLoadingStatus(null);
        } catch (urlError: any) {
          console.error('[useChatStream] URL fetch error:', urlError);
          setLoadingStatus(null);
          urlFetchError = true;
          webContext += `\n\n[URL_FETCH_FAILED: ${url}]\nExact URL content could not be retrieved. Do not summarize other search results or similarly titled pages as a substitute for this URL.`;
        }
      }

      // URL fetch 실패 시 정확한 URL 요약을 포기하고 안내 메시지를 반환한다.
      // 검색 fallback은 비슷한 다른 문서를 요약할 수 있어 명시 URL 요약에서는 사용하지 않는다.
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
