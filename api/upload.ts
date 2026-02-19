import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/supabase.js';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '30mb',
        },
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { fileName, fileData, mimeType, bucket } = req.body;

        if (!fileName || !fileData || !mimeType || !bucket) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Base64 데이터를 Buffer로 변환
        const base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
        const buffer = Buffer.from(base64Data, 'base64');

        // 2. 고유 파일명 생성 및 파일명 정제 (한글 등 특수문자 제거)
        const timestamp = Date.now();
        const lastDotIndex = fileName.lastIndexOf('.');
        const baseName = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
        const ext = lastDotIndex !== -1 ? fileName.substring(lastDotIndex + 1) : '';

        // 영문, 숫자만 남기고 나머지는 하이픈으로 대체 (연속된 하이픈 방지)
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'file';
        const filePath = `${timestamp}_${safeBaseName}${ext ? '.' + ext : ''}`;

        // 3. Supabase Storage에 업로드 (service_role 키가 있다면 사용하여 정책 우회)
        // Check if admin client is available
        const supabaseClient = (await import('./lib/supabase.js')).supabaseAdmin || (await import('./lib/supabase.js')).supabase;

        if (!supabaseClient) {
            throw new Error("Supabase client not initialized");
        }

        const { data, error: uploadError } = await supabaseClient.storage
            .from(bucket)
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true
            });

        if (uploadError) {
            console.error('[Upload API] Upload Error Detail:', JSON.stringify(uploadError, null, 2));
            throw uploadError;
        }

        // 4. 공개 URL 생성
        const { data: { publicUrl } } = supabaseClient.storage
            .from(bucket)
            .getPublicUrl(filePath);

        return res.status(200).json({ url: publicUrl, filePath: data.path });

    } catch (error: any) {
        console.error('[Upload API] Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error', details: error });
    }
}
