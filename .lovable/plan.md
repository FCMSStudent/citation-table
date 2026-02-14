

# Fix "Backend not configured" Error

## Problem

The auto-generated Supabase client (`src/integrations/supabase/client.ts`) can be `null` when environment variables fail to load in the preview environment. The `useAuth` hook already handles this with a hardcoded fallback client, but six other files import `supabase` directly and break when it's `null`, showing "Backend not configured."

## Solution

Create a shared helper that mirrors the fallback pattern from `useAuth.ts`, then update all consuming files to use it instead of the raw `supabase` import.

### 1. Create `src/integrations/supabase/fallback.ts` (new file)

A small helper that re-exports a guaranteed non-null Supabase client:

```typescript
import { supabase } from './client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://amzlrrrhjsqjndbrdume.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIs...';

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
```

### 2. Update consuming files to use `getSupabase()`

Replace `if (!supabase) throw ...` patterns with a call to `getSupabase()`:

| File | Change |
|------|--------|
| `src/hooks/useResearch.ts` | Import `getSupabase`, use it instead of null-checking `supabase` |
| `src/hooks/useReport.ts` | Same pattern |
| `src/hooks/useReports.ts` | Same pattern |
| `src/hooks/usePaperChat.ts` | Same pattern |
| `src/hooks/useStudyPdfs.ts` | Same pattern |
| `src/components/NarrativeSynthesis.tsx` | Same pattern |
| `src/hooks/useAuth.ts` | Refactor to use shared `getSupabase()` instead of its own inline fallback |

### 3. No changes to auto-generated files

`client.ts` and `types.ts` remain untouched (as required).

## Files Changed

| File | Action |
|------|--------|
| `src/integrations/supabase/fallback.ts` | Create: shared fallback helper |
| `src/hooks/useResearch.ts` | Edit: use `getSupabase()` |
| `src/hooks/useReport.ts` | Edit: use `getSupabase()` |
| `src/hooks/useReports.ts` | Edit: use `getSupabase()` |
| `src/hooks/usePaperChat.ts` | Edit: use `getSupabase()` |
| `src/hooks/useStudyPdfs.ts` | Edit: use `getSupabase()` |
| `src/hooks/useAuth.ts` | Edit: use shared `getSupabase()`, remove inline fallback |
| `src/components/NarrativeSynthesis.tsx` | Edit: use `getSupabase()` |
