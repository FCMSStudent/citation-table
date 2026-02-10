## 2025-05-14 - Actionable Search Examples

**Learning:** Example queries in a search interface should be actionable rather than just instructional. When a user clicks a "Try this" example, they expect the search to perform immediately. Populating the input without searching increases the interaction cost (requiring another click). Making these examples trigger the search directly creates a more fluid and "delightful" user experience.

**Action:** Ensure "Try this" example buttons in search-centric interfaces both populate the input and trigger the search action immediately.

## 2025-05-15 - Semantic Table Interactivity

**Learning:** When making table rows interactive (e.g., for expansion), avoid using `role="button"` on the `<tr>` element. Doing so overrides the semantic row role and can break standard table navigation for screen reader users. Instead, place a dedicated `<button>` within a cell (e.g., the first cell with the expansion icon) to handle the interaction. This maintains the table's structural integrity while providing accessible controls.

**Action:** Use nested `<button>` elements within `<td>` for row-level actions like expansion or deletion, ensuring they have appropriate ARIA labels and `aria-expanded` states.
