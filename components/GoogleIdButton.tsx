import React, { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, loadGoogleIdentity, makeRawNonce, sha256Hex, gisLocale, type GoogleCredential } from '../src/lib/google-id';

interface Props {
    /** ID 토큰을 받았을 때. nonce 는 **원문** — Supabase 에 그대로 넘긴다. */
    onCredential: (cred: GoogleCredential) => void;
    /** 클라이언트 ID 없음·스크립트 차단·초기화 실패 → 호출부가 리다이렉트 버튼을 보인다. */
    onUnavailable: () => void;
    language: string;
    isDark: boolean;
    disabled?: boolean;
}

/**
 * Google 공식 로그인 버튼(GIS renderButton). ID 토큰 흐름은 **Google 이 그린 버튼**으로만 시작된다 —
 * 우리 버튼에서 `prompt()`(One Tap)를 부르면 사용자가 한 번 닫은 뒤 쿨다운으로 조용히 안 뜬다.
 * nonce 는 렌더마다 새로 만든다(재사용하면 재전송 방어가 무의미).
 */
const GoogleIdButton: React.FC<Props> = ({ onCredential, onUnavailable, language, isDark, disabled }) => {
    const box = useRef<HTMLDivElement>(null);
    // 콜백은 최신 것을 쓰되, 버튼은 언어·테마가 바뀔 때만 다시 그린다.
    const cb = useRef({ onCredential, onUnavailable });
    cb.current = { onCredential, onUnavailable };
    // GIS 가 iframe 을 그리기 전까지 같은 크기의 알약 자리표시자 — 빈칸에서 버튼이 툭 튀어나오지 않게
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!GOOGLE_CLIENT_ID) { cb.current.onUnavailable(); return; }
        let cancelled = false;
        (async () => {
            try {
                const gid = await loadGoogleIdentity();
                const raw = makeRawNonce();
                const hashed = await sha256Hex(raw);
                if (cancelled || !box.current) return;
                gid.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    nonce: hashed,
                    callback: (res: { credential?: string }) => {
                        if (res?.credential) cb.current.onCredential({ token: res.credential, nonce: raw });
                    },
                    ux_mode: 'popup',
                    use_fedcm_for_button: true,
                    auto_select: false,
                    itp_support: true,
                });
                box.current.replaceChildren();
                gid.renderButton(box.current, {
                    type: 'standard',
                    // 다크에서도 흰 단색(outline) — filled_black 은 반투명 회색이라 카카오 노랑 옆에서 흐려 보인다.
                    theme: 'outline',
                    size: 'large',
                    shape: 'pill',
                    text: 'continue_with',
                    logo_alignment: 'center',
                    locale: gisLocale(language),
                    width: Math.min(box.current.clientWidth || 320, 400),
                });
                // renderButton 은 iframe 을 넣고 바로 돌아온다 — iframe 이 그려질 짧은 틈을 자리표시자가 덮는다
                const frame = box.current.querySelector('iframe');
                if (frame) frame.addEventListener('load', () => { if (!cancelled) setReady(true); }, { once: true });
                setTimeout(() => { if (!cancelled) setReady(true); }, 1500);
            } catch (e) {
                console.error('[GoogleIdButton] GIS unavailable — falling back to redirect OAuth', e);
                if (!cancelled) cb.current.onUnavailable();
            }
        })();
        return () => { cancelled = true; };
    }, [language, isDark]);

    return (
        <div className="relative w-full min-h-[44px]">
            {!ready && (
                <div aria-hidden className="absolute inset-x-0 top-0 mx-auto h-10 max-w-[400px] rounded-full bg-white border border-slate-200 dark:border-white/10 animate-pulse" />
            )}
            <div
                ref={box}
                className={`w-full min-h-[44px] flex justify-center transition-opacity duration-200 ${!ready ? 'opacity-0' : disabled ? 'opacity-60' : 'opacity-100'} ${disabled ? 'pointer-events-none' : ''}`}
                aria-busy={disabled}
            />
        </div>
    );
};

export default GoogleIdButton;
