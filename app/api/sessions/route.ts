import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient, isAuthError, unauthorized } from '../../../lib/supabase/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// user_id 는 요청에서 받지 않는다. Bearer 토큰의 auth.uid() 와 RLS 가 스코프를 강제한다.
// 예전 `?user_id=` 파라미터는 무시된다(전달돼도 타 유저 데이터가 나오지 않는다).

function fail(error: { code?: string; message?: string }, tag: string) {
    if (isAuthError(error)) return unauthorized();
    console.error(`[Sessions API] ${tag}:`, error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
    const db = createRouteClient(req);
    if (!db) return unauthorized();

    const { searchParams } = req.nextUrl;
    const session_id = searchParams.get('session_id');

    if (session_id) {
        // RLS: 소속 세션이 본인 것일 때만 메시지가 보인다.
        const { data: messages, error } = await db
            .from('chat_messages')
            .select('id, role, content, attachment_url, grounding_sources, created_at')
            .eq('session_id', session_id)
            .order('created_at', { ascending: true });
        if (error) return fail(error, 'GET messages');
        return NextResponse.json({ messages });
    }

    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '30', 10);

    const { data: sessions, error } = await db
        .from('chat_sessions')
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) return fail(error, 'GET sessions');

    return NextResponse.json({ sessions, hasMore: (sessions?.length ?? 0) === limit });
}

export async function POST(req: NextRequest) {
    const db = createRouteClient(req);
    if (!db) return unauthorized();

    let title: string | undefined;
    try {
        ({ title } = await req.json());
    } catch {
        title = undefined;
    }

    // user_id 를 넘기지 않는다 — DB 의 `default auth.uid()` 가 채운다.
    const { data: session, error } = await db
        .from('chat_sessions')
        .insert({ title: title || 'New Chat' })
        .select('id, title, created_at, updated_at')
        .single();
    if (error) return fail(error, 'POST');

    return NextResponse.json({ session });
}

export async function DELETE(req: NextRequest) {
    const db = createRouteClient(req);
    if (!db) return unauthorized();

    const { session_id } = await req.json();
    if (!session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

    // RLS 가 타인의 세션을 걸러내므로 소유권 검증 코드가 필요 없다.
    const { error } = await db.from('chat_sessions').delete().eq('id', session_id);
    if (error) return fail(error, 'DELETE');

    return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
    const db = createRouteClient(req);
    if (!db) return unauthorized();

    const { session_id, title } = await req.json();
    if (!session_id || !title) {
        return NextResponse.json({ error: 'session_id and title are required' }, { status: 400 });
    }

    const { data: session, error } = await db
        .from('chat_sessions')
        .update({ title })
        .eq('id', session_id)
        .select('id, title, updated_at')
        .maybeSingle();
    if (error) return fail(error, 'PATCH');

    // 타인의 세션이면 RLS 가 0행을 반환한다 → 404 (200으로 성공을 위장하지 않는다).
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ session });
}
