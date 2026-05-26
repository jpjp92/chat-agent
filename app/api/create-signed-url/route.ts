import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../server/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const { fileName, bucket, mimeType } = await req.json();

    if (!fileName || !bucket) {
        return NextResponse.json({ error: 'fileName and bucket are required' }, { status: 400 });
    }

    const ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs'];
    if (!ALLOWED_BUCKETS.includes(bucket)) {
        return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
    }

    if (!supabaseAdmin) {
        return NextResponse.json({ error: 'Supabase Admin client not initialized. Check SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
    }

    try {
        const timestamp = Date.now();
        const safeBaseName = fileName.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
        const filePath = `${timestamp}_${safeBaseName}`;

        const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(filePath);
        if (error) throw error;

        const { data: { publicUrl } } = supabaseAdmin.storage.from(bucket).getPublicUrl(filePath);

        return NextResponse.json({ signedUrl: data.signedUrl, publicUrl, filePath, token: data.token });
    } catch (error: any) {
        console.error('[SignedURL API] Failed:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
