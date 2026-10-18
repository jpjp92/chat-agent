import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Language } from '../types';
import { CHAT_MODEL_OPTIONS, CHAT_MODEL_SECTIONS, pickLabel, type ChatModelId } from '../src/lib/models';

interface HeaderProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onMenuClick?: () => void;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
  /** 게스트면 로그인 유도, 아니면 로그아웃을 보여준다. */
  isGuest: boolean;
  /** 로그인 상태에서 어느 계정인지 보여준다. */
  userEmail?: string | null;
  /** 게스트 → 로그인 모달 열기 */
  onLogin: () => void;
  /** 로그인 상태 → 다른 Google 계정으로 갈아탄다(로그아웃 선행 불요) */
  onSignOut: () => void;
  language: Language;
  selectedModel: ChatModelId;          // 모바일 헤더 모델 선택기용 (데스크톱은 입력창에 통합)
  onModelChange: (model: ChatModelId) => void;
}

const Header: React.FC<HeaderProps> = ({ userProfile, onUpdateProfile, onMenuClick, showToast, isGuest, userEmail, onLogin, onSignOut, language, selectedModel, onModelChange }) => {
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
      changePhoto: "이미지 변경",
      photoDesc: "정사각형 이미지, 최대 10MB",
      placeholder: "이름을 입력하세요",
      sizeError: "용량 초과 (최대 10MB)",
      signIn: "로그인",
      signInDesc: "로그인하면 어느 기기에서든 대화를 이어갈 수 있어요.",
      signOut: "로그아웃",
      guestLabel: "게스트",
    },
    en: {
      displayName: "Display Name",
      save: "Save Changes",
      cancel: "Cancel",
      changePhoto: "Change Photo",
      photoDesc: "Square image, max 10MB",
      placeholder: "Enter your name",
      sizeError: "File too large (Max 10MB)",
      signIn: "Sign in",
      signInDesc: "Sign in to pick up your chats on any device.",
      signOut: "Sign out",
      guestLabel: "Guest",
    },
    es: {
      displayName: "Nombre",
      save: "Guardar",
      cancel: "Cancelar",
      changePhoto: "Cambiar foto",
      photoDesc: "Imagen cuadrada, máx 10MB",
      placeholder: "Introduce tu nombre",
      sizeError: "Archivo muy grande (Máx 10MB)",
      signIn: "Iniciar sesión",
      signInDesc: "Inicia sesión para continuar tus chats en cualquier dispositivo.",
      signOut: "Cerrar sesión",
      guestLabel: "Invitado",
    },
    fr: {
      displayName: "Nom",
      save: "Enregistrer",
      cancel: "Annuler",
      changePhoto: "Changer la photo",
      photoDesc: "Image carrée, max 10Mo",
      placeholder: "Entrez votre nom",
      sizeError: "Fichier trop lourd (Max 10Mo)",
      signIn: "Se connecter",
      signInDesc: "Connectez-vous pour retrouver vos conversations sur tout appareil.",
      signOut: "Se déconnecter",
      guestLabel: "Invité",
    }
  };

  const t = i18n[language] || i18n.ko;
  const selectedModelOption = CHAT_MODEL_OPTIONS.find(option => option.id === selectedModel) ?? CHAT_MODEL_OPTIONS[0];

  useEffect(() => {
    if (document.documentElement.classList.contains('dark')) {
      setIsDarkMode(true);
    }
  }, []);

  // 모바일 모델 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setIsModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);


  const toggleDarkMode = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    setIsDarkMode(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  };

  const handleSave = () => {
    onUpdateProfile(tempProfile);
    setIsModalOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
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
    <header className="sticky top-0 z-40 px-3 sm:px-4 pt-3">
      {/* bare 플로팅 — 좌: 모바일 햄버거 + (모바일)모델 선택기 / 우: 프로필 아바타. 데스크톱 모델은 입력창에 통합 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={onMenuClick}
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-full text-slate-500 cursor-pointer transition-colors hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95"
          >
            <i className="fa-solid fa-bars text-base"></i>
          </button>

          {/* 모바일 전용 모델 선택기 (데스크톱은 입력창에 통합 → md:hidden) */}
          <div ref={modelMenuRef} className="md:hidden relative">
            <button
              onClick={() => setIsModelMenuOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 transition"
            >
              <span className="text-[15px] font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400">{pickLabel(selectedModelOption.label, language)}</span>
              <i className={`fa-solid fa-chevron-down text-xs text-indigo-400/70 dark:text-indigo-400/60 transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`}></i>
            </button>
            {isModelMenuOpen && (
              <div className="model-menu-scrollbar absolute top-full left-0 mt-1 w-60 max-h-[min(19rem,60vh)] overflow-y-auto overscroll-contain bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-white/10 py-1 z-50">
                {CHAT_MODEL_SECTIONS.map((section, sectionIndex) => (
                  <div key={section.id} className={sectionIndex > 0 ? 'border-t border-slate-100 dark:border-white/10' : ''}>
                    <div className={`px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 ${section.id === 'gemini' ? 'text-indigo-500/75 dark:text-indigo-300/65' : section.id === 'openai' ? 'text-emerald-600/75 dark:text-emerald-300/65' : 'text-slate-400 dark:text-white/35'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${section.id === 'gemini' ? 'bg-indigo-400/80' : section.id === 'openai' ? 'bg-emerald-400/80' : 'bg-slate-300/80 dark:bg-slate-500/70'}`} />
                      {pickLabel(section.label, language)}
                    </div>
                    {CHAT_MODEL_OPTIONS.filter(option => option.section === section.id).map(option => (
                      <button type="button" key={option.id} onClick={() => { onModelChange(option.id); setIsModelMenuOpen(false); }} className={`w-full px-4 py-2.5 flex justify-between items-center gap-3 text-left transition-colors ${section.id === 'gemini' ? 'hover:bg-indigo-50/60 dark:hover:bg-indigo-400/5' : section.id === 'openai' ? 'hover:bg-emerald-50/60 dark:hover:bg-emerald-400/5' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                        <span className="min-w-0">
                          <span className="block font-semibold text-sm text-slate-800 dark:text-white/90">{pickLabel(option.label, language)}</span>
                          <span className="block text-[10px] font-medium text-slate-500 dark:text-white/40 mt-0.5 tracking-wide">{pickLabel(option.description, language)}</span>
                        </span>
                        {selectedModel === option.id && <i className={`fa-solid fa-check shrink-0 ${section.id === 'gemini' ? 'text-indigo-500 dark:text-indigo-300' : section.id === 'openai' ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-300'}`}></i>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          onClick={() => { setTempProfile(userProfile); setIsModalOpen(true); }}
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

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center pb-[22dvh] px-4">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-md modal-backdrop-in"
            onClick={() => setIsModalOpen(false)}
          ></div>

          <div className="relative w-full max-w-xs modal-panel-in">
            <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-2xl rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] border border-white/50 dark:border-white/10 overflow-hidden">
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
                  <div className="flex items-center justify-between bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
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
                      className="w-full bg-black/5 dark:bg-black/20 border border-black/5 dark:border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary-500/30 focus:bg-white/50 dark:focus:bg-black/40 transition-all font-bold text-slate-800 dark:text-white text-base tabular-nums tracking-tight"
                      placeholder={t.placeholder}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 font-black text-sm shadow-lg active:scale-95 transition-all">{t.save}</button>
                    <button onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-sm active:scale-95 transition-all">{t.cancel}</button>
                  </div>

                  {/* 계정 — 게스트면 로그인 유도, 로그인 상태면 어느 계정인지 + 로그아웃.
                      로그인 진입점이 한도 모달뿐이면, 로그아웃한 사용자는 메시지 5개를
                      태워야 계정으로 돌아올 수 있다. 그래서 여기 상시 진입점을 둔다. */}
                  <div className="pt-3 mt-1 border-t border-black/5 dark:border-white/10 space-y-2">
                    {isGuest ? (
                      <>
                        <button
                          onClick={() => { setIsModalOpen(false); onLogin(); }}
                          className="w-full py-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-800 dark:text-white font-bold text-sm active:scale-95 transition-all border border-black/5 dark:border-white/10 flex items-center justify-center gap-2"
                        >
                          {/* 공급자 중립 — 이 버튼은 로그인 모달(Google·카카오)을 연다. G 마크·"Google로" 문구는 쓰지 않는다. */}
                          <i className="fa-solid fa-right-to-bracket text-xs" aria-hidden="true"></i>
                          {t.signIn}
                        </button>
                        <p className="text-[11px] text-center text-slate-400 dark:text-slate-500 leading-snug px-2">{t.signInDesc}</p>
                      </>
                    ) : (
                      <>
                        {userEmail && (
                          <p className="text-xs text-center text-slate-500 dark:text-slate-400 font-medium truncate px-2">{userEmail}</p>
                        )}
                        {/* 계정 전환 버튼은 두지 않는다 — 로그아웃하면 새 게스트가 되고, 로그인 모달에서
                            계정을 고르면 된다(대화 없는 게스트 → signIn). 전환 경로는 정식 계정에
                            다른 신원을 link 할 위험만 늘린다 → DEV_261011 §5 */}
                        <button
                          onClick={() => { setIsModalOpen(false); onSignOut(); }}
                          className="w-full py-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 font-bold text-sm active:scale-95 transition-all"
                        >
                          <i className="fa-solid fa-arrow-right-from-bracket mr-2"></i>
                          {t.signOut}
                        </button>
                      </>
                    )}
                  </div>
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
