import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAuthError, unauthorized } from '../lib/supabase/route';

type AuxKind = 'fetch_url' | 'drug_image' | 'showtimes';

/**
 * 보조 라우트의 게스트 일일 한도 — 유료·외부 호출 **직전**(캐시 미스 뒤)에 부른다(docs/guide/db/aux-quota.sql).
 * 막히면 돌려줄 응답을, 통과면 null 을 준다.
 * 회원은 RPC 를 부르지 않는다(왕복 절약). 게스트는 RPC 가 실패하면 막는다(fail-closed) —
 * 익명 세션은 무료로 계속 만들 수 있어 한도 없이 열면 유료 호출이 무방비가 된다.
 */
export async function consumeAuxQuota(
    auth: { db: SupabaseClient; isGuest: boolean },
    kind: AuxKind,
    tag: string,
): Promise<Response | null> {
    if (!auth.isGuest) return null;
    const { data, error } = await auth.db.rpc('consume_aux_quota', { p_kind: kind });
    if (error) {
        if (isAuthError(error)) return unauthorized();
        console.error(`[${tag}] aux quota rpc failed:`, error.message);
        return NextResponse.json({ error: 'Service unavailable', list: [] }, { status: 503 });
    }
    if (data?.allowed) return null;
    if (data?.reason === 'unauthenticated') return unauthorized();
    if (data?.reason === 'quota') {
        // list: [] — 상영표 화면은 오류 응답에도 list 를 배열로 읽는다
        return NextResponse.json({ error: 'Daily guest limit reached', reason: 'quota', used: data.used, limit: data.limit, list: [] }, { status: 429 });
    }
    return NextResponse.json({ error: 'Invalid request', reason: data?.reason ?? 'denied' }, { status: 400 });
}
