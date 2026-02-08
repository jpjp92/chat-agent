import React, { useState, useRef, useEffect } from 'react';
import { ChatSession, Language } from '../types';

interface ChatSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  language: Language;
  isOpen?: boolean;
  onClose?: () => void;
  onLanguageChange: (lang: Language) => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  showConfirmDialog: (title: string, message: string, onConfirm: () => void, type?: 'danger' | 'info') => void;
  isCollapsed?: boolean;
  toggleCollapse?: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  currentSessionId,
  language,
  isOpen,
  isCollapsed,
  onClose,
  toggleCollapse,
  onLanguageChange,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  showConfirmDialog
}) => {
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const languages: { code: Language; name: string; label: string }[] = [
    { code: 'ko', name: '한국어', label: 'Korean' },
    { code: 'en', name: 'English', label: 'US' },
    { code: 'es', name: 'Español', label: 'Spanish' },
    { code: 'fr', name: 'Français', label: 'French' },
  ];

  const i18n = {
    ko: {
      newChat: "새 채팅",
      history: "최근 기록",
      deleteTitle: "채팅방 삭제",
      deleteMsg: "이 채팅방을 정말 삭제하시겠습니까? 삭제된 기록은 복구할 수 없습니다.",
      doubleClick: "더블 클릭하여 수정",
      languageLabel: "언어 설정"
    },
    en: {
      newChat: "New Chat",
      history: "Recent",
      deleteTitle: "Delete Chat",
      deleteMsg: "Are you sure you want to delete this chat? This cannot be undone.",
      doubleClick: "Double-click to edit",
      languageLabel: "Language"
    },
    es: {
      newChat: "Nuevo Chat",
      history: "Reciente",
      deleteTitle: "Eliminar Chat",
      deleteMsg: "¿Estás seguro de que quieres eliminar este chat? No se puede deshacer.",
      doubleClick: "Doble clic para editar",
      languageLabel: "Idioma"
    },
    fr: {
      newChat: "Nouveau Chat",
      history: "Récent",
      deleteTitle: "Supprimer le Chat",
      deleteMsg: "Êtes-vous sûr de vouloir supprimer ce chat ? Cette action est irréversible.",
      doubleClick: "Double-cliquez pour modifier",
      languageLabel: "Langue"
    }
  };

  const t = i18n[language] || i18n.ko;

  const currentLang = languages.find(l => l.code === language) || languages[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-40 md:hidden animate-in fade-in duration-300"
          onClick={onClose}
        ></div>
      )}

      <aside className={`fixed md:relative flex flex-col bg-slate-50 dark:bg-[#131314] border-none h-full transition-all duration-300 ease-in-out z-50 ${isOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'
        } ${
        // Desktop collapse logic
        isCollapsed ? 'md:w-[68px]' : 'md:w-[300px]'
        }`}>

        {/* Header Section */}
        <div className={`flex ${isCollapsed ? 'flex-col items-center py-3 space-y-6' : 'flex-col px-4 py-3'}`}>

          {/* Top Bar (Hamburger & Mobile Close) */}
          <div className={`flex items-center ${isCollapsed ? 'justify-center w-full' : 'justify-between mb-4 pl-2'}`}>
            {/* Desktop Collapse Button */}
            <button
              onClick={toggleCollapse}
              className={`hidden md:flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors ${isCollapsed ? 'w-10 h-10' : 'w-10 h-10 -ml-2'
                }`}
            >
              <i className="fa-solid fa-bars text-lg"></i>
            </button>

            {/* Mobile Close Button */}
            <button
              onClick={onClose}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500"
            >
              <i className="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          {/* New Chat Button */}
          <button
            onClick={onNewSession}
            title={t.newChat}
            className={`group flex items-center transition-all duration-300 shadow-sm hover:shadow-md active:scale-95 ${isCollapsed
              ? 'justify-center w-10 h-10 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              : 'w-full justify-start space-x-3 bg-slate-100/80 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold py-3 px-4 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
          >
            <i className="fa-regular fa-pen-to-square text-sm"></i>
            {!isCollapsed && <span className="text-sm">{t.newChat}</span>}
          </button>
        </div>

        {/* Content Section (Hidden when collapsed) */}
        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto px-3 space-y-1 pb-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-3 mb-2 mt-2">
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">{t.history}</h3>
            </div>

            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => editingId !== session.id && onSelectSession(session.id)}
                className={`group relative flex items-center px-3 py-2.5 rounded-full cursor-pointer transition-all duration-200 overflow-hidden ${currentSessionId === session.id
                  ? 'bg-primary-100 dark:bg-[#1e1e1f] text-slate-900 dark:text-slate-100 font-medium'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400'
                  }`}
              >
                {/* Icon based on session state? For now just a chat bubble */}
                <i className={`fa-regular fa-message text-xs mr-3 ${currentSessionId === session.id ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`}></i>

                {editingId === session.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onRenameSession(session.id, editingTitle.trim() || session.title);
                        setEditingId(null);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => {
                      onRenameSession(session.id, editingTitle.trim() || session.title);
                      setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-sm bg-transparent border-b border-primary-500 outline-none"
                    autoFocus
                  />
                ) : (
                  <span
                    className="truncate flex-1 text-sm"
                    title={session.title}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(session.id);
                      setEditingTitle(session.title);
                    }}
                  >
                    {session.title}
                  </span>
                )}

                {/* Hover Menu */}
                <div className={`absolute right-2 flex items-center space-x-1 ${currentSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity bg-gradient-to-l from-primary-100 dark:from-[#1e1e1f] via-primary-100 dark:via-[#1e1e1f] to-transparent pl-4`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(session.id);
                      setEditingTitle(session.title);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                    title={t.doubleClick}
                  >
                    <i className="fa-solid fa-pen text-[10px]"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showConfirmDialog(t.deleteTitle, t.deleteMsg, () => onDeleteSession(session.id), 'danger');
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Custom Language Selector (Hidden when collapsed) */}
        {!isCollapsed && (
          <div className="p-3 mt-auto">
            <div className="relative" ref={dropdownRef}>
              {/* Language Menu Popover */}
              {isLangMenuOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-white dark:bg-[#1e1e1f] border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 z-[60]">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onLanguageChange(lang.code);
                        setIsLangMenuOpen(false);
                      }}
                      className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors ${language === lang.code
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300 font-medium'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                        }`}
                    >
                      <span className="flex-1 text-left">{lang.name}</span>
                      {language === lang.code && <i className="fa-solid fa-check text-xs"></i>}
                    </button>
                  ))}
                </div>
              )}

              {/* Trigger Button */}
              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="w-full flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors"
              >
                <div className="flex items-center">
                  <i className="fa-solid fa-globe mr-2"></i>
                  <span>{currentLang.label}</span>
                </div>
                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">{currentLang.code.toUpperCase()}</span>
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default ChatSidebar;