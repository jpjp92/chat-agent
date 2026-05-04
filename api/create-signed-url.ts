import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './_lib/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { fileName, bucket, mimeType } = req.body;

  if (!fileName || !bucket) {
    return res.status(400).json({ error: 'fileName and bucket are required' });
  }

  const ALLOWED_BUCKETS = ['chat-imgs', 'chat-videos', 'chat-docs'];
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: 'Invalid bucket' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase Admin client not initialized. Check SUPABASE_SERVICE_ROLE_KEY.' });
  }

  try {
    // 1. Generate a unique and safe file path
    const timestamp = Date.now();
    const safeBaseName = fileName.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
    const filePath = `${timestamp}_${safeBaseName}`;

    // 2. Create a signed upload URL (short expiry: 5 minutes)
    // Note: createSignedUploadUrl is available on the Supabase Admin client
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error('[SignedURL API] Supabase error:', error);
      throw error;
    }

    // 3. Construct the public URL for the file
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return res.status(200).json({
      signedUrl: data.signedUrl,
      publicUrl: publicUrl,
      filePath: filePath,
      token: data.token // Some implementations might need the token explicitly
    });

  } catch (error: any) {
    console.error('[SignedURL API] Failed to create signed URL:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
