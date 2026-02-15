# Eureka

Evidence-focused literature search app built with React + Vite + Supabase Edge Functions.

## Architecture (Feature-Based)

Frontend source is organized by app layer and feature ownership:

- `src/app`: global app wiring (providers + routes)
- `src/features`: user-facing feature modules
- `src/entities`: domain data hooks/models shared across features
- `src/shared`: reusable UI primitives, generic libs, types, shared hooks

Current route URLs are unchanged:

- `/`
- `/auth`
- `/app`
- `/reports`
- `/reports/:id`

See `docs/architecture.md` for ownership and cleanup conventions.

## Active Edge Functions

The active backend function surface is:

- `research-async`
- `chat-papers`
- `add-study`
- `synthesize-papers`
- `coci`
- `scihub-download`

Shared runtime logic remains in `supabase/functions/_shared/*`.

Base API path:

- `/functions/v1/research-async`

Supported endpoints:

- `POST /v1/lit/search`
- `GET /v1/lit/search/{search_id}`
- `GET /v1/lit/paper/{paper_id}`
- `GET /v1/lit/providers/health`

Legacy compatibility:

- `POST /functions/v1/research-async` with `{ "question": "..." }` returns `{ "report_id": "..." }`.

## Local Development

This repo uses `npm` as package manager of record.

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm test
npm run build
npm run lint
```
