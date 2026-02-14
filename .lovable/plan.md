

# Strictly Evidence-Grounded Narrative Synthesis

## Overview

Transform the narrative synthesis from free-form AI-generated markdown into a structured, citation-grounded summary where every claim links back to specific evidence table rows. No claim survives without a traceable citation.

## What Changes

### 1. Restructure the edge function output format

The `synthesize-papers` edge function currently outputs free-form markdown. It will be updated to return **structured JSON** with explicit citation links per claim.

New output schema:

```text
{
  "sections": [
    {
      "heading": "Areas of Agreement",
      "claims": [
        {
          "text": "Sleep deprivation was associated with impaired cognitive performance across multiple populations.",
          "citations": ["study-0", "study-3", "study-7"],
          "confidence": "high"   // high = 3+ studies, moderate = 2, low = 1
        }
      ]
    }
  ],
  "warnings": [
    { "type": "gap", "text": "No studies on long-term outcomes (>12 months) found" },
    { "type": "gap", "text": "No pediatric population studies identified" },
    { "type": "quality", "text": "3 of 8 studies are preprints without peer review" }
  ]
}
```

The LLM prompt will enforce:
- Every claim must reference specific `[Study N]` indices from the input
- No new information beyond what appears in the study data
- Claims that can't be tied to a study index are rejected
- Warnings are auto-generated for missing populations, designs, or outcome gaps

### 2. Rebuild the NarrativeSynthesis component

Replace the simple ReactMarkdown renderer with a structured view featuring:

**Citation badges:** Each claim renders inline clickable badges like `[Smith et al., 2023]` styled as small colored chips. The badges are built from the studies array using the study indices from the JSON.

**Confidence indicators:** Each claim gets a visual indicator:
- Green dot + "Strong" = 3 or more supporting studies
- Yellow dot + "Moderate" = 2 supporting studies  
- Gray dot + "Limited" = 1 supporting study

**Warnings panel:** A collapsible section at the bottom showing evidence gaps, quality concerns, and missing study types -- styled with amber/warning colors similar to the existing "Methodological Quality Notes" panel.

**Backward compatibility:** If the cached `narrative_synthesis` field contains plain text (old format), it falls back to rendering as markdown. New generations produce JSON.

### 3. No database changes needed

The `narrative_synthesis` column is already `text` type. The structured JSON will be stored as a JSON string in the same column. The component detects format by attempting `JSON.parse`.

## Technical Details

### Files modified

1. **`supabase/functions/synthesize-papers/index.ts`**
   - Rewrite the system prompt to require structured JSON output with explicit `[Study N]` citations per claim
   - Add `responseMimeType: "application/json"` to Gemini config to enforce JSON output
   - Parse and validate the AI response before caching
   - Auto-generate warnings by analyzing the study corpus (preprint ratio, missing designs, narrow populations)

2. **`src/components/NarrativeSynthesis.tsx`**
   - Add a `SynthesisData` TypeScript interface for the structured JSON
   - Detect format: try `JSON.parse`, fall back to markdown for old cached data
   - Render each section with heading, claims as prose paragraphs
   - Render citation tags as clickable `Badge` components styled with author name + year
   - Show confidence dot per claim
   - Add collapsible "Evidence Gaps and Warnings" panel at the bottom
   - Keep existing loading/error/generate states unchanged

3. **`src/types/research.ts`** (or inline in NarrativeSynthesis)
   - Add types: `SynthesisClaim`, `SynthesisSection`, `SynthesisWarning`, `SynthesisData`

### Edge function prompt strategy

The prompt will:
- Number each study as `[Study 0]`, `[Study 1]`, etc. (matching array indices)
- Instruct the LLM: "For each claim, list the study indices that support it. If a claim cannot be supported by any study, do not include it."
- Request JSON output with `sections[].claims[].citations` as arrays of study index strings
- Generate warnings by analyzing: missing study designs, population gaps, preprint ratio, small sample sizes

### Citation badge rendering

```text
Claim text ... [Smith et al., 2023] [Jones et al., 2022]
                ^^^^^^^^^^^^^^^^^    ^^^^^^^^^^^^^^^^^^
                clickable badges     clickable badges
```

Each badge, when clicked, could scroll to or highlight the corresponding row in the evidence table (future enhancement -- for now, a tooltip showing the study title and DOI).

### Confidence calculation

Done on the frontend based on `citations.length`:
- 3+ citations = "high" (green)
- 2 citations = "moderate" (yellow)
- 1 citation = "low" (gray)

This is deterministic, not LLM-generated, ensuring consistency.

### Warnings generation

Partially LLM-generated (evidence gaps) and partially computed in the edge function:
- **Computed:** Preprint ratio, absence of RCTs, absence of meta-analyses, all studies from single source
- **LLM-generated:** Specific evidence gaps ("No studies examined long-term outcomes")

