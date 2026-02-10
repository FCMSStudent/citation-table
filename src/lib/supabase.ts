/**
 * Supabase Configuration Module
 * 
 * This module provides Supabase integration for the Research Assistant.
 * 
 * ARCHITECTURE:
 * - The research API is a Supabase edge function, so VITE_SUPABASE_URL is REQUIRED
 * - VITE_SUPABASE_PUBLISHABLE_KEY is OPTIONAL and only needed for:
 *   - User authentication
 *   - Search history
 *   - Saved queries
 *   - User preferences
 * 
 * Search functionality works with just the URL - the edge function is publicly accessible.
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
    console.info('[Supabase] ✓ Fully configured - search + auth/history/saving enabled');
  } else if (SUPABASE_URL) {
    console.info('[Supabase] ◐ Partially configured - search enabled, auth/history/saving disabled');
    console.info('[Supabase] To enable auth features: Set VITE_SUPABASE_PUBLISHABLE_KEY');
  } else {
    console.info('[Supabase] ✗ Not configured - set VITE_SUPABASE_URL to enable search');
  }
}
