import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Language } from '../types';

interface HeaderProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onMenuClick?: () => void;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
  onReset?: () => void;
  language: Language;
  selectedModel: 'gemini-2.5-flash' | 'gemini-2.5-flash-lite';
  onModelChange: (model: 'gemini-2.5-flash' | 'gemini-2.5-flash-lite') => void;
}

const Header: React.FC<HeaderProps> = ({ userProfile, onUpdateProfile, onMenuClick, showToast, onReset, language, selectedModel, onModelChange }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const i18n = {
    ko: {
      displayName: "표시 이름",
      save: "저장",
      cancel: "취소",
      reset: "초기화",
      changePhoto: "이미지 변경",
      photoDesc: "정사각형 이미지, 최대 2MB",
      placeholder: "이름을 입력하세요",
      model25Flash: "Gemini 2.5 Flash",
      model25FlashLite: "Gemini 2.5 Flash Lite",
      model25FlashDesc: "빠르고 균형 잡힌 응답",
      model25LiteDesc: "가볍고 빠른 한국어 최적화",
    },
    en: {
      displayName: "Display Name",
      save: "Save Changes",
      cancel: "Cancel",
      reset: "Reset",
      changePhoto: "Change Photo",
      photoDesc: "Square image, max 2MB",
      placeholder: "Enter your name",
      model25Flash: "Gemini 2.5 Flash",
      model25FlashLite: "Gemini 2.5 Flash Lite",
      model25FlashDesc: "Fast and balanced responses",
      model25LiteDesc: "Light and efficient for daily tasks",
    },
    es: {
      displayName: "Nombre",
      save: "Guardar",
      cancel: "Cancelar",
      reset: "Reiniciar",
      changePhoto: "Cambiar foto",
      photoDesc: "Imagen cuadrada, máx 2MB",
      placeholder: "Introduce tu nombre",
      model25Flash: "Gemini 2.5 Flash",
      model25FlashLite: "Gemini 2.5 Flash Lite",
      model25FlashDesc: "Respuestas rápidas y equilibradas",
      model25LiteDesc: "Ligero y eficiente para tareas diarias",
    },
    fr: {
      displayName: "Nom",
      save: "Enregistrer",
      cancel: "Annuler",
      reset: "Réinitialiser",
      changePhoto: "Changer la photo",
      photoDesc: "Image carrée, max 2Mo",
      placeholder: "Entrez votre nom",
      model25Flash: "Gemini 2.5 Flash",
      model25FlashLite: "Gemini 2.5 Flash Lite",
      model25FlashDesc: "Réponses rapides et équilibrées",
      model25LiteDesc: "Léger et efficace au quotidien",
    }
  };

  const t = i18n[language] || i18n.ko;

  useEffect(() => {
    if (document.documentElement.classList.contains('dark')) {
      setIsDarkMode(true);
    }
  }, []);

  useEffect(() => {
    setTempProfile(userProfile);
  }, [userProfile]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleDarkMode = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    setIsDarkMode(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  };

  const handleSave = () => {
    onUpdateProfile(tempProfile);
    // showToast(t.updated, "success");
    setIsModalOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast(t.sizeError, "error");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempProfile({ ...tempProfile, avatarUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <header className="mx-3 mt-3 mb-1 sticky top-3 z-40">
      <div className="bg-white/70 dark:bg-slate-800/60 backdrop-blur-xl rounded-full border border-white/60 dark:border-slate-700/40 shadow-[0_8px_40px_-12px_rgba(99,102,241,0.12)] dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.6)] flex items-center justify-between px-4 sm:px-5 md:pl-1 py-1.5">
        <div className="flex items-center space-x-2 sm:space-x-4">
          <button
            onClick={onMenuClick}
            className="md:hidden flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-pointer transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95"
          >
            <i className="fa-solid fa-bars text-base"></i>
          </button>

          <div ref={modelMenuRef} className="flex items-center relative z-50">
            <button
              onClick={() => setIsModelMenuOpen(prev => !prev)}
              className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/10 px-2 sm:px-3 py-2 rounded-xl transition duration-200"
            >
              <span className="text-base sm:text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400">
                {selectedModel === 'gemini-2.5-flash' ? t.model25Flash : t.model25FlashLite}
              </span>
              <i className={`fa-solid fa-chevron-down text-xs sm:text-sm text-indigo-400/70 dark:text-indigo-400/60 transition-transform duration-200 ${isModelMenuOpen ? 'rotate-180' : ''}`}></i>
            </button>

            {/* Click Dropdown Menu */}
            {isModelMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-56 sm:w-64 bg-white dark:bg-[#2f2f2f] rounded-xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                <div className="flex flex-col py-1">
                  <div onClick={() => { onModelChange('gemini-2.5-flash'); setIsModelMenuOpen(false); }} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer flex justify-between items-center transition-colors">
                    <div>
                      <div className="font-semibold text-sm sm:text-base text-slate-800 dark:text-white/90">Gemini 2.5 Flash</div>
                      <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-white/40 mt-0.5 tracking-wide">{t.model25FlashDesc}</div>
                    </div>
                    {selectedModel === 'gemini-2.5-flash' && <i className="fa-solid fa-check text-primary-500 dark:text-white"></i>}
                  </div>
                  <div onClick={() => { onModelChange('gemini-2.5-flash-lite'); setIsModelMenuOpen(false); }} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer flex justify-between items-center transition-colors">
                    <div>
                      <div className="font-semibold text-sm sm:text-base text-slate-800 dark:text-white/90">Gemini 2.5 Flash-Lite</div>
                      <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-white/40 mt-0.5 tracking-wide">{t.model25LiteDesc}</div>
                    </div>
                    {selectedModel === 'gemini-2.5-flash-lite' && <i className="fa-solid fa-check text-primary-500 dark:text-white"></i>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-3 cursor-pointer pl-3 pr-1 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 transition-all border border-transparent hover:border-slate-200 dark:hover:border-white/5 active:scale-95"
          >
            <div className="hidden lg:flex items-center gap-2 mr-1">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{userProfile.name}</span>
              <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
            </div>
            <img
              src={userProfile.avatarUrl}
              alt="Profile"
              className="w-8 h-8 rounded-full shadow-sm object-cover ring-2 ring-white dark:ring-slate-800"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userProfile.name);
              }}
            />
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center pb-[22dvh] px-4">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setIsModalOpen(false)}
          ></div>

          <div className="relative w-full max-w-xs animate-in slide-in-from-bottom-12 duration-500 ease-out">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-4 space-y-4">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

                <div className="flex flex-col items-center space-y-4">
                  <div onClick={triggerFileInput} className="relative group cursor-pointer">
                    <img src={tempProfile.avatarUrl} alt="Preview" className="w-20 h-20 rounded-full border-4 border-primary-500/20 shadow-lg object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <i className="fa-solid fa-camera text-white text-xl"></i>
                    </div>
                  </div>
                  <div className="text-center">
                    <button onClick={triggerFileInput} className="text-primary-600 dark:text-primary-400 text-sm font-semibold hover:underline">{t.changePhoto}</button>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">{t.photoDesc}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                       onClick={toggleDarkMode}>
                    <div className="flex items-center gap-3 text-slate-700 dark:text-slate-200 font-bold text-sm">
                      <i className={`fa-solid ${isDarkMode ? 'fa-moon text-indigo-400' : 'fa-sun text-amber-500'} text-lg w-5 text-center`}></i>
                      {language === 'ko' ? (isDarkMode ? '다크 모드' : '라이트 모드') : (isDarkMode ? 'Dark Mode' : 'Light Mode')}
                    </div>
                    <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDarkMode ? 'bg-primary-500' : 'bg-slate-300'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDarkMode ? 'translate-x-6' : 'translate-x-1'}`} />
                    </div>
                  </div>

                  <div className="space-y-1 pt-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t.displayName}</label>
                    <input
                      type="text"
                      value={tempProfile.name}
                      onChange={(e) => setTempProfile({ ...tempProfile, name: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary-500/20 font-bold text-slate-800 dark:text-white text-base tabular-nums tracking-tight"
                      placeholder={t.placeholder}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-sm shadow-lg active:scale-95 transition-all">{t.save}</button>
                    <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-sm active:scale-95 transition-all">{t.cancel}</button>
                  </div>

                  {onReset && (
                    <button
                      onClick={() => {
                        onReset();
                        setIsModalOpen(false);
                      }}
                      className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-sm hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-95 transition-all border border-red-200/50 dark:border-red-500/20"
                    >
                      <i className="fa-solid fa-rotate mr-2"></i>
                      {t.reset}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;