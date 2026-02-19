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

## 2026-02-14 - [Consolidated Data Pass & Pagination Reset]
**Learning:** Consolidating multiple `useMemo` hooks that perform sequential filter/map/sort operations into a single efficient pipeline (O(N) for filtering/scoring, O(N log N) for sorting) significantly reduces overhead for large datasets. Additionally, using `useMemo` to trigger state updates (like resetting pagination) is a React anti-pattern that triggers lint warnings; `useEffect` should be used for side-effect-driven state resets.
**Action:** Merge multiple data-processing passes into one. Use `useEffect` for side-effect-driven state resets.

## 2026-02-15 - [O(R*S) Render Loop Optimization]
**Learning:** Passing a global Set of state IDs to children in a large list causes O(R*S) complexity (Rows * Set size) if each row filters the Set in the render loop. Pre-calculating a lookup Map in the parent component reduces this to O(R+S). Additionally, memoizing simple derived props (URLs, formatted strings) in memoized components prevents unnecessary re-calculations when unrelated props (like expand state) change.
**Action:** Pre-calculate lookup Maps for row-specific state in the parent. Stabilize all derived props in list items with `useMemo`.
