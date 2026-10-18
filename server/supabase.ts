import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Vercel 이 환경 변수를 주입하므로 dotenv 는 쓰지 않는다

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
// 폴백: SUPABASE_SERVICE_ROLE_KEY 가 없으면 SUPABASE_KEY 를 쓴다 (service 키를 거기 넣은 경우)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('[Supabase Lib] Warning: SUPABASE_URL or SUPABASE_KEY is missing from process.env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
export const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;
