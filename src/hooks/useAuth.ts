import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { createClient, type User, type Session, type SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://amzlrrrhjsqjndbrdume.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtemxycnJoanNxam5kYnJkdW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTQ1NDIsImV4cCI6MjA4NTk5MDU0Mn0.UbmXG7RfWAQjNX9HTkCp50m_wwSFB4P40gfuqCA-f2c';

let fallbackClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (supabase) return supabase;
  if (!fallbackClient) {
    fallbackClient = createClient(FALLBACK_URL, FALLBACK_KEY, {
      auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
    });
  }
  return fallbackClient;
}

interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const client = getClient();

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    client.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const client = getClient();
    const { error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    const client = getClient();
    await client.auth.signOut();
  }, []);

  return { user, session, isLoading, signUp, signIn, signOut };
}
