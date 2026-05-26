import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../api/_lib/supabase.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const user_id = searchParams.get('user_id');
    const session_id = searchParams.get('session_id');

    try {
        if (session_id) {
            const { data: messages, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', session_id)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return NextResponse.json({ messages });
        }
        if (user_id) {
            const offset = parseInt(searchParams.get('offset') || '0', 10);
            const limit = parseInt(searchParams.get('limit') || '30', 10);
            const { data: sessions, error, count } = await supabase
                .from('chat_sessions')
                .select('*', { count: 'exact' })
                .eq('user_id', user_id)
                .order('updated_at', { ascending: false })
                .range(offset, offset + limit - 1);
            if (error) throw error;
            return NextResponse.json({ sessions, total: count ?? 0 });
        }
        return NextResponse.json({ error: 'user_id or session_id required' }, { status: 400 });
    } catch (error: any) {
        console.error('[Sessions API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { user_id, title } = await req.json();
        const { data: session, error } = await supabase
            .from('chat_sessions')
            .insert({ user_id, title: title || 'New Chat' })
            .select()
            .single();
        if (error) throw error;
        return NextResponse.json({ session });
    } catch (error: any) {
        console.error('[Sessions API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { session_id } = await req.json();
        const { error } = await supabase.from('chat_sessions').delete().eq('id', session_id);
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Sessions API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { session_id, title } = await req.json();
        if (!session_id || !title) {
            return NextResponse.json({ error: 'session_id and title are required' }, { status: 400 });
        }
        const { data: session, error } = await supabase
            .from('chat_sessions')
            .update({ title, updated_at: new Date().toISOString() })
            .eq('id', session_id)
            .select()
            .single();
        if (error) throw error;
        return NextResponse.json({ session });
    } catch (error: any) {
        console.error('[Sessions API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
