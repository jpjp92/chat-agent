import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Language } from '../types';

interface HeaderProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onMenuClick?: () => void;
  showToast: (message: string, type?: 'error' | 'success' | 'info') => void;
  onReset?: () => void;
  language: Language;
}

const Header: React.FC<HeaderProps> = ({ userProfile, onUpdateProfile, onMenuClick, showToast, onReset, language }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempProfile, setTempProfile] = useState<UserProfile>(userProfile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const i18n = {
    ko: {
      displayName: "표시 이름",
      save: "저장",
      cancel: "취소",
      reset: "초기화",
      changePhoto: "이미지 변경",
      photoDesc: "정사각형 이미지, 최대 2MB",
      placeholder: "이름을 입력하세요",
      settings: "설정",
      sizeError: "이미지 용량은 2MB 이하여야 합니다.",
      updated: "프로필이 업데이트되었습니다."
    },
    en: {
      displayName: "Display Name",
      save: "Save Changes",
      cancel: "Cancel",
      reset: "Reset",
      changePhoto: "Change Photo",
      photoDesc: "Square image, max 2MB",
      placeholder: "Enter your name",
      settings: "Settings",
      sizeError: "Image size must be under 2MB.",
      updated: "Profile updated."
    },
    es: {
      displayName: "Nombre",
      save: "Guardar",
      cancel: "Cancelar",
      reset: "Reiniciar",
      changePhoto: "Cambiar foto",
      photoDesc: "Imagen cuadrada, máx 2MB",
      placeholder: "Introduce tu nombre",
      settings: "Ajustes",
      sizeError: "La imagen debe ser de menos de 2MB.",
      updated: "Perfil actualizado."
    },
    fr: {
      displayName: "Nom",
      save: "Enregistrer",
      cancel: "Annuler",
      reset: "Réinitialiser",
      changePhoto: "Changer la photo",
      photoDesc: "Image carrée, max 2Mo",
      placeholder: "Entrez votre nom",
      settings: "Paramètres",
      sizeError: "L'image doit faire moins de 2Mo.",
      updated: "Profil mis à jour."
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

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const handleSave = () => {
    onUpdateProfile(tempProfile);
    showToast(t.updated, "success");
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
    <header className="relative z-40 sticky top-0 w-full transition-all">
      {/* Background with Glass Effect */}
      <div className="absolute inset-0 bg-white/80 dark:bg-[#131314]/80 glass-effect border-none -z-10"></div>

      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center space-x-2 sm:space-x-4">
          <button
            onClick={onMenuClick}
            className="md:hidden flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-pointer transition-colors hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95"
          >
            <i className="fa-solid fa-bars text-lg"></i>
          </button>

          <div className="flex items-center group cursor-pointer">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-violet-500 via-primary-500 to-indigo-600 rounded-xl flex items-center justify-center mr-2 sm:mr-3 shadow-lg shadow-primary-500/20 group-hover:rotate-12 transition-all duration-500">
              <i className="fa-solid fa-wand-magic-sparkles text-white text-sm sm:text-lg"></i>
            </div>
            <div className="flex flex-col">
              <h1 className="font-black text-base sm:text-xl tracking-tighter leading-none bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent whitespace-nowrap">
                Chat with Gemini
              </h1>
              <p className="hidden sm:block text-[9px] font-black text-primary-500 tracking-[0.2em] uppercase mt-0.5">Next-Gen Intelligence</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleDarkMode}
            className="w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-all active:scale-95"
          >
            <i className={`fa-solid ${isDarkMode ? 'fa-sun' : 'fa-moon'} text-lg`}></i>
          </button>

          <div
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-3 cursor-pointer pl-3 pr-1 py-1 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 transition-all border border-transparent hover:border-slate-200 dark:hover:border-white/5 active:scale-95"
          >
            <div className="hidden lg:flex items-center gap-2 mr-1">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{userProfile.name}</span>
              <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
            </div>
            <img
              src={userProfile.avatarUrl}
              alt="Profile"
              className="w-9 h-9 rounded-full shadow-sm object-cover ring-2 ring-white dark:ring-slate-800"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userProfile.name);
              }}
            />
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center pb-20 sm:pb-48 px-4">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setIsModalOpen(false)}
          ></div>

          <div className="relative w-full max-w-sm animate-in slide-in-from-bottom-12 duration-500 ease-out">
            <div className="bg-white dark:bg-slate-900 rounded-[32px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-6 space-y-6">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />

                <div className="flex flex-col items-center space-y-4">
                  <div onClick={triggerFileInput} className="relative group cursor-pointer">
                    <img src={tempProfile.avatarUrl} alt="Preview" className="w-24 h-24 rounded-full border-4 border-primary-500/20 shadow-lg object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <i className="fa-solid fa-camera text-white text-xl"></i>
                    </div>
                  </div>
                  <div className="text-center">
                    <button onClick={triggerFileInput} className="text-primary-600 dark:text-primary-400 text-sm font-semibold hover:underline">{t.changePhoto}</button>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">{t.photoDesc}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
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
                    <button onClick={handleSave} className="flex-1 py-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-sm shadow-lg active:scale-95 transition-all">{t.save}</button>
                    <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-sm active:scale-95 transition-all">{t.cancel}</button>
                  </div>

                  {onReset && (
                    <button
                      onClick={() => {
                        onReset();
                        setIsModalOpen(false);
                      }}
                      className="w-full py-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-sm hover:bg-red-100 dark:hover:bg-red-500/20 active:scale-95 transition-all border border-red-200/50 dark:border-red-500/20"
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