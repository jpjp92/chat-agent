import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient, userIdFromToken, unauthorized } from '../../../lib/supabase/route';
import { safeStorageName } from '../../../lib/storage-name';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Supabase Storage 가 서울이라 함수도 서울에 둔다(기본 iad1 이면 태평양 왕복).
export const preferredRegion = 'icn1';

export async function POST(req: NextRequest) {
    // 🔴 2026-08-17 이전 무인증이었다(upload 라우트와 같은 결함).
    const db = createRouteClient(req);
    const uid = userIdFromToken(req);
    if (!db || !uid) return unauthorized();

    const { fileName, bucket, mimeType } = await req.json();

    if (!fileName || !bucket) {
        return NextResponse.json({ error: 'fileName and bucket are required' }, { status: 400 });
    }

    const ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs'];
    if (!ALLOWED_BUCKETS.includes(bucket)) {
        return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
    }

    try {
        const timestamp = Date.now();
        // 유저별 네임스페이스 — RLS 정책이 첫 세그먼트를 auth.uid() 와 대조한다.
        const filePath = `${uid}/${timestamp}_${safeStorageName(fileName)}`;

        const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(filePath);
        if (error) throw error;

        const { data: { publicUrl } } = db.storage.from(bucket).getPublicUrl(filePath);

        return NextResponse.json({ signedUrl: data.signedUrl, publicUrl, filePath, token: data.token });
    } catch (error: any) {
        console.error('[SignedURL API] Failed:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
