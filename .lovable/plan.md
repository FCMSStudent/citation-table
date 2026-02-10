

# Fix: "Failed to send a request to the Edge Function"

## Root Cause

The app has two environment files with **conflicting** values:

| File | URL | Key |
|------|-----|-----|
| `.env` (correct) | `https://amzlrrrhjsqjndbrdume.supabase.co` | `eyJhbGci...` |
| `.env.local` (stale) | `https://mowfwnpebdfzcbxdrtcb.supabase.co` | `sb_publishable_7l6j...` |

Vite loads `.env.local` with **higher priority** than `.env`, so the app connects to the wrong backend -- one that does not have the `research` function deployed. That is why the request fails.

## Fix

**Delete the `.env.local` file.** That is the only change needed.

The auto-generated `.env` already has the correct values for this project's Lovable Cloud backend, where the edge function is deployed.

## What happens after the fix

- The app will use the correct backend URL
- The `research` edge function will be reachable
- Search queries will work as expected

