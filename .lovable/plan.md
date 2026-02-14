

# Filter by Abstract and Surface PDF Icons

## Overview

Two changes: (1) exclude any paper that doesn't have a complete extracted abstract, and (2) show a PDF download icon prominently on study cards and table rows when a PDF is available.

## What Changes

### 1. Filter out papers without a full abstract

In `supabase/functions/research-async/index.ts`, after the LLM extraction and study design filter, add a second filter that removes any study where `abstract_excerpt` is empty, null, or too short (under 50 characters). This ensures only papers with meaningfully extracted abstracts appear in results.

Additionally, in the frontend (`src/components/ResultsTable.tsx`), add a client-side safety filter so that even cached/old reports exclude studies with missing abstracts.

### 2. Add PDF icon to study card headers

Currently the PDF download link only appears inside the expanded "Show details" section of `StudyCard`. Move/add a small PDF icon (using `FileText` or `Download` from lucide) into the card header area (next to the badges) so it's visible without expanding. The icon will:
- Show a green `FileText` icon linking to the PDF when status is `downloaded`
- Show a spinning loader when status is `pending`  
- Show nothing when status is `not_found` or `failed` (no clutter)

The `TableView` already shows PDF icons inline -- no changes needed there.

## Technical Details

### Files modified

1. **`supabase/functions/research-async/index.ts`**
   - After line 556 (the `allowedDesigns` filter), add a second filter:
     ```
     const withAbstract = filtered.filter((s: any) => 
       s.abstract_excerpt && s.abstract_excerpt.trim().length >= 50
     );
     console.log(`[LLM] Abstract filter: ${filtered.length} -> ${withAbstract.length}`);
     return withAbstract;
     ```

2. **`src/components/ResultsTable.tsx`**
   - Add a client-side filter early in the component (after `scoredResults`) to exclude studies with missing/empty `abstract_excerpt`, so old cached reports also benefit from this filter

3. **`src/components/StudyCard.tsx`**
   - In the card header area (around line 126, near the badge row), add a conditional PDF icon:
     - If `pdfData?.status === 'downloaded'` and `pdfData.public_url`: show a clickable green `FileText` icon linking to the PDF
     - If `pdfData?.status === 'pending'`: show a small spinning `Loader2`
     - Otherwise: show nothing
   - This makes PDF availability visible at a glance without expanding the card

### No database or schema changes needed

All filtering is done in the edge function and frontend code. The `abstract_excerpt` field already exists in the `StudyResult` type.
