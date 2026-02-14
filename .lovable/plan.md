

# Add Public Landing Page and Move Search to /app

## Overview
Create a public landing page at `/`, move the authenticated search experience to `/app`, and update all internal navigation links accordingly.

## Changes

### 1. Create `src/pages/Landing.tsx` (new file)
A public marketing/landing page that introduces the Research Assistant and directs visitors to sign in or sign up. It will include:
- Hero section with app name, tagline, and description
- Call-to-action buttons: "Get Started" (links to `/auth`) and "Sign In" (links to `/auth`)
- Brief feature highlights (evidence extraction, citation-grounded, etc.)
- No authentication required to view

### 2. Update `src/App.tsx`
- Import the new `Landing` component
- Change route `/` to render `<Landing />` (public, no ProtectedRoute)
- Add route `/app` wrapped in `<ProtectedRoute>` rendering `<Index />`
- Keep `/reports` and `/reports/:id` protected as-is

### 3. Update `src/pages/Auth.tsx`
- Change `<Navigate to="/" replace />` to `<Navigate to="/app" replace />` so signed-in users land on the search page

### 4. Update `src/pages/Reports.tsx`
- Line 29: Change `<Link to="/">` to `<Link to="/app">` (New Search link in header)
- Line 61: Change `<Link to="/">` to `<Link to="/app">` (Start a search link in empty state)

### 5. Update `src/pages/ReportDetail.tsx`
- Line 37: Change `<Link to="/">` to `<Link to="/app">` (New Search link in header)

### 6. Update `src/pages/Index.tsx`
- No changes needed (it already works as a standalone page; routing handles protection)

## Flow After Changes

```text
/ (Landing, public) --> /auth (sign in/up) --> /app (search, protected) --> /reports/:id (protected)
```

