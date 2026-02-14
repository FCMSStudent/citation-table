
# Fix "Not Configured" Auth Error

## Problem
When attempting to sign up with email/password, the auth form shows "Not configured" because the Supabase client is `null`. The client becomes null when the Vite environment variables aren't loaded in the current preview session.

## Solution

### 1. Add fallback initialization in `useAuth.ts`
The `useResearch` hook already uses a hardcoded fallback URL pattern for resilience. Apply the same pattern in `useAuth.ts`: if the imported `supabase` client is null, create a local client using the known project URL and anon key as fallback values.

This ensures authentication always works regardless of env var loading issues.

### 2. Improve error messaging
Replace the generic "Not configured" string with a more user-friendly message like "Authentication service is temporarily unavailable. Please try again." so users never see a confusing technical message.

## Technical Details

### File: `src/hooks/useAuth.ts`
- Import `createClient` from `@supabase/supabase-js`
- At the top of the file, create a `getClient()` helper that returns the imported `supabase` client if available, or falls back to creating one with the hardcoded project URL (`https://amzlrrrhjsqjndbrdume.supabase.co`) and anon key
- Use `getClient()` instead of the raw `supabase` import throughout the hook
- Update the error messages in `signUp` and `signIn` from `'Not configured'` to a friendlier fallback message

### No other files need changes
The `client.ts` file is auto-generated and must not be edited. The Auth page component itself is fine -- it just displays whatever error string the hook returns.
