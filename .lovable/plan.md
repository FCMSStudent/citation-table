

# Fix: Edge Function Request Failing

## Problem

The app is sending requests to the **wrong backend** (`mowfwnpebdfzcbxdrtcb` instead of `amzlrrrhjsqjndbrdume`). This happens because `useResearch.ts` imports from a custom `src/lib/supabase.ts` file instead of the auto-generated client, causing credential mismatches.

## Fix (2 changes)

### 1. Update `useResearch.ts`
- Replace the import from `@/lib/supabase` with the standard `@/integrations/supabase/client`
- Use the `supabase` client and `supabaseConfigError` exports from the auto-generated client
- Fall back to direct fetch using `VITE_SUPABASE_URL` from `import.meta.env` when the client is null

### 2. Delete `src/lib/supabase.ts`
- This redundant custom client is the source of the wrong-URL issue
- All Supabase access should go through the auto-generated client

## Technical Details

In `useResearch.ts`, the key change:

```typescript
// Before (broken)
import { supabaseClient, isSupabaseConfigured, SUPABASE_URL } from '@/lib/supabase';

// After (fixed)
import { supabase } from '@/integrations/supabase/client';
```

The edge function itself is fine and deployed correctly -- the only issue is the frontend pointing to the wrong URL.

