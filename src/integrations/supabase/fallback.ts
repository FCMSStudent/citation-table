import { supabase } from './client';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
}
