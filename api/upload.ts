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

        // [DEBUG] 원본 정보 로그
        console.log(`[Upload API] Original: ${fileName}, base: ${baseName}, ext: ${ext}`);

        // 영문, 숫자만 남기고 나머지는 하이픈으로 대체 (연속된 하이픈 방지)
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'file';
        const filePath = `${timestamp}_${safeBaseName}${ext ? '.' + ext : ''}`;

        // [DEBUG] 생성된 경로 로그
        console.log(`[Upload API] Generated Key: ${filePath}`);
        // 3. Supabase Storage에 업로드 (service_role 키를 사용하므로 정책과 상관없이 업로드 가능)
        const { data, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true
            });

        if (uploadError) throw uploadError;

        // 4. 공개 URL 생성
        const { data: { publicUrl } } = supabase.storage
            .from(bucket)
            .getPublicUrl(filePath);

        return res.status(200).json({ url: publicUrl, filePath: data.path });

    } catch (error: any) {
        console.error('[Upload API] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
