

## Results View Improvements -- All Issues

### Overview
Fix all identified issues in the results view: the broken SynthesisView section, non-functional TableView buttons, missing PDF indicators in Table/Synthesis views, unintegrated COCI button, limited filter options, hardcoded label, and lack of pagination.

---

### 1. Fix Broken SynthesisView Methodological Quality Note

The block at lines 238-249 renders nothing due to an empty conditional. Fix it to actually render the quality notes using the existing `getQualityNotes()` helper function that's already defined but never called.

**Result:** An info box at the bottom of the Synthesis view showing notes like "3 studies use experimental design with randomization" or "All studies are preprints."

---

### 2. Make TableView "Compare" and "Export Selected" Buttons Functional

- **Export Selected**: Calls the existing `downloadCSV()` utility but only for the selected studies. Pass an `onExportSelected` callback from `ResultsTable` into `TableView`.
- **Compare**: Opens a side-by-side comparison dialog/panel showing the selected studies in columns with their key attributes (design, sample size, outcomes). Uses a Dialog component.

**Props change:** `TableView` will accept `onExportSelected(studies)` and `onCompare(studies)` callbacks.

---

### 3. Add PDF Status to TableView and SynthesisView

- Pass `pdfsByDoi` from `ResultsTable` down to `TableView` and `SynthesisView`.
- **TableView:** Add a small icon in the Links column -- a download icon if available, spinner if pending, or dash if not found.
- **SynthesisView:** Add a small PDF link/icon next to each study's citation in the expanded group view.

---

### 4. Integrate COCI Citations Button into StudyCard

Add the existing `CociButton` component into the expanded details section of `StudyCard`, shown when the study has a DOI. It appears below the existing external links.

---

### 5. Expand FilterBar Options

- Add `rct`, `cohort`, and `cross-sectional` to the study design filter dropdown.
- Update the filter logic in `ResultsTable` to match these new values against `study_design`.
- Rename "Explicit cognitive outcome only" to "Explicit outcome only" (remove the hardcoded "cognitive" reference).

---

### 6. Add Pagination

Add client-side pagination (25 studies per page) to all three view modes (cards, table, synthesis). A simple "Showing X-Y of Z" bar with Previous/Next buttons at the bottom of the results.

---

### Technical Details

**Files to modify:**

1. **`src/components/SynthesisView.tsx`** -- Fix lines 238-249 to render quality notes; accept and display `pdfsByDoi` prop
2. **`src/components/TableView.tsx`** -- Wire up Compare/Export Selected buttons; accept `pdfsByDoi`, `onExportSelected`, `onCompare` props; add PDF status column
3. **`src/components/StudyCard.tsx`** -- Add `CociButton` in expanded details
4. **`src/components/FilterBar.tsx`** -- Add RCT/cohort/cross-sectional options; rename toggle label
5. **`src/components/ResultsTable.tsx`** -- Pass new props to TableView/SynthesisView; add pagination state and controls; add compare dialog; update filter logic for new design values

**New file:**
6. **`src/components/CompareDialog.tsx`** -- Side-by-side comparison dialog for selected studies

