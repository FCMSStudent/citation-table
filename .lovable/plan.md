

# Include Tables and Cards in the UI Primitive Extraction

## Overview

In addition to the previously planned primitives (PageHeader, IconBox, FeatureCard, PageShell, GradientText), this plan adds dedicated primitives for the repeated table and card patterns found across `PaperResultsTable`, `TableView`, `SynthesisView`, `StudyCard`, `ReportCard`, and `FilterBar`.

## Patterns Found

### Tables
Both `PaperResultsTable` and `TableView` share:
- Identical sort button markup (icon + label + arrow indicator)
- Identical selection toolbar (count + Compare/Export/Clear buttons)
- Same `thead` styling (`bg-muted/50`, `border-b p-2.5`)
- Same row hover/selection classes

### Cards
- `StudyCard` and the nested cards inside `SynthesisView` both render study title + citation + outcomes + external links with near-identical markup
- `ReportCard` uses a simpler card pattern (icon + title + badges + arrow)
- `FilterBar` is a self-contained bar but could benefit from a shared "toolbar card" wrapper

### Badges
- Direction badges (`DirectionBadge` in `TableView`) and score badges (`getScoreBadgeClass` in `StudyCard`) are reused across views
- Study design pills (`rounded-full bg-muted px-2 py-0.5 text-xs font-medium`) appear in 4+ places

## New Primitives to Create

### 1. `src/components/ui/data-table.tsx` -- Composable table shell

Wraps the repeated table chrome: overflow container, rounded border, muted header row, hover/selection row styles, and the sort button component.

```
Exports:
- DataTable: outer container (overflow-x-auto + rounded-lg border)
- DataTableHeader: styled thead
- DataTableRow: tr with hover + selection state
- SortButton: sort label + directional arrow icon
- SelectionToolbar: "{n} selected" bar with action slots
```

Replaces duplicated markup in `PaperResultsTable` and `TableView`.

### 2. `src/components/ui/study-meta.tsx` -- Study title + citation block

The "Paper" column cell appears identically in `PaperResultsTable`, `TableView`, and `SynthesisView`: title, author/year line, optional preprint badge, optional DOI link.

```
Props:
- title: string
- citation: string
- year: number
- preprintStatus?: string
- doi?: string
- className?: string
```

### 3. `src/components/ui/direction-badge.tsx` -- Effect direction indicator

Currently defined inline in `TableView` and as `EffectDirectionIcon` in `SynthesisView`. Consolidate into one shared component.

```
Props:
- direction: EffectDirection
- variant?: 'badge' | 'icon' (badge = pill with label, icon = just the arrow)
```

### 4. `src/components/ui/score-badge.tsx` -- Relevance score pill

The score badge with color-coded background (emerald/blue/amber) appears in `StudyCard` and could be used in table views too.

```
Props:
- score: number
- showTooltip?: boolean
```

### 5. `src/components/ui/pdf-link.tsx` -- PDF availability indicator

The PDF link/status logic (downloaded -> link, pending -> spinner, not_found -> icon) repeats across `PaperResultsTable`, `TableView`, `SynthesisView`, and `StudyCard`.

```
Props:
- pdfData?: StudyPdf
- links?: { label: string; url: string }[]
- compact?: boolean
```

## Files Changed

| File | Action |
|------|--------|
| `src/components/ui/data-table.tsx` | **New** -- Composable table primitives + SortButton + SelectionToolbar |
| `src/components/ui/study-meta.tsx` | **New** -- Study title/citation/year block |
| `src/components/ui/direction-badge.tsx` | **New** -- Consolidated effect direction badge/icon |
| `src/components/ui/score-badge.tsx` | **New** -- Relevance score pill |
| `src/components/ui/pdf-link.tsx` | **New** -- PDF availability indicator |
| `src/components/ui/page-header.tsx` | **New** -- Sticky header (from prior plan) |
| `src/components/ui/icon-box.tsx` | **New** -- Icon container (from prior plan) |
| `src/components/ui/feature-card.tsx` | **New** -- Feature card (from prior plan) |
| `src/components/ui/page-shell.tsx` | **New** -- Page layout shell (from prior plan) |
| `src/components/ui/gradient-text.tsx` | **New** -- Gradient text (from prior plan) |
| `src/components/PaperResultsTable.tsx` | Refactor to use DataTable, StudyMeta, PdfLink |
| `src/components/TableView.tsx` | Refactor to use DataTable, StudyMeta, DirectionBadge |
| `src/components/SynthesisView.tsx` | Refactor to use StudyMeta, DirectionBadge, PdfLink |
| `src/components/StudyCard.tsx` | Refactor to use StudyMeta, ScoreBadge, DirectionBadge, PdfLink |
| `src/components/ReportCard.tsx` | Minor -- use IconBox for status icons |
| `src/components/FilterBar.tsx` | No change needed (already clean) |
| `src/pages/Index.tsx` | Refactor to use PageShell, PageHeader |
| `src/pages/Reports.tsx` | Refactor to use PageShell, PageHeader |
| `src/pages/Landing.tsx` | Refactor to use PageShell, FeatureCard, IconBox |
| `src/pages/Auth.tsx` | Refactor to use PageShell |
| `src/components/EmptyState.tsx` | Refactor to use IconBox, FeatureCard |

## Approach

1. Create all 10 new UI primitive files
2. Refactor table components (`PaperResultsTable`, `TableView`) to use `DataTable`, `StudyMeta`, `DirectionBadge`, `PdfLink`
3. Refactor card components (`StudyCard`, `SynthesisView`) to use `StudyMeta`, `DirectionBadge`, `ScoreBadge`, `PdfLink`
4. Refactor page-level components to use `PageShell`, `PageHeader`, `IconBox`, `FeatureCard`
5. Verify no visual regressions -- output should look identical before and after

This sets the foundation so the visual revamp (gradients, animations, hover effects) can be applied once per primitive rather than in 10+ files.

