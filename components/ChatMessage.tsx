
import React, { useState, useEffect, lazy, Suspense } from 'react';
import ReactMarkdown from 'https://esm.sh/react-markdown@9';
import remarkGfm from 'https://esm.sh/remark-gfm@4';
import remarkMath from 'https://esm.sh/remark-math@6';
import rehypeKatex from 'https://esm.sh/rehype-katex@7';
import { Prism as SyntaxHighlighter } from 'https://esm.sh/react-syntax-highlighter@15.5.0';
import { vscDarkPlus } from 'https://esm.sh/react-syntax-highlighter@15.5.0/dist/esm/styles/prism';
import { Role, Message, UserProfile } from '../types';
import { generateSpeech, playRawAudio, stopAudio, initAudioContext } from '../services/geminiService';

// Lazy load visualization components for better performance
const ChartRenderer = lazy(() => import('./ChartRenderer'));
const ChemicalRenderer = lazy(() => import('./ChemicalRenderer'));
const BioRenderer = lazy(() => import('./BioRenderer'));
const PhysicsRenderer = lazy(() => import('./PhysicsRenderer'));
const DiagramRenderer = lazy(() => import('./DiagramRenderer').then(module => ({ default: module.DiagramRenderer })));
const ConstellationRenderer = lazy(() => import('./ConstellationRenderer'));
const DrugRenderer = lazy(() => import('./DrugRenderer').then(module => ({ default: module.DrugRenderer })));

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
    ko: { pdf: 'PDF 문서', attachment: '첨부파일', analyzing: '분석 중...' },
    en: { pdf: 'PDF Document', attachment: 'Attachment', analyzing: 'Analyzing...' },
    es: { pdf: 'Documento PDF', attachment: 'Adjunto', analyzing: 'Analizando...' },
    fr: { pdf: 'Document PDF', attachment: 'Pièce jointe', analyzing: 'Analyse...' }
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
    h3: ({ ...props }) => <h3 className="text-base font-bold mb-2 mt-4 text-slate-800 dark:text-slate-200" {...props} />,
    p: ({ ...props }) => <p className="mb-4 last:mb-0 leading-relaxed text-[15px] sm:text-[16px] break-all" style={{ overflowWrap: 'anywhere' }} {...props} />,
    ul: ({ ...props }) => <ul className="list-disc ml-5 mb-4 space-y-2" {...props} />,
    ol: ({ ...props }) => <ol className="list-decimal ml-5 mb-4 space-y-2" {...props} />,
    li: ({ ...props }) => <li className="pl-1 text-slate-700 dark:text-slate-300 break-all" style={{ overflowWrap: 'anywhere' }} {...props} />,
    strong: ({ ...props }) => <strong className="font-bold text-slate-900 dark:text-white" {...props} />,
    em: ({ ...props }) => <em className="italic text-slate-700 dark:text-slate-300" {...props} />,
    a: ({ ...props }) => <a className="text-primary-600 dark:text-primary-400 hover:underline transition-all font-medium" target="_blank" rel="noopener noreferrer" {...props} />,
    kbd: ({ ...props }) => <kbd className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-1.5 py-0.5 rounded shadow-sm text-[11px] font-sans mx-0.5 font-bold" {...props} />,
    blockquote: ({ ...props }) => <blockquote className="border-l-4 border-slate-200 dark:border-white/10 pl-4 py-1 my-4 italic text-slate-500" {...props} />,
    hr: () => <hr className="my-8 border-t border-slate-200 dark:border-white/5" />,
    code: ({ children, className, ...props }: any) => {
      const isInline = !className || !className.includes('language-');
      return (
        <code
          className={isInline
            ? "bg-slate-100 dark:bg-[#2a2a2c] px-1.5 py-0.5 rounded-md text-[0.9em] font-mono font-medium text-primary-700 dark:text-primary-400 border border-slate-200 dark:border-white/5 mx-0.5"
            : "block text-inherit font-mono"
          }
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }: any) => {
      // children.props.className에서 언어 추출 (예: language-python)
      const language = children?.props?.className?.replace('language-', '') || 'code';
      const codeContent = Array.isArray(children?.props?.children)
        ? children.props.children.join('')
        : children?.props?.children || '';
      const [copied, setCopied] = useState(false);

      const copyToClipboard = async () => {
        try {
          await navigator.clipboard.writeText(codeContent);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error('Failed to copy code:', err);
        }
      };

      return (
        <div className="group relative my-8 rounded-2xl overflow-hidden border border-slate-200/50 dark:border-white/5 shadow-lg bg-[#0d1117]">
          {/* Code Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-[#161b22]/50 border-b border-white/5 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-code text-[10px] text-slate-500"></i>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{language}</span>
            </div>
            <button
              onClick={copyToClipboard}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors flex items-center gap-1.5 text-slate-400 hover:text-white"
            >
              <i className={`fa-solid ${copied ? 'fa-check text-emerald-500' : 'fa-copy'} text-[11px]`}></i>
              <span className="text-[10px] font-bold uppercase tracking-tight">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {/* Code Body */}
          <div className="text-[13px] sm:text-[14px] font-mono leading-relaxed selection:bg-blue-500/30">
            <SyntaxHighlighter
              language={language}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '1rem',
                backgroundColor: 'transparent',
                borderRadius: 0,
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                }
              }}
            >
              {String(codeContent).replace(/\n$/, '')}
            </SyntaxHighlighter>
          </div>
        </div>
      );
    },
    table: ({ children }: any) => (
      <div className="my-8 overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar rounded-2xl border border-slate-200/50 dark:border-white/5 shadow-sm">
        <table className="w-full text-left border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-slate-50/50 dark:bg-white/[0.02] border-b border-slate-200/50 dark:border-white/5">{children}</thead>,
    th: ({ children }: any) => <th className="px-5 py-4 font-black text-slate-700 dark:text-slate-200 border-r border-slate-100 dark:border-white/5 last:border-r-0 text-[11px] uppercase tracking-widest bg-slate-50/50 dark:bg-white/[0.02]">{children}</th>,
    td: ({ children }: any) => <td className="px-5 py-4 text-slate-600 dark:text-slate-300 border-b border-slate-50 dark:border-white/5 border-r border-slate-50 dark:border-white/5 last:border-r-0 group-last:border-b-0 text-[14px] min-w-[140px] leading-relaxed align-top tabular-nums">{children}</td>,
    tr: ({ children }: any) => <tr className="group border-b border-slate-50 dark:border-white/5 last:border-b-0 hover:bg-slate-50/30 dark:hover:bg-white/[0.01] transition-colors">{children}</tr>,
  };

  const renderSingleAttachment = (att: any, index?: number) => {
    if (!att) return null;

    const isImage = att.mimeType.startsWith('image/');
    const isPDF = att.mimeType === 'application/pdf';
    const isVideo = att.mimeType.startsWith('video/');

    if (isImage) {
      return (
        <div key={index} className={`mb-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm ${isUser ? 'origin-right' : 'origin-left'}`}>
          <img
            src={att.data}
            alt="Attachment"
            className="w-full h-auto object-cover max-w-full sm:max-w-[480px]"
            decoding="async"
          />
        </div>
      );
    }

    if (isVideo) {
      return (
        <div key={index} className={`mb-3 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm aspect-video sm:max-w-[480px] bg-black flex items-center justify-center relative`}>
          <video src={att.data} controls className="w-full h-full" />
        </div>
      );
    }

    if (isPDF) {
      return (
        <div key={index} className={`mb-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 flex-shrink-0">
            <i className="fa-solid fa-file-pdf text-xl"></i>
          </div>
          <div className={`flex flex-col min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
              {att.fileName || 'document.pdf'}
            </span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t.pdf}</span>
          </div>
        </div>
      );
    }

    return (
      <div key={index} className="mb-3 flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
        <i className={`fa-solid ${att.mimeType.includes('word') || att.fileName?.endsWith('.docx') ? 'fa-file-word text-blue-500' :
          att.mimeType.includes('sheet') || att.fileName?.endsWith('.xlsx') ? 'fa-file-excel text-green-700' :
            att.mimeType.includes('presentationml') || att.fileName?.endsWith('.pptx') ? 'fa-file-powerpoint text-orange-600' :
              att.mimeType.includes('csv') || att.fileName?.endsWith('.csv') ? 'fa-file-csv text-green-600' :
                att.fileName?.endsWith('.hwpx') ? 'fa-file-lines text-blue-400' :
                  'fa-file'
          } text-slate-400 flex-shrink-0`}></i>
        <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{att.fileName || t.attachment}</span>
      </div>
    );
  };

  const renderAttachments = () => {
    if (message.attachments && message.attachments.length > 0) {
      // Multiple attachments
      const images = message.attachments.filter(a => a.mimeType.startsWith('image/'));
      const others = message.attachments.filter(a => !a.mimeType.startsWith('image/'));

      return (
        <div className="flex flex-col w-full">
          {images.length > 0 && (
            <div className={`grid ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 mb-2`}>
              {images.map((img, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:opacity-95 transition-opacity">
                  <img src={img.data} alt="Attachment" className="w-full h-32 sm:h-48 object-cover" onClick={() => window.open(img.data, '_blank')} />
                </div>
              ))}
            </div>
          )}
          {others.map((att, i) => renderSingleAttachment(att, i))}
        </div>
      );
    }

    // Fallback to legacy single attachment
    const single = message.attachment || message.image;
    return renderSingleAttachment(single);
  };

  const renderContent = (content: string) => {
    // Split by Viz Blocks
    const parts: { type: 'text' | 'chart' | 'chemical' | 'bio' | 'physics' | 'constellation' | 'diagram' | 'drug' | 'chart_loading'; content?: string; data?: any }[] = [];
    const blockRegex = /```json\s*:\s*(chart|smiles|bio|physics|constellation|diagram|drug)\s*\n([\s\S]*?)\n```/gi;
    let lastIndex = 0;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      const blockType = match[1].toLowerCase();

      // Add text before the block
      if (match.index > lastIndex) {
        let textPart = content.substring(lastIndex, match.index);
        // Process for numeric ranges (1~10 -> 1&#126;10)
        textPart = textPart.replace(/(\d)~(\d)/g, '$1&#126;$2');
        parts.push({
          type: 'text',
          content: textPart
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
        } else if (blockType === 'physics') {
          parts.push({ type: 'physics', data: jsonData });
        } else if (blockType === 'constellation') {
          parts.push({ type: 'constellation', data: jsonData });
        } else if (blockType === 'diagram') {
          parts.push({ type: 'diagram', data: jsonData });
        } else if (blockType === 'drug') {
          parts.push({ type: 'drug', data: jsonData });
        }
      } catch (e) {
        parts.push({
          type: 'text',
          content: match[0]
        });
      }

      lastIndex = blockRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const remainingText = content.substring(lastIndex);

      // Check for incomplete viz block or unclosed math block (streaming)
      const hasIncompleteViz = /```json\s*:\s*(chart|smiles|bio|physics|constellation|diagram|drug)/i.test(remainingText);
      const hasUnclosedMath = (remainingText.match(/\$\$/g) || []).length % 2 !== 0;

      if (hasIncompleteViz || hasUnclosedMath) {
        // Split text to show only complete parts
        let visibleText = remainingText;
        if (hasIncompleteViz) {
          visibleText = visibleText.split(/```json\s*:\s*(chart|smiles|bio|physics|constellation|diagram|drug)/i)[0];
        } else if (hasUnclosedMath) {
          visibleText = visibleText.substring(0, visibleText.lastIndexOf('$$'));
        }

        if (visibleText.trim()) {
          // Process for numeric ranges (1~10 -> 1&#126;10)
          const processedVisible = visibleText.replace(/(\d)~(\d)/g, '$1&#126;$2');
          parts.push({
            type: 'text',
            content: processedVisible
          });
        }
        // Add loading placeholder
        parts.push({ type: 'chart_loading' } as any);
      } else {
        // Process for numeric ranges (1~10 -> 1&#126;10)
        const processedRemaining = remainingText.replace(/(\d)~(\d)/g, '$1&#126;$2');
        parts.push({
          type: 'text',
          content: processedRemaining
        });
      }
    }

    return (
      <>
        {parts.map((part, idx) => {
          // Loading fallback for lazy components
          const LoadingFallback = () => (
            <div className="w-full my-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 animate-pulse">
              <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-slate-400">
                <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                <span className="text-sm font-medium">Loading...</span>
              </div>
            </div>
          );

          if (part.type === 'chart') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <ChartRenderer chartData={part.data} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'chemical') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <ChemicalRenderer smiles={part.data.smiles} name={part.data.name || part.data.text} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'bio') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <BioRenderer bioData={part.data} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'physics') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <PhysicsRenderer physicsData={part.data} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'constellation') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <ConstellationRenderer data={part.data} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'diagram') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <DiagramRenderer data={part.data} />
              </Suspense>
            );
          }
          if (part.type === 'drug') {
            return (
              <Suspense key={idx} fallback={<LoadingFallback />}>
                <DrugRenderer data={part.data} language={language} />
              </Suspense>
            );
          }
          if (part.type === 'chart_loading') {
            return (
              <div key={idx} className="w-full my-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/5 animate-pulse">
                <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-slate-400">
                  <i className="fa-solid fa-flask text-2xl animate-bounce"></i>
                  <span className="text-sm font-medium">{t.analyzing}</span>
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

          {renderAttachments()}

          <div className={`relative transition-all duration-300 overflow-hidden ${isUser
            ? 'px-4 sm:px-5 py-3 rounded-[24px] bg-[#eff1f1] dark:bg-[#2f2f2f] text-slate-800 dark:text-slate-100 shadow-sm w-fit max-w-full ml-auto'
            : 'px-1 py-1 text-slate-800 dark:text-[#e3e3e3] w-full'
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
              <div className="flex items-center gap-4 mt-3 ml-1 select-none">
                <button
                  onClick={handlePlayVoice}
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 ${isPlaying || isGenerating ? 'text-primary-500 bg-primary-50 dark:bg-primary-900/10 ring-1 ring-primary-200 dark:ring-primary-800' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  title="Read Aloud"
                >
                  <i className={`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : isPlaying ? 'fa-stop' : 'fa-volume-high'} text-[13px]`}></i>
                </button>

                <button
                  onClick={handleCopy}
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 ${isCopied ? 'text-green-500 bg-green-50 dark:bg-green-900/10 ring-1 ring-green-200 dark:ring-green-800' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  title="Copy Text"
                >
                  <i className={`fa-solid ${isCopied ? 'fa-check' : 'fa-copy'} text-[13px]`}></i>
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
