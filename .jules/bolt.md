# Bolt's Journal - Critical Learnings

## 2025-05-14 - [Initial Entry]
**Learning:** Found that the research assistant's deduplication logic was potentially allowing duplicate papers from different sources (OpenAlex and Semantic Scholar) when one source lacked a DOI, leading to redundant LLM processing.
**Action:** Implement a more robust deduplication strategy using both DOI and title matching in parallel.

## 2025-05-22 - [React Table Optimization]
**Learning:** In a results table where rows can be expanded, every toggle was causing the entire table to re-render because the row logic was inline in the map function.
**Action:** Extract table row logic into a `React.memo` component and use `useCallback` for event handlers to achieve $O(1)$ re-render on row toggle instead of $O(N)$.
