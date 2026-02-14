

## Fix Build Errors and Keyword Extraction

### Issue 1: TypeScript Build Errors (lines 478, 511)
Two `catch (error)` blocks access `error.name` without type narrowing. Fix by casting to `(error as Error).name` or using `error instanceof Error` check.

### Issue 2: Keyword Extraction Too Aggressive
The keyword extractor reduces "vitamin D on depression" to "vitamin depression", dropping the critical "D". Single-letter tokens like "D" (as in Vitamin D) should be preserved. The fix: remove the minimum word-length filter or lower it to 1 character (currently likely filtering words shorter than 2-3 chars).

### Changes

**File: `supabase/functions/research/index.ts`**

1. **Line 478**: Change `error.name` to `(error as Error).name`
2. **Line 511**: Change `error.name` to `(error as Error).name`
3. **Keyword extractor**: Stop filtering out single-character words so "D" is preserved in queries like "vitamin D depression"

### Verification
- The edge function is confirmed working: Semantic Scholar (25), OpenAlex (25), arXiv (25) all return results
- After fix, arXiv/Semantic Scholar keyword query should be "vitamin D depression" instead of "vitamin depression"

