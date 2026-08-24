import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://hpphlfmtyxrulirpyejp.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_TiqESe0SQ_HMFZjFpz-DBA_wOgnVUj3';

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const configuredSupabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

export const isSupabaseConfigured = Boolean(
  configuredSupabaseUrl && configuredSupabaseKey && !configuredSupabaseUrl.includes('placeholder')
);

const supabaseUrl = configuredSupabaseUrl || DEFAULT_SUPABASE_URL;
const supabaseKey = configuredSupabaseKey || DEFAULT_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

export default supabase;
