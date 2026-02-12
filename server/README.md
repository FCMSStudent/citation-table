# Academic Paper Download Service

A lightweight Python FastAPI microservice that downloads academic papers using [SciDownl](https://github.com/Tishacy/SciDownl) (which interfaces with Sci-Hub).

## ⚠️ Legal Notice

This service uses SciDownl to interact with Sci-Hub. **Sci-Hub's legal status varies by jurisdiction.** Ensure compliance with your local laws and institutional policies before deploying or using this service in production.

## Features

- **Simple HTTP API** for downloading papers by DOI, PMID, or URL
- **Background task processing** using Python's ThreadPoolExecutor
- **In-memory task tracking** with status endpoints
- **Automatic file storage** in `server/storage/`
- **Docker support** for easy deployment

## Architecture Notes

### Task Tracking (Ephemeral)

This service uses an **in-memory dictionary** (`TASKS`) to track download tasks. This means:

- ✅ Simple, lightweight, no external dependencies
- ❌ Tasks are lost if the service restarts
- ❌ Not suitable for horizontal scaling (multiple instances)

**For production use**, consider:
- **Celery + Redis** for persistent, distributed task queuing
- **Database-backed task storage** for durability
- **Message queue** (RabbitMQ, AWS SQS) for scalability

### Background Processing

Downloads run in background threads via `ThreadPoolExecutor` (max 4 workers). This is adequate for light workloads but has limitations:

- Python's GIL limits CPU-bound parallelism
- For higher throughput, use async workers (Celery) or separate worker processes

## Setup & Run

### Option 1: Local Development (virtualenv)

1. **Create and activate virtual environment**
   ```bash
   cd server
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the service**
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   The service will be available at http://localhost:8000

4. **View API docs**
   - Swagger UI: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

### Option 2: Docker

1. **Build the Docker image**
   ```bash
   cd server
   docker build -t paper-download-service .
   ```

2. **Run the container**
   ```bash
   docker run -p 8000:8000 -v $(pwd)/storage:/app/storage paper-download-service
   ```

   The `-v` flag mounts the storage directory so downloaded files persist.

## API Usage

### 1. Initiate a download

**Endpoint:** `POST /api/download`

**Request body:**
```json
{
  "keyword": "10.1038/nature12373",
  "paper_type": "doi"
}
```

**Paper types:**
- `"doi"` - Digital Object Identifier (default)
- `"pmid"` - PubMed ID
- `"url"` - Direct paper URL

**Response (202 Accepted):**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending"
}
```

**Example with curl:**
```bash
curl -X POST http://localhost:8000/api/download \
  -H "Content-Type: application/json" \
  -d '{"keyword": "10.1038/nature12373", "paper_type": "doi"}'
```

### 2. Check task status

**Endpoint:** `GET /api/status/{task_id}`

**Response (while running):**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "created_at": "2024-01-15T10:30:00.123456",
  "completed_at": null,
  "result": null,
  "error": null
}
```

**Response (success):**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "created_at": "2024-01-15T10:30:00.123456",
  "completed_at": "2024-01-15T10:30:15.789012",
  "result": {
    "filepath": "/app/storage/paper_abc12345.pdf",
    "filename": "paper_abc12345.pdf"
  },
  "error": null
}
```

**Response (failed):**
```json
{
  "task_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "failed",
  "created_at": "2024-01-15T10:30:00.123456",
  "completed_at": "2024-01-15T10:30:10.123456",
  "result": null,
  "error": "Failed to download paper: connection timeout"
}
```

**Example with curl:**
```bash
curl http://localhost:8000/api/status/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### 3. List all tasks (debugging)

**Endpoint:** `GET /api/tasks`

Returns all tasks currently tracked in memory.

## TypeScript/JavaScript Frontend Integration

### Example: Fetch API

```typescript
// Initiate download
async function downloadPaper(doi: string): Promise<string> {
  const response = await fetch('http://localhost:8000/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: doi, paper_type: 'doi' })
  });
  
  if (!response.ok) {
    throw new Error('Failed to initiate download');
  }
  
  const data = await response.json();
  return data.task_id;
}

// Poll for status
async function checkStatus(taskId: string) {
  const response = await fetch(`http://localhost:8000/api/status/${taskId}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch status');
  }
  
  return await response.json();
}

// Usage example
const taskId = await downloadPaper('10.1038/nature12373');

// Poll every 2 seconds
const interval = setInterval(async () => {
  const status = await checkStatus(taskId);
  
  if (status.status === 'success') {
    clearInterval(interval);
    console.log('Downloaded:', status.result.filename);
  } else if (status.status === 'failed') {
    clearInterval(interval);
    console.error('Download failed:', status.error);
  }
}, 2000);
```

## File Storage

Downloaded PDFs are stored in `server/storage/` with unique filenames to prevent conflicts:

```
server/storage/
  paper_abc12345.pdf
  review_def67890.pdf
  ...
```

**Note:** The storage directory is gitignored and should be backed up separately.

## Security Considerations

- **No authentication** - This initial version has no auth. Add API keys or OAuth for production.
- **No rate limiting** - Consider adding rate limits to prevent abuse.
- **No input validation beyond type checking** - Validate DOIs/PMIDs more strictly in production.

## Troubleshooting

### "No PDF file found after download"

SciDownl/Sci-Hub may fail to download for various reasons:
- Invalid or non-existent DOI/PMID
- Sci-Hub servers unavailable
- Network issues or proxy problems

Check the error message in the task status for details.

### Storage directory permissions

Ensure the application has write permissions to `server/storage/`. The directory is created automatically if it doesn't exist.

## Development

Run tests (when implemented):
```bash
pytest
```

Format code:
```bash
black app/
```

Type checking:
```bash
mypy app/
```
