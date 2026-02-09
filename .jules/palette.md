## 2025-05-14 - Actionable Search Examples

**Learning:** Example queries in a search interface should be actionable rather than just instructional. When a user clicks a "Try this" example, they expect the search to perform immediately. Populating the input without searching increases the interaction cost (requiring another click). Making these examples trigger the search directly creates a more fluid and "delightful" user experience.

**Action:** Ensure "Try this" example buttons in search-centric interfaces both populate the input and trigger the search action immediately.

## 2025-05-15 - Semantic Table Accessibility

**Learning:** When making tables interactive (sorting, expanding), ensure semantic HTML is preserved. Use a `<button>` inside `<th>` for sorting actions rather than making the `<th>` itself a button, as this preserves the `columnheader` role while providing a clear interactive target. For interactive rows, ensure `tabIndex={0}`, a proper focus indicator, and appropriate ARIA attributes (like `aria-expanded`).

**Action:** Use nested buttons for table header actions and ensure robust focus indicators (like outlines) for focusable rows.
