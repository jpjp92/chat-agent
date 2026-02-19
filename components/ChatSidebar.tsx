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
  const [searchQuery, setSearchQuery] = useState('');
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
      languageLabel: "언어 설정",
      searchPlaceholder: "채팅 검색"
    },
    en: {
      newChat: "New Chat",
      history: "Recent",
      deleteTitle: "Delete Chat",
      deleteMsg: "Are you sure you want to delete this chat? This cannot be undone.",
      doubleClick: "Double-click to edit",
      languageLabel: "Language",
      searchPlaceholder: "Search chats"
    },
    es: {
      newChat: "Nuevo Chat",
      history: "Reciente",
      deleteTitle: "Eliminar Chat",
      deleteMsg: "¿Estás seguro de que quieres eliminar este chat? No se puede deshacer.",
      doubleClick: "Doble clic para editar",
      languageLabel: "Idioma",
      searchPlaceholder: "Buscar chats"
    },
    fr: {
      newChat: "Nouveau Chat",
      history: "Récent",
      deleteTitle: "Supprimer le Chat",
      deleteMsg: "Êtes-vous sûr de vouloir supprimer ce chat ? Cette action est irréversible.",
      doubleClick: "Double-cliquez pour modifier",
      languageLabel: "Langue",
      searchPlaceholder: "Rechercher"
    }
  };

  const t = i18n[language] || i18n.ko;
  const currentLang = languages.find(l => l.code === language) || languages[0];

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[60] md:hidden animate-in fade-in duration-300"
          onClick={onClose}
        ></div>
      )}

      {/* Sidebar Aside */}
      <aside className={`fixed md:relative inset-y-0 left-0 bg-white dark:bg-[#0a0a0a] border-r border-slate-200 dark:border-white/5 h-full transition-all duration-300 ease-in-out z-[70] flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} 
        ${isCollapsed ? 'md:w-[68px]' : 'w-[280px] sm:w-[300px]'}`}>

        {/* Header Action Part */}
        <div className={`flex items-center pt-4 pb-2 shrink-0 ${isCollapsed ? 'md:flex-col md:space-y-4 justify-center px-4' : 'justify-between pl-4 pr-4'}`}>
          <div className="flex items-center">
            {/* Toggle Button for Desktop */}
            <button
              onClick={toggleCollapse}
              className={`hidden md:flex items-center justify-center rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 transition-all ${isCollapsed ? 'w-10 h-10' : 'w-9 h-9'}`}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              <i className="fa-solid fa-bars text-[17px]"></i>
            </button>
          </div>
        </div>

        {/* Dynamic Content Container */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Action Part: New Chat & Search (Shown when expanded OR on mobile open) */}
          {(!isCollapsed || isOpen) && (
            <div className="px-3 pb-2 space-y-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <button
                onClick={() => {
                  onNewSession();
                  if (isOpen) onClose?.();
                }}
                className="w-full h-11 flex items-center px-4 rounded-xl text-slate-600 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/5 transition-all active:scale-[0.98] group"
              >
                <div className="w-5 h-5 flex items-center justify-center mr-3">
                  <i className="fa-regular fa-pen-to-square text-[16px]"></i>
                </div>
                <span className="text-[15px] font-medium tracking-tight text-left">{t.newChat}</span>
              </button>

              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center pointer-events-none">
                  <i className="fa-solid fa-magnifying-glass text-[14px] text-slate-400 group-focus-within:text-primary-500 transition-colors"></i>
                </div>
                <input
                  type="text"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 bg-transparent border-none rounded-xl py-0 pl-12 pr-4 text-[15px] font-medium text-slate-800 dark:text-slate-100 focus:ring-0 hover:bg-slate-200/60 dark:hover:bg-white/5 outline-none transition-all placeholder:text-slate-500 dark:placeholder:text-slate-400"
                />
              </div>
            </div>
          )}

          {/* Action Part: Collapsed Icons (Only for Desktop) */}
          {isCollapsed && !isOpen && (
            <div className="hidden md:flex flex-col items-center pb-4 space-y-4 animate-in fade-in duration-200">
              <button
                onClick={onNewSession}
                title={t.newChat}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/5 transition-all"
              >
                <i className="fa-regular fa-pen-to-square text-[17px]"></i>
              </button>
            </div>
          )}

          {/* Scrollable List Part: Hidden when collapsed */}
          {(!isCollapsed || isOpen) && (
            <div className="flex-1 overflow-y-auto px-4 space-y-1.5 pb-6 mt-4 custom-scrollbar">
              <div className="flex items-center justify-between px-2 mb-2">
                <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest tabular-nums">{t.history}</h3>
              </div>

              {filteredSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => {
                    if (editingId !== session.id) {
                      onSelectSession(session.id);
                      if (isOpen) onClose?.();
                    }
                  }}
                  className={`group relative flex items-center px-4 py-2.5 rounded-full cursor-pointer transition-all duration-200 overflow-hidden 
                    ${currentSessionId === session.id
                      ? 'bg-blue-50/80 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300 font-bold'
                      : 'hover:bg-slate-200/60 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400'
                    }`}
                >
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
                      className="truncate flex-1 text-sm tracking-tight"
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

                  <div className={`absolute right-2 flex items-center space-x-0.5 ${currentSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity bg-gradient-to-l from-white dark:from-[#0a0a0a] via-white dark:via-[#0a0a0a] to-transparent pl-4`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(session.id);
                        setEditingTitle(session.title);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                    >
                      <i className="fa-solid fa-pen text-[9px]"></i>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        showConfirmDialog(t.deleteTitle, t.deleteMsg, () => onDeleteSession(session.id), 'danger');
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <i className="fa-solid fa-trash-can text-[9px]"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Static Bottom Language Selector */}
        <div className={`p-3 ${(isCollapsed && !isOpen) ? 'md:flex md:justify-center' : ''}`}>
          {(!isCollapsed || isOpen) ? (
            <div className="relative" ref={dropdownRef}>
              {isLangMenuOpen && (
                <div className="absolute bottom-full left-0 w-full mb-2 bg-white dark:bg-[#1e1e1f] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 z-[60]">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onLanguageChange(lang.code);
                        setIsLangMenuOpen(false);
                      }}
                      className={`w-full flex items-center px-4 py-3 text-sm transition-colors ${language === lang.code
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300 font-bold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                        }`}
                    >
                      <span className="flex-1 text-left">{lang.name}</span>
                      {language === lang.code && <i className="fa-solid fa-check text-xs"></i>}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="w-full flex items-center justify-between hover:bg-slate-200/80 dark:hover:bg-white/5 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-400 transition-colors"
              >
                <div className="flex items-center">
                  <i className="fa-solid fa-globe-asia mr-2.5 text-primary-500"></i>
                  <span>{currentLang.name}</span>
                </div>
                <i className={`fa-solid fa-chevron-up text-[10px] transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`}></i>
              </button>
            </div>
          ) : (
            <button
              onClick={toggleCollapse}
              className="hidden md:flex w-10 h-10 items-center justify-center rounded-xl text-primary-500 hover:bg-slate-200/50 dark:hover:bg-white/5 transition-all active:scale-95"
              title="Change Language"
            >
              <i className="fa-solid fa-globe-asia text-[17px]"></i>
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export default ChatSidebar;