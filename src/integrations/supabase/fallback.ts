import { supabase } from './client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://amzlrrrhjsqjndbrdume.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtemxycnJoanNxam5kYnJkdW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTQ1NDIsImV4cCI6MjA4NTk5MDU0Mn0.UbmXG7RfWAQjNX9HTkCp50m_wwSFB4P40gfuqCA-f2c';

let fallbackClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  if (!fallbackClient) {
    fallbackClient = createClient(FALLBACK_URL, FALLBACK_KEY, {
      auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
    });
  }
  return fallbackClient;
}
