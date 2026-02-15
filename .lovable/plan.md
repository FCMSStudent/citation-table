

# Fix: `extractSearchKeywords(...).split is not a function`

## Root Cause

The `extractSearchKeywords` function was refactored to return an object `{ originalTerms: string[]; expandedTerms: string[] }` instead of a plain string. The `getQueryKeywordSet` function was updated to destructure this correctly in the source code, but the currently **deployed** edge function still has the old compiled code.

The error occurs at runtime in the `research-async` edge function when `getQueryKeywordSet` tries to call `.split()` on the object returned by `extractSearchKeywords`.

## Fix

Re-deploy the `research-async` edge function so the deployed code matches the current source (which already has the correct destructuring at line 732).

No code changes are needed -- the source is already correct. This is purely a deployment sync issue.

## Technical Details

Current correct code (line 731-736 of `research-async/index.ts`):
```typescript
function getQueryKeywordSet(query: string): Set<string> {
  const { originalTerms, expandedTerms } = extractSearchKeywords(query);
  const keywords = [...originalTerms, ...expandedTerms]
    .map(k => k.trim())
    .filter(Boolean);
  return new Set(keywords);
}
```

Action: Re-deploy `research-async` (and `research` for consistency).

