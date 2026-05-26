import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../api/_lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const { nickname } = await req.json();
        if (!nickname) return NextResponse.json({ error: 'Nickname is required' }, { status: 400 });

        const { data: existingUser, error: findError } = await supabase
            .from('users')
            .select('id, nickname, display_name, avatar_url')
            .eq('nickname', nickname)
            .maybeSingle();
        if (findError) throw findError;

        if (existingUser) return NextResponse.json({ user: existingUser, isNew: false });

        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert({ nickname, display_name: nickname })
            .select('id, nickname, display_name, avatar_url')
            .single();
        if (insertError) throw insertError;

        return NextResponse.json({ user: newUser, isNew: true });
    } catch (error: any) {
        console.error('[Auth API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { id, display_name, avatar_url } = await req.json();
        if (!id) return NextResponse.json({ error: 'User ID is required' }, { status: 400 });

        const updatePayload: { display_name?: string; avatar_url?: string } = {};
        if (display_name !== undefined) updatePayload.display_name = display_name;
        if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;

        if (Object.keys(updatePayload).length === 0) {
            return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
        }

        const { data: updatedUser, error } = await supabase
            .from('users')
            .update(updatePayload)
            .eq('id', id)
            .select('id, nickname, display_name, avatar_url')
            .single();
        if (error) throw error;

        return NextResponse.json({ user: updatedUser });
    } catch (error: any) {
        console.error('[Auth API] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
