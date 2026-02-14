

# Security and Consistency Pass: Auth for chat-papers and synthesize-papers

## Overview

Both `chat-papers` and `synthesize-papers` edge functions currently use the service role client without validating the user's identity. The frontend calls them with the anon key as a bearer token instead of the user's session token. This means any request with the anon key can access any report's data -- a serious authorization bypass.

This plan adds the same auth pattern used in `research-async` (getClaims validation + ownership check) and updates the frontend to use `supabase.functions.invoke` which automatically sends the user's access token. It also upgrades `chat-papers` to use the top-10 complete study filter and enforce citations.

## Changes

### 1. `supabase/functions/chat-papers/index.ts` -- Full security + context upgrade

**Auth (insert after rate limit, before parsing body):**
- Extract `Authorization` header, reject if missing
- Create an anon client with the user's token
- Call `anonClient.auth.getClaims(token)` to validate and extract `userId`
- After fetching the report (still via service role for reliability), verify `report.user_id === userId`
- Return 401/404 as appropriate

**Remove duplicate variable declarations** (lines 55-57 re-declare `supabaseUrl`/`supabaseKey`/`supabase` -- already declared on lines 33-35). Reuse `rlSupabase` for the report fetch, and add a separate user-context client for auth.

**Context: top-10 complete studies (same as synthesize-papers):**
- Add `isCompleteStudy()` and `scoreStudy()` functions (same implementations as in `synthesize-papers`)
- Filter `report.results` through `isCompleteStudy()`, rank by `scoreStudy()`, take top 10
- Build `studyContext` from only those 10 studies

**System prompt: enforce citations:**
- Update the system prompt to explicitly require `(Title, Year)` format for every factual claim
- Add rule: "If you cannot cite a specific study for a claim, do not make that claim."
- Update the study count reference to reflect filtered count

### 2. `supabase/functions/synthesize-papers/index.ts` -- Add auth

**Auth (insert after rate limit, before parsing body):**
- Same pattern: extract Authorization header, create anon client, validate via `getClaims()`, extract `userId`
- After fetching the report, verify `report.user_id === userId` (add `user_id` to the select query)
- Return 401 if token invalid, 404 if report not found or not owned by user

**No other changes** -- the top-10 filter and synthesis logic are already correct.

### 3. `src/hooks/usePaperChat.ts` -- Use supabase client

Replace the raw `fetch` with `supabase` from `@/integrations/supabase/client`:

- Import `supabase` from the client
- Get the user's session via `supabase.auth.getSession()` to obtain `access_token`
- Replace `fetch(CHAT_URL, ...)` with a `fetch` using `Authorization: Bearer ${accessToken}` (not the anon key)
- Alternatively, since this uses streaming (SSE), we cannot use `supabase.functions.invoke` (it doesn't support streaming). Keep `fetch` but swap the bearer token from the publishable key to the user's `access_token`
- Remove the `VITE_SUPABASE_PUBLISHABLE_KEY` usage
- If no active session, set error "Please sign in to chat"

### 4. `src/components/NarrativeSynthesis.tsx` -- Use supabase.functions.invoke

Replace the raw `fetch` call in the `generate` function:

- Import `supabase` from `@/integrations/supabase/client`
- Replace `fetch(...)` with `supabase.functions.invoke('synthesize-papers', { body: { report_id: reportId } })`
- This automatically includes the user's access token
- Remove hardcoded URL and anon key fallback
- Handle errors from the invoke response

## Technical Details

### Auth pattern (matching research-async exactly):

```typescript
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return new Response(
    JSON.stringify({ error: "Authentication required" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
  global: { headers: { Authorization: authHeader } },
});
const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
  authHeader.replace("Bearer ", "")
);
if (claimsError || !claimsData?.claims?.sub) {
  return new Response(
    JSON.stringify({ error: "Invalid or expired token" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
const userId = claimsData.claims.sub as string;
```

### Ownership check (after fetching report):

```typescript
// Add user_id to select
.select("question, results, normalized_query, user_id")

// After fetch
if (!report || report.user_id !== userId) {
  return new Response(
    JSON.stringify({ error: "Report not found" }),
    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

### Streaming chat auth (usePaperChat):

```typescript
const { data: { session } } = await supabase.auth.getSession();
if (!session?.access_token) {
  setError('Please sign in to use chat');
  return;
}
// Use session.access_token as Bearer token in fetch
```

## Files Changed

| File | Action |
|------|--------|
| `supabase/functions/chat-papers/index.ts` | Edit: add auth, ownership check, top-10 filter, citation enforcement |
| `supabase/functions/synthesize-papers/index.ts` | Edit: add auth, ownership check |
| `src/hooks/usePaperChat.ts` | Edit: use session access_token instead of publishable key |
| `src/components/NarrativeSynthesis.tsx` | Edit: use `supabase.functions.invoke` |

