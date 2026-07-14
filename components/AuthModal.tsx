import React, { useEffect, useState } from 'react';
import { Language } from '../types';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** 왜 열렸는가. 'limit'이면 한도 도달 문구, 'save'면 자발적 저장 문구. */
    reason?: 'save' | 'limit';
    /** 게스트 표시 이름 — 승계 대상을 사용자에게 그대로 보여준다. */
    guestName: string;
    guestAvatarUrl?: string | null;
    /** 승계될 대화 수. 0이면 문구를 숨긴다(빈 약속을 하지 않는다). */
    sessionCount: number;
    /** 게스트 → Google 연결 (같은 uuid, 대화 승계) */
    onLink: () => Promise<void>;
    /** 기존 계정으로 로그인 (게스트 대화 미승계) */
    onSignIn: () => Promise<void>;
    /**
     * 충돌 분기로 바로 연다. OAuth 리다이렉트 **후** 거절은 예외가 아니라 URL 로 오므로
     * (consumeOAuthError), 호출부가 그걸 읽어 이 플래그로 넘긴다.
     */
    initialConflict?: boolean;
    language: Language;
}

const i18n = {
    ko: {
        // 🔴 '저장'이라 하면 안 된다 — 게스트도 익명 계정이 있어 대화는 이미 DB에 있다.
        // 로그인해야만 되는 것은 '다른 기기에서 잇기'뿐이다. 제목은 그 진짜 혜택을 말한다.
        title: '다른 기기에서도 이어보기',
        limitTitle: '무료 체험이 끝났어요',
        limitSubtitle: '게스트로는 5개까지 보낼 수 있어요. 계정을 연결하면 계속 이어서 대화할 수 있고, 지금까지의 기록도 그대로 옮겨집니다.',
        carry: (n: number) => `대화 ${n}개가 그대로 옮겨집니다`,
        google: 'Google로 계속하기',
        linking: '연결하는 중…',
        conflictTitle: '이미 사용 중인 Google 계정입니다',
        conflictBody: '그 계정으로 로그인할 수 있습니다. 다만 지금 게스트로 나눈 대화는 옮겨지지 않습니다.',
        conflictAction: '기존 계정으로 로그인',
        genericError: '연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
        close: '닫기',
        guestBadge: '게스트',
    },
    en: {
        title: 'Pick up on any device',
        limitTitle: "You've reached the free limit",
        limitSubtitle: 'Guests can send 5 messages. Link an account to keep going — your history carries over.',
        carry: (n: number) => `${n} conversation${n === 1 ? '' : 's'} will carry over`,
        google: 'Continue with Google',
        linking: 'Linking…',
        conflictTitle: 'That Google account is already in use',
        conflictBody: 'You can sign in to it. Your current guest conversations will not carry over.',
        conflictAction: 'Sign in to that account',
        genericError: 'Could not link the account. Please try again.',
        close: 'Close',
        guestBadge: 'Guest',
    },
    es: {
        title: 'Continúa en cualquier dispositivo',
        limitTitle: 'Has alcanzado el límite gratuito',
        limitSubtitle: 'Los invitados pueden enviar 5 mensajes. Vincula una cuenta para seguir — tu historial se conserva.',
        carry: (n: number) => `${n} conversación${n === 1 ? '' : 'es'} se transferirá${n === 1 ? '' : 'n'}`,
        google: 'Continuar con Google',
        linking: 'Vinculando…',
        conflictTitle: 'Esa cuenta de Google ya está en uso',
        conflictBody: 'Puedes iniciar sesión en ella, pero tus conversaciones de invitado no se transferirán.',
        conflictAction: 'Iniciar sesión en esa cuenta',
        genericError: 'No se pudo vincular la cuenta. Inténtalo de nuevo.',
        close: 'Cerrar',
        guestBadge: 'Invitado',
    },
    fr: {
        title: 'Reprenez sur tout appareil',
        limitTitle: 'Vous avez atteint la limite gratuite',
        limitSubtitle: "Les invités peuvent envoyer 5 messages. Liez un compte pour continuer — votre historique est conservé.",
        carry: (n: number) => `${n} conversation${n === 1 ? '' : 's'} ${n === 1 ? 'sera transférée' : 'seront transférées'}`,
        google: 'Continuer avec Google',
        linking: 'Liaison…',
        conflictTitle: 'Ce compte Google est déjà utilisé',
        conflictBody: "Vous pouvez vous y connecter, mais vos conversations d'invité ne seront pas transférées.",
        conflictAction: 'Se connecter à ce compte',
        genericError: 'Échec de la liaison. Veuillez réessayer.',
        close: 'Fermer',
        guestBadge: 'Invité',
    },
};

/** brands 아이콘셋이 로드되지 않아 fa-google을 못 쓴다 → 공식 G 마크 인라인. */
const GoogleMark = () => (
    <svg viewBox="0 0 18 18" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
);

const AuthModal: React.FC<AuthModalProps> = ({
    isOpen, onClose, reason = 'save', guestName, guestAvatarUrl, sessionCount, onLink, onSignIn,
    initialConflict = false, language,
}) => {
    const t = i18n[language] || i18n.ko;
    const isLimit = reason === 'limit';
    const [busy, setBusy] = useState(false);
    const [conflict, setConflict] = useState(initialConflict);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setBusy(false);
        setError(null);
        // 열 때마다 충돌 상태를 호출부 판단으로 되돌린다. 닫고 다시 열면 초기화되지만,
        // 리다이렉트로 돌아온 충돌(initialConflict)은 그대로 보여줘야 한다.
        setConflict(isOpen ? initialConflict : false);
    }, [isOpen, initialConflict]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleLink = async () => {
        setBusy(true); setError(null);
        try {
            await onLink();
            // 성공하면 OAuth 리다이렉트로 페이지를 떠난다.
        } catch (e: any) {
            // 사용자에겐 일반 메시지를 보여주지만, 원본은 남겨야 한다. 링크 실패는
            // provider 미등록 / manual linking 비활성 / 충돌이 전부 같은 화면으로 보인다.
            console.error('[AuthModal] linkIdentity failed:', e?.code, e?.message, e);
            // 이미 다른 유저에게 묶인 신원 → 충돌 분기. 이게 없으면 사용자는 무한 재시도에 갇힌다.
            const msg = String(e?.message ?? '').toLowerCase();
            if (msg.includes('already') || e?.code === 'identity_already_exists') setConflict(true);
            else setError(t.genericError);
            setBusy(false);
        }
    };

    const handleSignIn = async () => {
        setBusy(true); setError(null);
        try { await onSignIn(); } catch (e: any) {
            console.error('[AuthModal] signInWithOAuth failed:', e?.code, e?.message, e);
            setError(t.genericError); setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
            <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md modal-backdrop-in" onClick={onClose} />

            <div className="relative w-full max-w-sm modal-panel-in">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden">
                    <button
                        onClick={onClose}
                        aria-label={t.close}
                        className="absolute right-3 top-3 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                        <i className="fa-solid fa-xmark text-sm" />
                    </button>

                    <div className="p-6">
                        {conflict ? (
                            <>
                                <div className="flex flex-col items-center text-center space-y-3">
                                    <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-500/10 text-amber-500">
                                        <i className="fa-solid fa-circle-exclamation text-xl" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <h3 id="auth-modal-title" className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                                            {t.conflictTitle}
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                                            {t.conflictBody}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleSignIn}
                                    disabled={busy}
                                    className="w-full mt-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-primary-600/20 transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                                >
                                    {busy ? t.linking : t.conflictAction}
                                </button>
                            </>
                        ) : (
                            <>
                                {/* 시그니처 — 연속성 스트립.
                                    일반적인 자물쇠 아이콘 대신 사용자의 실제 게스트 신원이
                                    Google 계정으로 건너가는 모습을 보여준다. 같은 uuid가 유지된다는
                                    제품의 사실을 그대로 그림으로 만든 것. */}
                                <div className="flex items-center justify-center gap-3 pt-1 pb-5">
                                    <div className="flex flex-col items-center gap-1.5">
                                        <img
                                            src={guestAvatarUrl || undefined}
                                            alt=""
                                            className="w-11 h-11 rounded-full object-cover ring-2 ring-slate-200 dark:ring-white/10"
                                        />
                                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide uppercase">
                                            {t.guestBadge}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 pb-5" aria-hidden="true">
                                        <span className="block w-6 h-px bg-gradient-to-r from-slate-200 to-primary-400 dark:from-white/10 dark:to-primary-500" />
                                        <i className="fa-solid fa-link text-[10px] text-primary-500" />
                                        <span className="block w-6 h-px bg-gradient-to-r from-primary-400 to-slate-200 dark:from-primary-500 dark:to-white/10" />
                                    </div>

                                    <div className="flex flex-col items-center gap-1.5">
                                        <div className="w-11 h-11 rounded-full bg-white dark:bg-white/5 ring-2 ring-slate-200 dark:ring-white/10 flex items-center justify-center">
                                            <GoogleMark />
                                        </div>
                                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide uppercase">
                                            Google
                                        </span>
                                    </div>
                                </div>

                                <div className="text-center space-y-1.5">
                                    <h3 id="auth-modal-title" className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                                        {isLimit ? t.limitTitle : t.title}
                                    </h3>
                                    {/* 자발적 진입(save)엔 설명이 없다 — 제목이 혜택을, 아래 칩이 약속을 말하므로
                                        한 줄 더 쓰면 같은 말을 세 번 하게 된다. 한도(limit)는 왜 막혔는지
                                        알려줘야 하니 설명을 남긴다. */}
                                    {isLimit && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                                            {t.limitSubtitle}
                                        </p>
                                    )}
                                </div>

                                {sessionCount > 0 && (
                                    <div className="mt-4 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-primary-50 dark:bg-primary-500/10">
                                        <i className="fa-solid fa-arrow-right-arrow-left text-[10px] text-primary-600 dark:text-primary-400" />
                                        <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">
                                            {t.carry(sessionCount)}
                                        </span>
                                    </div>
                                )}

                                <button
                                    onClick={handleLink}
                                    disabled={busy}
                                    className="w-full mt-5 py-3 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-60 text-slate-800 dark:text-slate-100 font-bold text-sm flex items-center justify-center gap-2.5 transition-colors active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                                >
                                    {busy ? (
                                        <span className="text-slate-500 dark:text-slate-400">{t.linking}</span>
                                    ) : (
                                        <>
                                            <GoogleMark />
                                            {t.google}
                                        </>
                                    )}
                                </button>

                                {error && (
                                    <p className="mt-3 text-center text-xs font-medium text-red-500">{error}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
