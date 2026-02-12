# Research Assistant - Citation Table

A React + Vite research assistant that provides citation-grounded evidence extraction from scientific literature using OpenAlex and Semantic Scholar APIs.

## Features

- **Smart Literature Search**: Searches OpenAlex (25 papers) + Semantic Scholar (25 papers) in parallel
- **Crossref Enrichment**: Enriches papers with citation counts, verified DOIs, and journal metadata from Crossref API
- **AI-Powered Extraction**: Uses Google Gemini to extract structured study data from abstracts
- **Citation Grounding**: Every result is tied to specific papers with DOI/PubMed/OpenAlex IDs
- **Query Normalization**: Automatically converts evaluative language to neutral medical terms
- **Export Options**: Download results as RIS citations or narrative summaries
- **Paper Download Service**: Python microservice for downloading full-text papers by DOI/PMID/title
- **Optional Supabase Integration**: Auth, search history, and saved queries (when configured)
- **Paper Download Service**: Optional Python FastAPI microservice to download full-text PDFs using SciDownl

## Backend Service (Optional)

This repository includes an optional Python FastAPI microservice for downloading academic papers. The service uses [SciDownl](https://github.com/Tishacy/SciDownl) to fetch PDFs from Sci-Hub.

### ⚠️ Legal Warning

**IMPORTANT:** This service downloads papers from Sci-Hub, which may violate copyright laws in your jurisdiction. This is provided for educational purposes only. Always check legal alternatives first (institutional access, open access repositories, etc.). Use at your own risk.

### Quick Start (Backend Service)

1. **Navigate to server directory**:
   ```sh
   cd server
   ```

2. **Install Python dependencies**:
   ```sh
   pip install -r requirements.txt
   ```

3. **Run the service**:
   ```sh
   uvicorn app.main:app --reload --port 8000
   ```

The API will be available at http://localhost:8000 with interactive docs at http://localhost:8000/docs

### API Usage from Frontend

Here's how to integrate the download service into your frontend:

```javascript
// Submit a download request
async function downloadPaper(doi) {
  const response = await fetch('http://localhost:8000/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword: doi,
      paper_type: 'doi'
    })
  });
  const data = await response.json();
  return data.task_id;
}

// Check download status
async function checkStatus(taskId) {
  const response = await fetch(`http://localhost:8000/api/status/${taskId}`);
  return await response.json();
}

// Usage
const taskId = await downloadPaper('10.1038/nature12373');
// Poll checkStatus(taskId) until status is 'completed' or 'failed'
```

**Endpoints:**
- `POST /api/download` - Submit download request (returns task_id)
- `GET /api/status/{task_id}` - Check task status

**Docker deployment:**
```sh
cd server
docker build -t paper-download-service .
docker run -p 8000:8000 -v $(pwd)/storage:/app/storage paper-download-service
```

See [server/README.md](server/README.md) for full documentation.

## Crossref API Integration

The application enriches paper metadata using the [Crossref REST API](https://api.crossref.org) to provide additional citation data and DOI verification.

### What Crossref Provides

- **Citation Counts**: Number of times a paper has been cited (from `is-referenced-by-count`)
- **DOI Verification**: Validates and normalizes DOIs
- **Journal Metadata**: Retrieves journal/publisher information
- **Publication Years**: Enriches missing or incorrect publication dates

### How It Works

1. After fetching papers from OpenAlex and Semantic Scholar, the system queries Crossref
2. For papers with DOIs, queries `https://api.crossref.org/works/{DOI}`
3. For papers without DOIs, performs title-based search using `query.bibliographic`
4. Enriches citation counts, DOIs, years, and journal metadata
5. Rate limited to 100ms between requests (10 requests/second max)
6. Request timeout of 5 seconds per paper

### API Etiquette

The integration follows [Crossref's API etiquette guidelines](https://github.com/CrossRef/rest-api-doc#etiquette):
- Includes polite User-Agent header with project GitHub URL
- Implements rate limiting to avoid API abuse
- Handles errors gracefully (404, 429, timeouts) without breaking the search flow
- No API key required (Crossref is open access)

### UI Display

- **Citation Counts**: Displayed in study cards (📊 X citations) and source badges
- **DOI Links**: Clickable, sanitized links to `https://doi.org/{DOI}`
- **Error Handling**: Enrichment failures don't prevent results from being displayed

## Quick Start

### Frontend - Local Development Setup

1. **Clone and install dependencies**
   ```sh
   git clone <YOUR_GIT_URL>
   cd <YOUR_PROJECT_NAME>
   npm install
   ```

2. **Configure environment variables**
   
   The app requires your Supabase project URL to function (the backend research API is hosted as a Supabase edge function). The publishable key is optional and only needed for auth/history/saving features.
   
   ```sh
   # Copy the example file
   cp .env.example .env.local
   
   # Edit .env.local and add your Supabase URL (REQUIRED)
   # Get these from: https://supabase.com/dashboard (Project Settings > API)
   VITE_SUPABASE_URL=https://your-project.supabase.co
   
   # Optionally add the publishable key for auth/history/saving features
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-public-key
   ```

3. **Start development server**
   ```sh
   npm run dev
   ```
   
   The app will run at http://localhost:8080

### Paper Download Service - Local Development

The optional Python microservice allows downloading full-text papers by DOI, PMID, or title.

1. **Install Python dependencies**
   ```sh
   cd server
   pip install -r requirements.txt
   ```

2. **Run the service**
   ```sh
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   
   The service will run at http://localhost:8000
   - API documentation: http://localhost:8000/docs
   - Health check: http://localhost:8000/health

3. **Example API call from frontend**
   ```typescript
   // Request a paper download by DOI
   const response = await fetch('http://localhost:8000/api/download', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       keyword: '10.1145/3375633',
       paper_type: 'doi'
     })
   });
   
   const { task_id } = await response.json();
   
   // Poll for status
   const statusResponse = await fetch(`http://localhost:8000/api/status/${task_id}`);
   const status = await statusResponse.json();
   // status.status can be: 'pending', 'processing', 'completed', or 'failed'
   ```

4. **Or use Docker**
   ```sh
   cd server
   docker build -t paper-download-service .
   docker run -d -p 8000:8000 --name paper-service paper-download-service
   ```

See [server/README.md](server/README.md) for complete API documentation.

### What Works Without Supabase Publishable Key?

When you have the URL configured but not the publishable key:

✅ **Full search functionality** - OpenAlex + Semantic Scholar queries  
✅ **AI extraction** - Structured data extraction from papers  
✅ **Export features** - RIS citations and narrative summaries  
✅ **All UI features** - Filtering, sorting, viewing results

❌ **Authentication** - Requires publishable key  
❌ **Search history** - Requires publishable key  
❌ **Saved queries** - Requires publishable key

**Note:** VITE_SUPABASE_URL is required because the research API is a Supabase edge function.

**Without URL configured:** If you try to search without setting VITE_SUPABASE_URL, you'll see an error: "Cannot search: VITE_SUPABASE_URL is not set. Please configure your environment variables."

## Deployment

### Deploy to Vercel/Netlify/Other Hosting

1. **Push your code** to GitHub

2. **Connect your repository** to your hosting provider

3. **Set environment variables** in hosting provider dashboard:
   - `VITE_SUPABASE_URL` - Your Supabase project URL (**REQUIRED** for search)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` - Your Supabase anon/public key (optional, for auth/history/saving)

4. **Deploy** - The app will work immediately for search functionality

### Supabase Edge Function Setup

The project includes two edge functions that need to be deployed to Supabase:

#### Research Function

The `/research` edge function provides the main literature search functionality:

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Link your project: `supabase link --project-ref your-project-ref`
3. Deploy the research function: `supabase functions deploy research`
4. Set the `LOVABLE_API_KEY` secret in your Supabase project

#### COCI Citations Function (Optional)

The `/coci` edge function integrates with OpenCitations COCI API for citation data:

1. Deploy the coci function: `supabase functions deploy coci`
2. No additional secrets required - this function is publicly accessible
3. Test the endpoint:
   ```bash
   curl "${VITE_SUPABASE_URL}/functions/v1/coci?doi=10.1000/xyz123"
   ```

The COCI function:
- Accepts GET requests with `?doi=...` parameter or DOI in the path
- Returns normalized citation records from OpenCitations
- Provides a lightweight integration separate from the main research function
- Can be used via the `CociButton` component or `fetchCociForDoi()` helper in `src/lib/coci.ts`

## Project Structure

- **Frontend** (React + Vite + TypeScript)
  - `/src/pages/Index.tsx` - Main search page
  - `/src/hooks/useResearch.ts` - Search logic
  - `/src/components/` - UI components
  - `/src/lib/supabase.ts` - Optional Supabase configuration

- **Backend Services**
  - `/supabase/functions/research/` - Research API that calls OpenAlex + Semantic Scholar
  - `/server/` - Python microservice for downloading papers (FastAPI + SciDownl)
    - `/server/app/main.py` - FastAPI application with download endpoints
    - `/server/storage/` - Downloaded PDF storage (git-ignored)
    - `/server/Dockerfile` - Container configuration

- **Paper Download Service** (Optional Python FastAPI)
  - `/server/` - FastAPI microservice for downloading papers via SciDownl
  - `/server/app/main.py` - API endpoints
  - `/server/app/services/scihub_service.py` - SciDownl wrapper
  - See [server/README.md](server/README.md) for details

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
