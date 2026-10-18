/**
 * Google Identity Services(GIS) — 앱 안에서 Google ID 토큰을 받는다. 검증: `npx tsx tests/test-google-id.mts`
 *
 * 리다이렉트 OAuth(signInWithOAuth)는 콜백이 Supabase 라 Google 계정 선택 화면에 "…supabase.co(으)로 이동" 이
 * 뜬다. GIS 는 우리 도메인에서 팝업/FedCM 으로 ID 토큰을 받아 `signInWithIdToken`·`linkIdentity({ token })` 로
 * 넘긴다 → Supabase 주소가 노출되지 않는다 → DEV_261011
 *
 * nonce: Google 에는 **SHA-256 해시**를, Supabase 에는 **원문**을 준다(Supabase 가 원문을 해시해 토큰의 nonce 와 비교).
 * 클라이언트 ID 가 없거나 스크립트가 막히면 호출부는 리다이렉트 버튼으로 떨어진다(로그인이 깨지지 않게).
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 6000;

export type GoogleCredential = { token: string; nonce: string };

/** 원문 nonce — 32바이트 랜덤, URL-safe. */
export const makeRawNonce = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** SHA-256 hex — Google `nonce` 에 넣는 값. Supabase 는 원문을 같은 방식으로 해시해 비교한다. */
export const sha256Hex = async (text: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

let loading: Promise<any> | null = null;

/** GIS 스크립트를 한 번만 싣는다. 실패·시간 초과면 reject → 호출부가 리다이렉트로 떨어진다. */
export const loadGoogleIdentity = (): Promise<any> => {
    const w = window as any;
    if (w.google?.accounts?.id) return Promise.resolve(w.google.accounts.id);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { loading = null; reject(new Error('GIS load timeout')); }, LOAD_TIMEOUT_MS);
        const done = (ok: boolean) => {
            clearTimeout(timer);
            if (ok && w.google?.accounts?.id) resolve(w.google.accounts.id);
            else { loading = null; reject(new Error('GIS unavailable')); }
        };
        let s = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
        if (!s) {
            s = document.createElement('script');
            s.src = GIS_SRC; s.async = true; s.defer = true;
            document.head.appendChild(s);
        }
        s.addEventListener('load', () => done(true), { once: true });
        s.addEventListener('error', () => done(false), { once: true });
    });
    return loading;
};

/** GIS 버튼 로케일 — 앱 언어를 그대로. */
export const gisLocale = (lang: string): string => ({ ko: 'ko', en: 'en', es: 'es', fr: 'fr' } as Record<string, string>)[lang] ?? 'en';

/**
 * Supabase 가 "이 Google 신원은 이미 다른 유저 것" 이라고 거절했나 — 충돌 분기 판정.
 * 리다이렉트 경로와 같은 기준(AuthModal 기존 판정)을 한 곳으로 모았다.
 */
export const isIdentityConflict = (e: any): boolean =>
    e?.code === 'identity_already_exists' || /already/i.test(String(e?.message ?? ''));
