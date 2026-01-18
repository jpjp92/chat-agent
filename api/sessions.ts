import { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './lib/supabase.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { method } = req;
    const { user_id, session_id } = req.query;

    try {
        if (method === 'GET') {
            if (session_id) {
                // 특정 세션의 메시지 목록 가져오기
                const { data: messages, error } = await supabase
                    .from('chat_messages')
                    .select('*')
                    .eq('session_id', session_id)
                    .order('created_at', { ascending: true });

                if (error) throw error;
                return res.status(200).json({ messages });
            } else if (user_id) {
                // 사용자의 세션 목록 가져오기
                const { data: sessions, error } = await supabase
                    .from('chat_sessions')
                    .select('*')
                    .eq('user_id', user_id)
                    .order('updated_at', { ascending: false });

                if (error) throw error;
                return res.status(200).json({ sessions });
            }
        }

        if (method === 'POST') {
            const { user_id, title } = req.body;
            const { data: session, error } = await supabase
                .from('chat_sessions')
                .insert({ user_id, title: title || 'New Chat' })
                .select()
                .single();

            if (error) throw error;
            return res.status(200).json({ session });
        }

        if (method === 'DELETE') {
            const { session_id } = req.body;
            const { error } = await supabase
                .from('chat_sessions')
                .delete()
                .eq('id', session_id);

            if (error) throw error;
            return res.status(200).json({ success: true });
        }

        if (method === 'PATCH') {
            const { session_id, title } = req.body;
            if (!session_id || !title) {
                return res.status(400).json({ error: 'session_id and title are required' });
            }

            const { data: session, error } = await supabase
                .from('chat_sessions')
                .update({ title, updated_at: new Date().toISOString() })
                .eq('id', session_id)
                .select()
                .single();

            if (error) throw error;
            return res.status(200).json({ session });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error: any) {
        console.error('[Sessions API] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }
}
