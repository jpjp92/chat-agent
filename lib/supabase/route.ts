import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 요청의 Bearer 토큰으로 user-scoped Supabase 클라이언트를 만든다.
 *
 * 이 클라이언트는 anon 키 + 유저의 access token으로 동작하므로,
 * 모든 쿼리에 RLS가 적용된다. 그래서 라우트는 유저 id를 알 필요도,
 * 소유권을 코드로 검사할 필요도 없다 — DB가 강제한다.
 *
 * - 위조 토큰 → Supabase가 서명 검증에서 거부
 * - 타 유저 토큰 → 그 유저 자신의 데이터만 접근 (정상)
 * - chat_sessions.user_id 는 `default auth.uid()` 로 DB가 채운다
 *
 * getUser() 를 부르지 않는 게 핵심이다. 매 요청마다 auth 서버로 왕복하는 대신
 * PostgREST 가 JWT 를 검증하게 둔다.
 */
export function createRouteClient(req: Request): SupabaseClient | null {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 미설정');
    }

    return createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

/**
 * Supabase 에러가 인증 실패인지 판별한다.
 *
 * PostgREST 는 만료·위조 JWT 에 PGRST301 을 준다. 이런 건 500 이 아니라 401 이어야
 * 클라이언트가 세션을 갱신할지 로그인을 띄울지 판단할 수 있다.
 */
export function isAuthError(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    if (error.code === 'PGRST301' || error.code === '42501') return true;
    const msg = error.message?.toLowerCase() ?? '';
    return msg.includes('jwt') || msg.includes('invalid claim') || msg.includes('not authorized');
}

/** 인증 안 된 요청에 대한 표준 응답. */
export function unauthorized(): Response {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
