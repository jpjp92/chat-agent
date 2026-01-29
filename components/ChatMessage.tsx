
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'https://esm.sh/react-markdown@9';
import remarkGfm from 'https://esm.sh/remark-gfm@4';
import remarkMath from 'https://esm.sh/remark-math@6';
import rehypeKatex from 'https://esm.sh/rehype-katex@7';
import { Role, Message, UserProfile } from '../types';
import { generateSpeech, playRawAudio, stopAudio, initAudioContext } from '../services/geminiService';
import ChartRenderer from './ChartRenderer';
import ChemicalRenderer from './ChemicalRenderer';
import BioRenderer from './BioRenderer';

type Language = 'ko' | 'en' | 'es' | 'fr';

interface ChatMessageProps {
  message: Message;
}

interface ChatMessageFullProps extends ChatMessageProps {
  userProfile?: UserProfile;
  language?: Language;
}

const ChatMessage: React.FC<ChatMessageFullProps> = ({ message, userProfile, language = 'ko' }) => {
  const isUser = message.role === Role.USER;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const i18n = {
    ko: { pdf: 'PDF 문서', attachment: '첨부파일' },
    en: { pdf: 'PDF Document', attachment: 'Attachment' },
    es: { pdf: 'Documento PDF', attachment: 'Adjunto' },
    fr: { pdf: 'Document PDF', attachment: 'Pièce jointe' }
  };

  const t = i18n[language] || i18n.ko;

  const attachment = message.attachment || message.image;

  useEffect(() => {
    return () => {
      if (isPlaying) {
        stopAudio();
      }
    };
  }, [isPlaying]);

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handlePlayVoice = async () => {
    // 모바일 브라우저 오디오 잠금 해제 (반드시 유무 제스처 이벤트 내에서 호출되어야 함)
    await initAudioContext();

    if (isPlaying || isGenerating) {
      stopAudio();
      setIsPlaying(false);
      setIsGenerating(false);
      return;
    }

    if (!message.content) return;

    setIsGenerating(true);
    try {
      const plainText = message.content.replace(/[#*`_~]/g, '').slice(0, 2000);
      const audioData = await generateSpeech(plainText);

      setIsGenerating(false);
      setIsPlaying(true);
      await playRawAudio(audioData);
    } catch (error) {
      console.error("TTS System Error:", error);
    } finally {
      setIsGenerating(false);
      setIsPlaying(false);
    }
  };

  const MarkdownComponents = {
    h1: ({ ...props }) => <h1 className="text-xl font-bold mb-4 mt-2 text-slate-900 dark:text-white" {...props} />,
    h2: ({ ...props }) => <h2 className="text-lg font-bold mb-3 mt-4 text-slate-800 dark:text-slate-100" {...props} />,
    p: ({ ...props }) => <p className="mb-4 last:mb-0 leading-relaxed text-[15px] sm:text-[16px] break-all" style={{ overflowWrap: 'anywhere' }} {...props} />,
    ul: ({ ...props }) => <ul className="list-disc ml-5 mb-4 space-y-2" {...props} />,
    li: ({ ...props }) => <li className="pl-1 text-slate-700 dark:text-slate-300 break-all" style={{ overflowWrap: 'anywhere' }} {...props} />,
    code: ({ children, className, ...props }: any) => {
      const isInline = !className || !className.includes('language-');
      return (
        <code
          className={isInline
            ? "bg-slate-100 dark:bg-[#2a2a2c] px-1.5 py-0.5 rounded text-[13px] font-mono text-primary-600 dark:text-primary-400 border border-slate-200 dark:border-white/5 break-all"
            : "bg-transparent p-0 border-none text-inherit font-mono shadow-none !bg-none"
          }
          style={{ overflowWrap: 'anywhere' }}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }: any) => (
      <pre className="bg-[#0d1117] text-[#e6edf3] p-4 rounded-xl overflow-x-auto my-4 text-[13px] sm:text-[14px] font-mono border border-slate-200 dark:border-white/10 shadow-lg leading-normal">
        {children}
      </pre>
    ),
    table: ({ children }: any) => (
      <div className="my-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <table className="w-full text-left border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-slate-800">{children}</thead>,
    th: ({ children }: any) => <th className="px-3 py-2.5 font-bold text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-800 last:border-r-0 text-[12px] uppercase tracking-wider whitespace-nowrap">{children}</th>,
    td: ({ children }: any) => <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 border-b border-r border-slate-200 dark:border-slate-800 last:border-r-0 group-last:border-b-0 text-[13px] whitespace-nowrap">{children}</td>,
    tr: ({ children }: any) => <tr className="group border-b border-slate-100 dark:border-slate-800 last:border-b-0 hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">{children}</tr>,
  };

  const renderAttachment = () => {
    if (!attachment) return null;

    const isImage = attachment.mimeType.startsWith('image/');
    const isPDF = attachment.mimeType === 'application/pdf';

    if (isImage) {
      return (
        <div className={`mb-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm ${isUser ? 'origin-right' : 'origin-left'}`}>
          <img src={attachment.data} alt="Attachment" className="max-w-[280px] sm:max-w-[400px] h-auto object-cover" />
        </div>
      );
    }

    if (isPDF) {
      return (
        <div className={`mb-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 flex-shrink-0">
            <i className="fa-solid fa-file-pdf text-xl"></i>
          </div>
          <div className={`flex flex-col min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
              {attachment.fileName || 'document.pdf'}
            </span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t.pdf}</span>
          </div>
        </div>
      );
    }

    return (
      <div className="mb-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
        <i className="fa-solid fa-file text-slate-400 flex-shrink-0"></i>
        <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{attachment.fileName || t.attachment}</span>
      </div>
    );
  };

  const renderContent = (content: string) => {
    // 1. Process for numeric ranges first (1~10 -> 1&#126;10)
    const processedContent = content.replace(/(\d)~(\d)/g, '$1&#126;$2');

    // 2. Split by Viz Blocks (Chart & Smiles)
    const parts: { type: 'text' | 'chart' | 'chemical' | 'bio' | 'chart_loading'; content?: string; data?: any }[] = [];
    const blockRegex = /```json:(chart|smiles|bio)\n([\s\S]*?)\n```/g;
    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(processedContent)) !== null) {
      const blockType = match[1]; // 'chart' or 'smiles'

      // Add text before the block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: processedContent.substring(lastIndex, match.index)
        });
      }

      // Add viz block
      try {
        const jsonData = JSON.parse(match[2]);
        if (blockType === 'chart') {
          parts.push({ type: 'chart', data: jsonData });
        } else if (blockType === 'smiles') {
          parts.push({ type: 'chemical', data: jsonData });
        } else if (blockType === 'bio') {
          parts.push({ type: 'bio', data: jsonData });
        }
      } catch (e) {
        // Fallback: render as code block if JSON invalid
        parts.push({
          type: 'text',
          content: match[0]
        });
      }

      lastIndex = blockRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < processedContent.length) {
      const remainingText = processedContent.substring(lastIndex);

      // Check for incomplete viz block or unclosed math block (streaming)
      const hasIncompleteViz = remainingText.includes('```json:chart') || remainingText.includes('```json:smiles') || remainingText.includes('```json:bio');
      const hasUnclosedMath = (remainingText.match(/\$\$/g) || []).length % 2 !== 0;

      if (hasIncompleteViz || hasUnclosedMath) {
        // Split text to show only complete parts
        let visibleText = remainingText;
        if (hasIncompleteViz) {
          visibleText = visibleText.split(/```json:(chart|smiles|bio)/)[0];
        } else if (hasUnclosedMath) {
          visibleText = visibleText.substring(0, visibleText.lastIndexOf('$$'));
        }

        if (visibleText.trim()) {
          parts.push({
            type: 'text',
            content: visibleText
          });
        }
        // Add loading placeholder
        parts.push({ type: 'chart_loading' } as any);
      } else {
        parts.push({
          type: 'text',
          content: remainingText
        });
      }
    }

    return (
      <>
        {parts.map((part, idx) => {
          if (part.type === 'chart') {
            return <ChartRenderer key={idx} chartData={part.data} />;
          }
          if (part.type === 'chemical') {
            return <ChemicalRenderer key={idx} smiles={part.data.smiles} name={part.data.name || part.data.text} />;
          }
          if (part.type === 'bio') {
            return <BioRenderer key={idx} bioData={part.data} />;
          }
          if (part.type === 'chart_loading') {
            return (
              <div key={idx} className="my-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 animate-pulse">
                <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-slate-400">
                  <i className="fa-solid fa-flask text-2xl animate-bounce"></i>
                  <span className="text-sm font-medium">분석 중...</span>
                </div>
              </div>
            );
          }
          return (
            <div key={idx} className="prose dark:prose-invert max-w-none prose-p:leading-relaxed break-all">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={MarkdownComponents as any}
              >
                {part.content || ''}
              </ReactMarkdown>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-8 group animate-in fade-in duration-500`}>
      <div className={`flex max-w-[95%] sm:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-3 sm:gap-4`}>

        {!isUser && (
          <div className="flex-shrink-0 mt-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-primary-500 to-violet-500 flex items-center justify-center shadow-lg shadow-primary-500/10">
              <i className="fa-solid fa-sparkles text-white text-[10px]"></i>
            </div>
          </div>
        )}

        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} min-w-0 flex-1 overflow-hidden`}>

          {renderAttachment()}

          <div className={`relative transition-all duration-300 w-full overflow-hidden ${isUser
            ? 'px-4 sm:px-5 py-3 rounded-[24px] bg-[#eff1f1] dark:bg-[#2f2f2f] text-slate-800 dark:text-slate-100 shadow-sm'
            : 'px-1 py-1 text-slate-800 dark:text-[#e3e3e3]'
            }`} style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
            <div className="font-normal leading-relaxed w-full">
              {message.content ? (
                renderContent(message.content)
              ) : (
                <div className="flex space-x-1.5 py-4">
                  <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s]"></div>
                  <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]"></div>
                  <div className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]"></div>
                </div>
              )}
            </div>

            {!isUser && message.content && (
              <div className="flex items-center gap-6 mt-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={handlePlayVoice} className={`text-slate-400 hover:text-primary-500 transition-colors flex items-center gap-2 text-[12px] font-medium ${isPlaying || isGenerating ? 'text-primary-500' : ''}`}>
                  <i className={`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : isPlaying ? 'fa-circle-stop' : 'fa-volume-high'}`}></i>
                </button>
                <button onClick={handleCopy} className={`text-slate-400 hover:text-primary-500 transition-colors flex items-center gap-2 text-[12px] font-medium ${isCopied ? 'text-green-500' : ''}`}>
                  <i className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'}`}></i>
                </button>
              </div>
            )}
          </div>

          {!isUser && message.groundingSources && message.groundingSources.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2 animate-in fade-in duration-700">
              {message.groundingSources.map((source, idx) => (
                <a
                  key={idx}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 rounded-full bg-slate-50 dark:bg-[#1e1e1f] border border-slate-200 dark:border-slate-800 hover:border-primary-500 transition-all group"
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${new URL(source.uri).hostname}&sz=32`}
                    alt="fav"
                    className="w-3.5 h-3.5 mr-2"
                  />
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate max-w-[150px]">{source.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
