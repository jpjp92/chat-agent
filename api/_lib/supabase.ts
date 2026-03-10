import { createClient } from '@supabase/supabase-js';

// dotenv is not compatible with Edge runtime and Vercel automatically injects env vars
// removing dotenv import and config

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
// Fallback: If SUPABASE_SERVICE_ROLE_KEY is not set, try to use SUPABASE_KEY (user might have put service key there)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('[Supabase Lib] Warning: SUPABASE_URL or SUPABASE_KEY is missing from process.env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
export const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;
