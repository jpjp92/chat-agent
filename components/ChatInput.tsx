import React, { useState, useRef, useEffect, useCallback } from 'react';
import mammoth from "mammoth";
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { MessageAttachment, Language } from '../types';

interface ChatInputProps {
  onSend: (message: string, attachment?: MessageAttachment) => void;
  disabled?: boolean;
  language?: Language;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
}

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled, language = 'ko', showToast }) => {
  const [input, setInput] = useState('');
  const [selectedAttachment, setSelectedAttachment] = useState<MessageAttachment | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSTTSupported, setIsSTTSupported] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');

  const i18n = {
    fr: { placeholder: "Demandez n'importe quoi", sizeError: "Le fichier est trop volumineux. (Max 4Mo, Vidéo 20Mo)", typeError: "Format de fichier non supporté.", dropTitle: "Déposer le fichier ici", dropSubtitle: "Ajouter au chat" },
    ko: { placeholder: "무엇이든 물어보세요", sizeError: "파일 용량이 너무 큽니다. (일반 4MB, 영상 20MB)", typeError: "지원하지 않는 파일 형식입니다.", dropTitle: "파일을 여기에 놓으세요", dropSubtitle: "채팅에 추가하기" },
    en: { placeholder: "Ask anything", sizeError: "File size is too large. (Max 4MB, Video 20MB)", typeError: "File format not supported.", dropTitle: "Drop file here", dropSubtitle: "Add to chat" },
    es: { placeholder: "Pregunta lo que quieras", sizeError: "El archivo es demasiado grande. (Máx 4MB, Video 20MB)", typeError: "Formato de archivo no soportado.", dropTitle: "Suelta el archivo aquí", dropSubtitle: "Añadir al chat" }
  };

  const t = i18n[language] || i18n.ko;

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const minHeight = window.innerWidth < 640 ? 36 : 40;
      const maxHeight = window.innerWidth < 640 ? 140 : 180;
      const targetHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${targetHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSTTSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      const langMap: Record<Language, string> = { ko: 'ko-KR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' };
      recognition.lang = langMap[language] || 'ko-KR';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let currentFinalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) currentFinalTranscript += transcript;
          else interimTranscript += transcript;
        }
        if (currentFinalTranscript) finalTranscriptRef.current += currentFinalTranscript;
        setInput(finalTranscriptRef.current + interimTranscript);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, [language]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) recognitionRef.current.stop();
    else {
      finalTranscriptRef.current = input;
      recognitionRef.current.start();
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((input.trim() || selectedAttachment) && !disabled) {
      if (isListening) recognitionRef.current.stop();
      onSend(input, selectedAttachment || undefined);
      setInput('');
      setSelectedAttachment(null);
      finalTranscriptRef.current = '';
      if (textareaRef.current) textareaRef.current.style.height = window.innerWidth < 640 ? '36px' : '40px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const processFile = useCallback(async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const limit = isVideo ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;

    if (file.size > limit) {
      showToast(t.sizeError, "error");
      return;
    }

    let extractedText = "";

    try {
      if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;
      } else if (file.name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        // 첫 번째 시트 데이터만 추출
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const markdownTable = jsonData.map((row, i) => {
          const line = `| ${row.map(cell => String(cell || "").replace(/\|/g, "\\|")).join(' | ')} |`;
          if (i === 0) {
            const separator = `| ${row.map(() => '---').join(' | ')} |`;
            return `${line}\n${separator}`;
          }
          return line;
        }).join('\n');

        extractedText = `[XLSX DATA CONVERTED TO MARKDOWN TABLE (Sheet: ${firstSheetName})]\n${markdownTable}`;
      } else if (file.type === "text/plain" || file.type === "text/markdown" || file.type === "text/csv" ||
        file.name.endsWith(".txt") || file.name.endsWith(".md") || file.name.endsWith(".csv")) {

        const arrayBuffer = await file.arrayBuffer();

        // 1. 인코딩 시도 (UTF-8 -> EUC-KR)
        try {
          const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
          extractedText = utf8Decoder.decode(arrayBuffer);
        } catch (e) {
          // UTF-8 실패 시 한국어 인코딩(EUC-KR)으로 재시도
          const eucKrDecoder = new TextDecoder('euc-kr');
          extractedText = eucKrDecoder.decode(arrayBuffer);
        }

        // 2. CSV 파일의 경우 마크다운 테이블로 변환 (AI 인식률 향상)
        if (file.name.endsWith(".csv")) {
          const lines = extractedText.split(/\r?\n/).filter(line => line.trim() !== "");
          if (lines.length > 0) {
            const tableData = lines.map(line => {
              // 단순 콤마 분리보다 안전한 정규식 (따옴표 내 콤마 무시 등은 고려하지 않은 기본형)
              return line.split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));
            });

            const markdownTable = tableData.map((row, i) => {
              const line = `| ${row.join(' | ')} |`;
              if (i === 0) {
                const separator = `| ${row.map(() => '---').join(' | ')} |`;
                return `${line}\n${separator}`;
              }
              return line;
            }).join('\n');

            extractedText = `[CSV DATA CONVERTED TO MARKDOWN TABLE]\n${markdownTable}`;
          }
        }
      } else if (file.name.endsWith(".hwpx")) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const sectionFiles = Object.keys(zip.files)
          .filter(name => name.match(/Contents\/section\d+\.xml/i))
          .sort();

        let fullText = "";
        for (const sectionPath of sectionFiles) {
          const xmlContent = await zip.file(sectionPath)!.async("string");
          // <hp:t>태그 안의 텍스트만 추출
          const textMatches = xmlContent.match(/<hp:t[^>]*>(.*?)<\/hp:t>/g);
          if (textMatches) {
            const sectionText = textMatches
              .map(m => m.replace(/<[^>]+>/g, ''))
              .map(t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
              .join(' ');
            fullText += sectionText + "\n";
          }
        }
        extractedText = fullText.trim();
      } else if (file.name.endsWith(".pptx") || file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const slideFiles = Object.keys(zip.files)
          .filter(name => name.match(/ppt\/slides\/slide\d+\.xml$/i))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)\.xml$/i)?.[1] || '0');
            const numB = parseInt(b.match(/slide(\d+)\.xml$/i)?.[1] || '0');
            return numA - numB;
          });

        let fullText = "";
        for (let i = 0; i < slideFiles.length; i++) {
          const slidePath = slideFiles[i];
          const xmlContent = await zip.file(slidePath)!.async("string");
          // <a:t> 태그 안의 텍스트만 추출 (PowerPoint 텍스트 태그)
          const textMatches = xmlContent.match(/<a:t[^>]*>(.*?)<\/a:t>/g);
          if (textMatches) {
            const slideText = textMatches
              .map(m => m.replace(/<[^>]+>/g, ''))
              .map(t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
              .join(' ');
            fullText += `[Slide ${i + 1}]\n${slideText}\n\n`;
          }
        }

        // 텍스트가 거의 없는 경우 안내 메시지 제공
        if (fullText.trim().length < 10) {
          extractedText = `[PPTX 파일: 총 ${slideFiles.length}개 슬라이드]\n⚠️ 텍스트를 찾을 수 없습니다. 이미지 위주의 슬라이드인 경우 개별 이미지를 캡처하여 업로드해주세요.`;
        } else {
          extractedText = fullText.trim();
        }
      }
    } catch (err) {
      console.error("Text extraction failed:", err);
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedAttachment({
        data: reader.result as string,
        mimeType: file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream'),
        fileName: file.name,
        extractedText: extractedText || undefined
      });
    };
    reader.readAsDataURL(file);
  }, [t.sizeError, showToast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset file input
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('pdf') !== -1 ||
        items[i].type.indexOf('video') !== -1 ||
        items[i].type.indexOf('word') !== -1 || items[i].type.indexOf('text') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          return;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const allowedMimeTypes = [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ];
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || allowedMimeTypes.includes(file.type) ||
        file.name.endsWith('.docx') || file.name.endsWith('.xlsx') || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv') || file.name.endsWith('.hwpx') || file.name.endsWith('.pptx') || file.name.endsWith('.mp4') || file.name.endsWith('.mov')) {
        processFile(file);
      } else {
        showToast(t.typeError, "error");
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 relative">
      {selectedAttachment && (
        <div className="absolute bottom-full left-4 sm:left-6 mb-3 animate-in slide-in-from-bottom-2 duration-300">
          <div className="relative group">
            <div className="overflow-hidden rounded-2xl border-2 border-white dark:border-[#2f2f2f] shadow-2xl bg-white dark:bg-[#1e1e1f]">
              {selectedAttachment.mimeType.startsWith('image/') ? (
                <img src={selectedAttachment.data} alt="Upload" className="h-16 w-16 sm:h-20 sm:w-20 object-cover" />
              ) : selectedAttachment.mimeType.startsWith('video/') ? (
                <div className="h-16 w-16 sm:h-20 sm:w-20 flex flex-col items-center justify-center bg-slate-900 border-none relative overflow-hidden">
                  <video src={selectedAttachment.data} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                  <i className="fa-solid fa-circle-play text-white text-2xl z-10 drop-shadow-md"></i>
                  <span className="absolute bottom-1 right-1 text-[8px] text-white bg-black/50 px-1 rounded z-10 font-bold uppercase overflow-hidden max-w-[90%] truncate">{(selectedAttachment.fileName || 'video').split('.').pop()}</span>
                </div>
              ) : (
                <div className="h-16 w-32 flex flex-col items-center justify-center p-2 gap-1 bg-slate-50 dark:bg-slate-500/5">
                  <i className={`fa-solid ${selectedAttachment.mimeType === 'application/pdf' ? 'fa-file-pdf text-red-500' :
                    selectedAttachment.mimeType.includes('word') || selectedAttachment.fileName?.endsWith('.docx') ? 'fa-file-word text-blue-500' :
                      selectedAttachment.mimeType.includes('sheet') || selectedAttachment.fileName?.endsWith('.xlsx') ? 'fa-file-excel text-green-700' :
                        selectedAttachment.mimeType.includes('presentationml') || selectedAttachment.fileName?.endsWith('.pptx') ? 'fa-file-powerpoint text-orange-600' :
                          selectedAttachment.mimeType.includes('csv') || selectedAttachment.fileName?.endsWith('.csv') ? 'fa-file-csv text-green-600' :
                            selectedAttachment.fileName?.endsWith('.hwpx') ? 'fa-file-lines text-blue-400' :
                              'fa-file-lines text-slate-500'
                    } text-xl`}></i>
                  <span className="text-[10px] text-slate-500 truncate w-full text-center px-1 font-medium">{selectedAttachment.fileName}</span>
                </div>
              )}
            </div>
            <button onClick={() => setSelectedAttachment(null)} className="absolute -top-2.5 -right-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 w-6 h-6 rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all z-10">
              <i className="fa-solid fa-xmark text-[10px]"></i>
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
        className={`relative grid grid-cols-[auto_1fr_auto] items-end bg-[#f0f4f9] dark:bg-[#1e1e1f] p-1 sm:p-1.5 rounded-[28px] sm:rounded-[32px] transition-all focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:bg-white dark:focus-within:bg-[#1e1e1f] border border-transparent dark:border-white/5 shadow-sm min-h-[44px] sm:min-h-[52px] overflow-hidden ${isDragging ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20' : ''}`}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-[28px] sm:rounded-[32px] animate-in fade-in duration-200 pointer-events-none">
            <p className="text-sm font-bold text-primary-600 dark:text-primary-400">{t.dropTitle}</p>
          </div>
        )}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*,video/*,application/pdf,.docx,.xlsx,.txt,.md,.csv,.hwpx,.pptx"
          className="hidden"
        />

        <div className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 mb-0.5 ml-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/5 rounded-full transition-colors"
          >
            <i className="fa-solid fa-paperclip text-lg"></i>
          </button>
        </div>

        <div className="min-w-0 w-full flex items-center py-1 overflow-hidden">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t.placeholder}
            rows={1}
            disabled={disabled}
            style={{
              overflowWrap: 'anywhere',
              wordBreak: 'break-all'
            }}
            className="w-full bg-transparent px-2 sm:px-3 py-1.5 sm:py-2 outline-none resize-none text-slate-800 dark:text-[#e3e3e3] placeholder-slate-500 dark:placeholder-slate-400 min-h-[36px] max-h-[140px] sm:max-h-[180px] leading-relaxed block overflow-y-auto scrollbar-hide font-medium whitespace-pre-wrap"
          />
        </div>

        <div className="flex items-center space-x-0.5 pr-1 mb-1">
          {isSTTSupported && (
            <button
              type="button"
              onClick={toggleListening}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white shadow-lg animate-pulse' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-white/5'
                }`}
            >
              <i className={`fa-solid ${isListening ? 'fa-microphone' : 'fa-microphone-lines'} text-sm`}></i>
            </button>
          )}

          <button
            type="submit"
            disabled={(!input.trim() && !selectedAttachment) || disabled}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${(!input.trim() && !selectedAttachment) || disabled ? 'text-slate-300 dark:text-slate-700' : 'text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10'
              }`}
          >
            <i className="fa-solid fa-arrow-up text-base"></i>
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatInput;
