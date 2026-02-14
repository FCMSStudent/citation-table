

## Chat with Papers

### Overview
Add a chat interface to the report detail page that lets you ask questions about the studies in your narrative review. The AI will answer grounded in the actual paper data (titles, abstracts, outcomes, citations).

### How It Works
When a report is completed, a "Chat with Papers" panel appears. You type a question (e.g., "Which studies found negative results?" or "What was the largest sample size?"), and the AI responds using only the study data from that report as context.

### Build Fixes First
The current build errors in `useStudyPdfs.ts` are caused by the `study_pdfs` table not existing in the database schema. This will be fixed by creating the missing table migration.

### Backend: New Edge Function `chat-papers`
- Receives: `report_id` + `messages` (conversation history)
- Fetches the report's results from the database
- Constructs a system prompt that includes all study data (titles, abstracts, outcomes, citations, study designs, sample sizes)
- Calls Lovable AI (google/gemini-3-flash-preview) with streaming
- Returns a streamed SSE response
- The system prompt enforces grounding: the AI must only reference data present in the studies and cite them properly

### Frontend Changes

1. **New component: `src/components/PaperChat.tsx`**
   - Chat panel with message list and input field
   - Streaming token-by-token rendering of AI responses
   - Markdown rendering for AI messages (using simple formatting)
   - Appears as a collapsible section or tab on the report detail page

2. **Update `src/pages/ReportDetail.tsx`**
   - Add a "Chat with Papers" tab/section below the results
   - Only visible when report status is `completed`

3. **New hook: `src/hooks/usePaperChat.ts`**
   - Manages conversation state (messages array)
   - Handles streaming from the `chat-papers` edge function
   - Handles loading states and errors

### Database Changes
- Create `study_pdfs` table migration (fixes build errors)
- No new tables needed for chat -- conversation is client-side only (no persistence needed)

### Technical Details

**System prompt strategy:** The edge function builds a context block containing each study's title, year, design, sample size, population, outcomes (with key results and citation snippets), and abstract excerpt. This is injected as a system message so the AI can answer questions grounded in the actual data.

**File changes:**
1. **Migration** -- Create `study_pdfs` table (fixes existing build errors)
2. **`supabase/functions/chat-papers/index.ts`** -- New streaming edge function using Lovable AI
3. **`src/components/PaperChat.tsx`** -- Chat UI component with streaming support
4. **`src/hooks/usePaperChat.ts`** -- Chat state and streaming logic
5. **Update `src/pages/ReportDetail.tsx`** -- Add chat section to completed reports
6. **Update `supabase/config.toml`** -- Register the new function

