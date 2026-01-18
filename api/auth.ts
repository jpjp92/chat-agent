import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { method } = req;

    try {
        if (method === 'POST') {
            const { nickname } = req.body;
            console.log('[Auth API] Received nickname:', nickname);
            if (!nickname) {
                return res.status(400).json({ error: 'Nickname is required' });
            }

            // 1. 기존 사용자 조회
            const { data: existingUser, error: findError } = await supabase
                .from('users')
                .select('id, nickname, display_name, avatar_url') // Select specific fields
                .eq('nickname', nickname)
                .maybeSingle();

            if (findError) throw findError;

            if (existingUser) {
                return res.status(200).json({ user: existingUser, isNew: false });
            }

            // 2. 새 사용자 생성
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({ nickname, display_name: nickname }) // 초기 이름은 닉네임으로 설정
                .select('id, nickname, display_name, avatar_url') // Select specific fields
                .single();

            if (insertError) throw insertError;

            return res.status(200).json({ user: newUser, isNew: true });
        }

        if (method === 'PATCH') {
            const { id, display_name, avatar_url } = req.body;
            if (!id) return res.status(400).json({ error: 'User ID is required' });

            const updatePayload: { display_name?: string; avatar_url?: string } = {};
            if (display_name !== undefined) updatePayload.display_name = display_name;
            if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;

            if (Object.keys(updatePayload).length === 0) {
                return res.status(400).json({ error: 'No update data provided' });
            }

            const { data: updatedUser, error } = await supabase
                .from('users')
                .update(updatePayload)
                .eq('id', id)
                .select('id, nickname, display_name, avatar_url') // Select specific fields
                .single();

            if (error) throw error;
            return res.status(200).json({ user: updatedUser });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error: any) {
        console.error('[Auth API] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
