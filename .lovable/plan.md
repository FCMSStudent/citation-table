

# Add Temporary Guest Mode for End-to-End Testing

## Overview

Add a "Continue as Guest" button to the Auth page that signs in anonymously using Supabase anonymous sign-in. This lets you test the full search-to-report-detail flow without creating an account. The guest mode should be clearly marked as temporary/for testing.

## Changes

### 1. Edit `src/hooks/useAuth.ts` -- Add `signInAsGuest`

- Add a new `signInAsGuest` method that calls `client.auth.signInAnonymously()`
- Export it alongside the existing `signIn`, `signUp`, `signOut`

### 2. Edit `src/pages/Auth.tsx` -- Add "Continue as Guest" button

- Destructure `signInAsGuest` from `useAuth()`
- Add a "Continue as Guest" button below the sign-in form with a muted style and a small "(temporary testing)" label
- On click, call `signInAsGuest()` and navigate to `/app` on success

### 3. Edit `src/App.tsx` -- Allow anonymous users through ProtectedRoute

- No changes needed here -- the `ProtectedRoute` already checks `user` which will be set for anonymous users too

## Technical Details

**Guest sign-in handler in Auth.tsx:**
```typescript
const handleGuestSignIn = async () => {
  setError(null);
  setIsSubmitting(true);
  try {
    const { error } = await signInAsGuest();
    if (error) setError(error);
  } finally {
    setIsSubmitting(false);
  }
};
```

**New method in useAuth.ts:**
```typescript
const signInAsGuest = useCallback(async () => {
  const client = getSupabase();
  const { error } = await client.auth.signInAnonymously();
  return { error: error?.message ?? null };
}, []);
```

**UI placement:** A secondary/ghost button after the "Don't have an account?" text, with a divider and small disclaimer text.

## Files Changed

| File | Action |
|------|--------|
| `src/hooks/useAuth.ts` | Edit: add `signInAsGuest` method |
| `src/pages/Auth.tsx` | Edit: add guest sign-in button |

