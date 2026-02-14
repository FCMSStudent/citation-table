# Bolt's Journal - Critical Learnings

## 2025-05-14 - [Initial Entry]
**Learning:** Found that the research assistant's deduplication logic was potentially allowing duplicate papers from different sources (OpenAlex and Semantic Scholar) when one source lacked a DOI, leading to redundant LLM processing.
**Action:** Implement a more robust deduplication strategy using both DOI and title matching in parallel.

## 2025-05-15 - [Regex Instantiation in Loops]
**Learning:** Found that defining complex Regular Expressions inside `.map()` or other high-frequency loops causes unnecessary object re-instantiation, which can impact performance when processing large datasets.
**Action:** Always define static Regular Expressions outside of loops or as module-level constants.

## 2026-02-12 - [Combined String Replacement & Keyword Caching]
**Learning:** Sequential .replace() calls on the same string can be optimized into a single pass using a mapping function. High-frequency keyword highlighting benefits significantly from caching the extracted keywords and the resulting RegExp pattern to avoid O(N) filtering and compilation on every render.
**Action:** Use a single regex with a mapping callback for multiple replacements. Cache search-related computations (regexes, Sets) keyed by the query string.

## 2026-02-13 - [Single-Pass Filtering & Memoized Outcome Processing]
**Learning:** React component performance suffers when multiple `useMemo` hooks perform sequential `filter`/`sort` passes over the same large dataset (O(N) * passes). Combining these into a single O(N) `.forEach` loop reduces overhead. Additionally, repeated string map/join operations on nested objects (e.g., outcomes) should be memoized using a `WeakMap` to avoid redundant O(M) processing per item.
**Action:** Merge sequential filter/category passes into a single `useMemo` block. Cache expensive nested property computations keyed by the item's object reference.

## 2026-02-14 - [Single-Pass Synthesis & Prop Type Safety]
**Learning:** Combining thematic grouping and finding extraction into a single pass in `SynthesisView` reduces complexity from O(Groups * Studies * Outcomes) to a cleaner O(Studies * Outcomes). Using type intersections (e.g., `StudyResult & { relevanceScore: number }`) instead of `any` casts ensures the compiler can verify performance-related property access.
**Action:** Always look for opportunities to combine multiple iterations over the same nested data structures in heavy `useMemo` blocks.
