import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let instance: SupabaseClient | null = null;
export function supabase() {
  if (!instance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('尚未設定 Supabase 環境變數');
    instance = createClient(url, key, {auth: {persistSession: true, autoRefreshToken: true}});
  }
  return instance;
}
