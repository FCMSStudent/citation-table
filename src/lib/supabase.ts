/**
 * Supabase Configuration Module
 * 
 * This module provides optional Supabase integration.
 * Search functionality works WITHOUT Supabase - it only needs OpenAlex + Semantic Scholar.
 * Supabase is used for: authentication, search history, saved queries, and user preferences.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

// Support multiple common environment variable names
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';

const SUPABASE_KEY = 
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? 
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 
  '';

/**
 * Returns true if Supabase is properly configured with both URL and key
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * Supabase client instance - null if not configured
 * Features requiring Supabase should check for null and degrade gracefully
 */
export const supabaseClient: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Log configuration status for developers (not users)
if (import.meta.env.DEV) {
  if (isSupabaseConfigured) {
    console.info('[Supabase] ✓ Configured - auth/history/saving enabled');
  } else {
    console.info('[Supabase] ○ Not configured - search will work, but auth/history/saving disabled');
    console.info('[Supabase] To enable: Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');
  }
}
