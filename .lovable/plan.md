

# Elicit-Style Narrative Synthesis

## Goal

Replace the current sectioned/badge-based synthesis with a flowing prose format that mirrors Elicit AI's output: a bold opening summary sentence followed by natural paragraphs with inline `(Author et al., Year)` citations.

## Current vs. Target

| Current | Target (Elicit-style) |
|---|---|
| JSON sections with heading + claims | Flowing markdown paragraphs |
| Citation badges (colored pills) | Inline text citations `(Author et al., Year)` |
| Confidence dots (Strong/Moderate/Limited) | No per-claim confidence indicators |
| Separate warnings panel | Keep warnings panel as-is |

## Changes

### 1. Backend Prompt (supabase/functions/synthesize-papers/index.ts)

Change the LLM prompt from requesting structured JSON sections to requesting a flowing narrative with inline citations:

- Output format changes from JSON `{sections, warnings}` to `{narrative, warnings}`
- `narrative` is a markdown string with a **bold opening summary** sentence, followed by 2-4 paragraphs with inline `(AuthorLastName et al., Year)` citations
- The prompt will instruct the model to:
  - Start with a bold summary sentence answering the research question
  - Use natural paragraph transitions ("However,", "Neuroimaging evidence shows...", etc.)
  - Cite every factual claim as `(AuthorLastName et al., Year)` using the study titles to derive author names
  - Keep the `warnings` array in JSON for the warnings panel
- The `responseMimeType` stays as `application/json` but the schema is simpler: `{narrative: string, warnings: [...]}`
- Confidence recalculation logic is removed (no longer per-claim)

### 2. Types (src/types/research.ts)

- Add a new `NarrativeSynthesisData` interface: `{ narrative: string; warnings: SynthesisWarning[] }`
- Keep existing types for backward compatibility with cached reports

### 3. Frontend Rendering (src/components/NarrativeSynthesis.tsx)

- Update `parseSynthesis` to detect both old format (`sections` array) and new format (`narrative` string)
- Add a new `ElicitStyleView` component that:
  - Renders the `narrative` markdown string using `ReactMarkdown`
  - Styles it with prose classes for readable flowing text
  - Keeps the existing header (Sparkles icon + "Research Synthesis" + Regenerate button)
- The old `StructuredSynthesisView` is kept as fallback for previously cached reports
- `WarningsPanel` remains unchanged

### Technical Details

**Prompt changes (key excerpt):**
```
Produce a JSON object: { "narrative": "...", "warnings": [...] }

The "narrative" field must be a single markdown string:
- Start with a **bold sentence** that directly answers the research question
- Follow with 2-4 paragraphs of flowing prose
- Cite EVERY factual claim inline as (AuthorLastName et al., Year)
- Use author last names derived from the study titles provided
- Use natural transitions between paragraphs
- Do NOT use headers, bullet points, or numbered lists
- Do NOT invent data not in the study context
```

**Files modified:**
- `supabase/functions/synthesize-papers/index.ts` -- updated prompt and simplified output parsing
- `src/types/research.ts` -- add `NarrativeSynthesisData` interface
- `src/components/NarrativeSynthesis.tsx` -- add `ElicitStyleView`, update `parseSynthesis`

