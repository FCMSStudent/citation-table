# Bolt's Journal - Critical Learnings

## 2025-05-14 - [Initial Entry]
**Learning:** Found that the research assistant's deduplication logic was potentially allowing duplicate papers from different sources (OpenAlex and Semantic Scholar) when one source lacked a DOI, leading to redundant LLM processing.
**Action:** Implement a more robust deduplication strategy using both DOI and title matching in parallel.

## 2025-05-15 - [React Table Optimization]
**Learning:** Even with small result sets (N=15), frequent state updates in a parent component (like row expansion) cause the entire table body to re-render, which can be optimized by extracting and memoizing row components.
**Action:** Always extract row logic into memoized components in tables/lists where individual items have independent interactive states.
