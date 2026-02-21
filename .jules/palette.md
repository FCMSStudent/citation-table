## 2025-05-14 - Actionable Search Examples

**Learning:** Example queries in a search interface should be actionable rather than just instructional. When a user clicks a "Try this" example, they expect the search to perform immediately. Populating the input without searching increases the interaction cost (requiring another click). Making these examples trigger the search directly creates a more fluid and "delightful" user experience.

**Action:** Ensure "Try this" example buttons in search-centric interfaces both populate the input and trigger the search action immediately.

## 2025-05-15 - Semantic Table Interactivity

**Learning:** When making table rows interactive (e.g., for expansion), avoid using `role="button"` on the `<tr>` element. Doing so overrides the semantic row role and can break standard table navigation for screen reader users. Instead, place a dedicated `<button>` within a cell (e.g., the first cell with the expansion icon) to handle the interaction. This maintains the table's structural integrity while providing accessible controls.

**Action:** Use nested `<button>` elements within `<td>` for row-level actions like expansion or deletion, ensuring they have appropriate ARIA labels and `aria-expanded` states.

## 2025-05-16 - Accessible Table Sorting and Selection

**Learning:** Table sorting headers should use `aria-sort` on the `<th>` element to communicate state, and the sorting button should have a dynamic `aria-label` that describes both the current state and the action of clicking (e.g., "Sort by Year (ascending). Click to sort descending"). For selection, always prefer semantic `Checkbox` components over custom icons to ensure proper roles and states are conveyed to assistive technologies.

**Action:** Implement `aria-sort` and descriptive labels in sortable headers; use `Checkbox` components for row selection with labels providing row context.

## 2025-05-17 - Portable Key Findings

**Learning:** Research-heavy applications benefit significantly from "portable" data. Users often need to move findings, summaries, or citations from the app into their own documents or communication tools. Providing a one-click "Copy to clipboard" button for key findings and AI-generated summaries, along with immediate visual feedback (e.g., toggling to a checkmark), reduces the interaction cost and enhances the app's utility as a tool in a broader research workflow.

**Action:** Implement "Copy to Clipboard" functionality for key results and summaries, providing state feedback and toast notifications for confirmation.
