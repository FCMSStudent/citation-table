

# Fix Truncated Research Synthesis

## Problem

The Research Synthesis section displays raw JSON text instead of a nicely formatted view. This happens because:

1. The Gemini API call in the `synthesize-papers` function has `maxOutputTokens: 3000`, which is too low for the structured JSON output. The response gets **truncated mid-JSON**, producing invalid JSON.
2. `parseSynthesis()` tries to parse the invalid JSON, fails silently, and falls through to the "Legacy" markdown fallback -- which just renders the broken JSON as plain text.
3. The `synthesize-papers` function also has a stale `auth.getClaims()` call (same bug previously fixed in `research-async`).

## Changes

### 1. Fix `supabase/functions/synthesize-papers/index.ts`

| What | Detail |
|------|--------|
| Increase token limit | Change `maxOutputTokens` from `3000` to `8000` to prevent truncation |
| Fix auth bug | Replace `auth.getClaims()` with `auth.getUser()` (same fix applied to `research-async`) |
| Add JSON validation | Before storing the synthesis, validate that `JSON.parse` succeeds and the result has `sections`. If the AI output is truncated/invalid, return an error instead of saving garbage |

### 2. Fix `src/components/NarrativeSynthesis.tsx`

| What | Detail |
|------|--------|
| Better fallback for invalid JSON | When `parseSynthesis` returns `null` but `rawSynthesis` starts with `{`, show an error state with a "Regenerate" button instead of dumping raw JSON as markdown |

### 3. Clear the bad cached synthesis

The current report has truncated JSON cached in the database. After deploying the fix, the user can click "Regenerate" to produce a valid synthesis.

## Files Changed

| File | Action |
|------|--------|
| `supabase/functions/synthesize-papers/index.ts` | Edit: increase token limit, fix auth, add validation |
| `src/components/NarrativeSynthesis.tsx` | Edit: handle invalid JSON gracefully in fallback |

