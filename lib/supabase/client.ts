import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 브라우저 전용 Supabase 클라이언트 (anon 키).
 *
 * 라우트의 createRouteClient 와 대칭. 세션 저장·자동 갱신은 supabase-js 가 맡는다.
 * 서버에서 import 하지 말 것 — 세션이 전역 공유돼 유저가 섞인다.
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (client) return client;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 미설정');
    }

    client = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return client;
}

/**
 * 현재 access token 을 반환한다. **호출할 때마다** 세션을 읽는 게 핵심이다.
 *
 * 토큰을 한 번 캡처해두면 만료(기본 1시간) 후 401 이 터진다. getSession() 은
 * 캐시에서 읽고 필요하면 supabase-js 가 이미 갱신해둔 값을 준다 — 네트워크 왕복 없음.
 */
export async function getAccessToken(): Promise<string | null> {
    const { data } = await getSupabaseClient().auth.getSession();
    return data.session?.access_token ?? null;
}

/**
 * OAuth 가 URL 로 돌려준 에러를 읽고 **주소창에서 지운다**.
 *
 * 🔴 linkIdentity 의 실패는 두 갈래로 온다.
 *    - 리다이렉트 **전** 거절(manual linking off 등) → 예외로 throw → 호출부 catch
 *    - 리다이렉트 **후** 거절(이미 다른 유저의 신원 등) → 브라우저가 떠났다 돌아오므로
 *      예외가 아니라 `/?error=server_error&error_code=identity_already_exists` 로 온다
 *
 * 두 번째를 읽지 않으면 사용자는 아무 설명 없이 원래 화면으로 돌아온다(실측).
 * 읽은 뒤 파라미터를 제거해야 새로고침 때 유령 에러가 되살아나지 않는다.
 */
export function consumeOAuthError(): string | null {
    if (typeof window === 'undefined') return null;

    const query = new URLSearchParams(window.location.search);
    // implicit 흐름은 해시로 싣는다. 둘 다 본다.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = query.get('error_code') ?? hash.get('error_code');
    if (!code) return null;

    for (const key of ['error', 'error_code', 'error_description']) {
        query.delete(key);
        hash.delete(key);
    }
    const search = query.toString();
    const frag = hash.toString();
    window.history.replaceState(
        {},
        '',
        window.location.pathname + (search ? `?${search}` : '') + (frag ? `#${frag}` : '')
    );

    return code;
}

/**
 * 세션을 보장한다. 없으면 익명 로그인으로 게스트를 만든다.
 *
 * 진행 중인 로그인을 공유하는 게 핵심이다. React StrictMode 는 dev 에서 effect 를
 * 두 번 실행하는데, 두 실행이 각자 getSession()→null 을 보고 signInAnonymously() 를
 * 부르면 **익명 유저가 두 명 생기고 하나는 고아가 된다**(실제로 발생함).
 * 익명 로그인은 IP당 시간당 30회 제한이고 자동 정리가 없어 그대로 남는다.
 */
let signInInFlight: Promise<string | null> | null = null;

export async function ensureSession(): Promise<string | null> {
    const supabase = getSupabaseClient();

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user.id;

    if (!signInInFlight) {
        signInInFlight = (async () => {
            // 대기 사이에 다른 호출이 세션을 만들었을 수 있다.
            const { data: again } = await supabase.auth.getSession();
            if (again.session?.user) return again.session.user.id;

            const { data: signed, error } = await supabase.auth.signInAnonymously();
            if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
            return signed.user?.id ?? null;
        })().finally(() => {
            signInInFlight = null;
        });
    }
    return signInInFlight;
}
