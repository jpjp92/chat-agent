import React, { useEffect, useRef } from 'react';
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
            } catch (e) {
                console.error('[GoogleIdButton] GIS unavailable — falling back to redirect OAuth', e);
                if (!cancelled) cb.current.onUnavailable();
            }
        })();
        return () => { cancelled = true; };
    }, [language, isDark]);

    return (
        <div
            ref={box}
            className={`w-full min-h-[44px] flex justify-center ${disabled ? 'pointer-events-none opacity-60' : ''}`}
            aria-busy={disabled}
        />
    );
};

export default GoogleIdButton;
