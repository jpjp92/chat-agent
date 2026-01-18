
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { MessageAttachment, Language } from '../types';

interface ChatInputProps {
  onSend: (message: string, attachment?: MessageAttachment) => void;
  disabled?: boolean;
  language?: Language;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
}

const MAX_FILE_SIZE = 4 * 1024 * 1024;

const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled, language = 'ko', showToast }) => {
  const [input, setInput] = useState('');
  const [selectedAttachment, setSelectedAttachment] = useState<MessageAttachment | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSTTSupported, setIsSTTSupported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');

  const i18n = {
    ko: { placeholder: "무엇이든 물어보세요", sizeError: "파일 용량이 너무 큽니다. (최대 4MB)" },
    en: { placeholder: "Ask anything", sizeError: "File size is too large. (Max 4MB)" },
    es: { placeholder: "Pregunta lo que quieras", sizeError: "El archivo es demasiado grande. (Máx 4MB)" },
    fr: { placeholder: "Demandez n'importe quoi", sizeError: "Le fichier est trop volumineux. (Max 4Mo)" }
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

  useLayoutEffect(() => {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        showToast(t.sizeError, "error");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedAttachment({ data: reader.result as string, mimeType: file.type, fileName: file.name });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 relative">
      {selectedAttachment && (
        <div className="absolute bottom-full left-4 sm:left-6 mb-3 animate-in slide-in-from-bottom-2 duration-300">
          <div className="relative group">
            <div className="overflow-hidden rounded-2xl border-2 border-white dark:border-[#2f2f2f] shadow-2xl bg-white dark:bg-[#1e1e1f]">
              {selectedAttachment.mimeType === 'application/pdf' ? (
                <div className="h-16 w-32 flex flex-col items-center justify-center p-2 gap-1 bg-red-50 dark:bg-red-500/5">
                  <i className="fa-solid fa-file-pdf text-red-500 text-xl"></i>
                  <span className="text-[10px] text-slate-500 truncate w-full text-center px-1">{selectedAttachment.fileName}</span>
                </div>
              ) : (
                <img src={selectedAttachment.data} alt="Upload" className="h-16 w-16 sm:h-20 sm:w-20 object-cover" />
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
        className="relative grid grid-cols-[auto_1fr_auto] items-end bg-[#f0f4f9] dark:bg-[#1e1e1f] p-1 sm:p-1.5 rounded-[28px] sm:rounded-[32px] transition-all focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:bg-white dark:focus-within:bg-[#1e1e1f] border border-transparent dark:border-white/5 shadow-sm min-h-[44px] sm:min-h-[52px] overflow-hidden"
      >
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*,application/pdf" className="hidden" />

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
