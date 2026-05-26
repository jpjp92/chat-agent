import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    try {
        const { fileName, fileData, mimeType, bucket } = await req.json();

        if (!fileName || !fileData || !mimeType || !bucket) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs'];
        if (!ALLOWED_BUCKETS.includes(bucket)) {
            return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
        }

        const base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
        const buffer = Buffer.from(base64Data, 'base64');

        const timestamp = Date.now();
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex !== -1 ? fileName.substring(lastDotIndex + 1) : '';
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'file';
        const filePath = `${timestamp}_${safeBaseName}${ext ? '.' + ext : ''}`;

        const { supabaseAdmin, supabase } = await import('../../../server/supabase');
        const client = supabaseAdmin ?? supabase;
        if (!client) throw new Error('Supabase client not initialized');

        const { data, error: uploadError } = await client.storage
            .from(bucket)
            .upload(filePath, buffer, { contentType: mimeType, upsert: true });
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(filePath);
        return NextResponse.json({ url: publicUrl, filePath: data.path });
    } catch (error: any) {
        console.error('[Upload API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
