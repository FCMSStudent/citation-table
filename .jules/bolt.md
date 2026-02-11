# Bolt's Journal - Critical Learnings

## 2025-05-14 - [Initial Entry]
**Learning:** Found that the research assistant's deduplication logic was potentially allowing duplicate papers from different sources (OpenAlex and Semantic Scholar) when one source lacked a DOI, leading to redundant LLM processing.
**Action:** Implement a more robust deduplication strategy using both DOI and title matching in parallel.

## 2025-05-15 - [Regex Instantiation in Loops]
**Learning:** Found that defining complex Regular Expressions inside `.map()` or other high-frequency loops causes unnecessary object re-instantiation, which can impact performance when processing large datasets.
**Action:** Always define static Regular Expressions outside of loops or as module-level constants.
