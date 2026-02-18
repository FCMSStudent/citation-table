import { getSupabase } from "../supabase/fallback";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple", opts?: SignInOptions) => {
      const client = getSupabase();
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: opts?.redirect_uri,
          queryParams: {
            ...opts?.extraParams,
          },
        },
      });

      return { redirected: Boolean(data?.url), error: error ?? null };
    },
  },
};
