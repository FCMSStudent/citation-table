# Eureka Architecture

## Folder Ownership

- `src/app`: global wiring only (providers, routes, app shell).
- `src/features`: feature-specific UI and logic.
- `src/entities`: domain-level data hooks/models used by multiple features.
- `src/shared`: reusable primitives and generic utilities.

## Placement Rules

- New UI should start feature-local under `src/features/<feature>/ui`.
- Promote to `src/shared/ui` only after real reuse across features.
- New hooks follow ownership:
  - feature-specific hooks in `src/features/<feature>/model`
  - cross-feature domain hooks in `src/entities/<entity>/model`
  - generic hooks in `src/shared/hooks`
- Generic helpers and exports belong in `src/shared/lib` and `src/shared/types`.

## Backend Function Set

Active Supabase functions:

- `research-async`
- `chat-papers`
- `add-study`
- `synthesize-papers`
- `coci`
- `scihub-download`

Legacy `research` function has been removed from active deployment config.

## Cleanup Guardrails

- Delete dead files only after import graph verification.
- Keep route URLs and edge function contracts stable during refactors.
- Prefer behavioral parity first; optimize architecture incrementally.
