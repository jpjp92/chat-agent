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

/**
 * Bearer 토큰에서 유저 id(`sub`)를 꺼낸다 — **서명은 검증하지 않는다.**
 *
 * 왜 검증하지 않아도 되는가: 이 값은 **Storage 경로를 조립하는 데만** 쓴다
 * (`${uid}/${timestamp}_${name}.ext`). 실제 인가는 `storage.objects` 의 RLS 정책
 * (`(storage.foldername(name))[1] = auth.uid()::text`)이 한다. 위조 토큰으로 남의 uid 를
 * 넣어 경로를 만들어도 **PostgREST/Storage 가 JWT 서명을 검증해 거부**한다.
 * `getUser()` 를 부르지 않는 것은 `createRouteClient` 와 같은 이유다 — 매 요청 auth 왕복 회피.
 *
 * 🔴 이 값을 **인가 판단에 직접 쓰면 안 된다.** 경로 조립 전용이다.
 */
export function userIdFromToken(req: Request): string | null {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const payload = authHeader.slice(7).split('.')[1];
    if (!payload) return null;
    try {
        const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const sub = JSON.parse(json)?.sub;
        // UUID 형태만 허용 — 경로에 들어가므로 traversal·구분자 주입을 원천 차단한다.
        return typeof sub === 'string' && /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
    } catch {
        return null;
    }
}

/** 인증 안 된 요청에 대한 표준 응답. */
export function unauthorized(): Response {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
