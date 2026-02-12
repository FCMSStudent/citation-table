# Research Paper Download Service

A lightweight Python FastAPI microservice that downloads academic papers using [SciDownl](https://github.com/Tishacy/SciDownl).

## ⚠️ Legal Notice

**IMPORTANT:** This service downloads papers from Sci-Hub, which may violate copyright laws in your jurisdiction. Sci-Hub operates in a legal gray area and is blocked in many countries. This code is provided for educational purposes only. Users are responsible for ensuring their use complies with applicable laws and regulations.

**Use at your own risk.** Always check if papers are available through legal channels first (institutional access, open access repositories, author's website, etc.).

## Features

- **Simple HTTP API** for paper downloads
- **Asynchronous task processing** with status endpoints
- **Support for multiple identifier types**: DOI, PubMed ID, arXiv ID
- **File storage management** with unique filenames
- **CORS enabled** for frontend integration

## Prerequisites

- Python 3.10 or higher
- pip (Python package manager)
- Git (for installing SciDownl from GitHub)

## Installation

### Local Development

1. **Navigate to the server directory**:
   ```bash
   cd server
   ```

2. **Create a virtual environment** (recommended):
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the server**:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

   The API will be available at http://localhost:8000

5. **Access the interactive API documentation**:
   - Swagger UI: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

### Docker Deployment

1. **Build the Docker image**:
   ```bash
   docker build -t paper-download-service .
   ```

2. **Run the container**:
   ```bash
   docker run -p 8000:8000 -v $(pwd)/storage:/app/storage paper-download-service
   ```

   The `-v` flag mounts the storage directory so downloaded PDFs persist outside the container.

## API Endpoints

### Health Check
```
GET /
```
Returns service status and version.

### Submit Download Request
```
POST /api/download
Content-Type: application/json

{
  "keyword": "10.1038/nature12373",
  "paper_type": "doi"
}
```

**Parameters:**
- `keyword` (string, required): Paper identifier (DOI, PubMed ID, or arXiv ID)
- `paper_type` (string, default: "doi"): Type of identifier. Options: "doi", "pmid", "arxiv"

**Response (202 Accepted):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### Check Task Status
```
GET /api/status/{task_id}
```

**Response:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "result": {
    "filepath": "/app/storage/10.1038_nature12373_1707711234_a1b2c3d4.pdf",
    "filename": "10.1038_nature12373_1707711234_a1b2c3d4.pdf",
    "original_keyword": "10.1038/nature12373",
    "paper_type": "doi"
  },
  "error": null
}
```

**Status values:**
- `pending`: Task queued but not started
- `processing`: Download in progress
- `completed`: Download successful, `result` contains file info
- `failed`: Download failed, `error` contains error message

### List All Tasks (Debug)
```
GET /api/tasks
```
Returns a list of all tasks and their statuses.

## Usage from Frontend

Here's an example of how to use the API from JavaScript:

```javascript
// Submit a download request
async function downloadPaper(doi) {
  const response = await fetch('http://localhost:8000/api/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keyword: doi,
      paper_type: 'doi'
    })
  });
  
  const data = await response.json();
  return data.task_id;
}

// Poll for task completion
async function waitForDownload(taskId) {
  while (true) {
    const response = await fetch(`http://localhost:8000/api/status/${taskId}`);
    const data = await response.json();
    
    if (data.status === 'completed') {
      console.log('Download complete:', data.result);
      return data.result;
    } else if (data.status === 'failed') {
      throw new Error(data.error);
    }
    
    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Usage
const taskId = await downloadPaper('10.1038/nature12373');
const result = await waitForDownload(taskId);
console.log('PDF downloaded to:', result.filepath);
```

## Architecture Notes

### In-Memory Task Storage

**Current Implementation:** This service uses an in-memory dictionary (`TASKS`) to track download tasks. This is simple and works well for development and small-scale use.

**Limitations:**
- All task data is lost on server restart
- Cannot scale horizontally (multiple server instances)
- Limited to single-server deployments

**Production Recommendations:**
For production use, replace the in-memory storage with a persistent task queue:
- **Celery + Redis**: Industry-standard distributed task queue
- **RQ (Redis Queue)**: Simpler alternative for smaller deployments
- **Database + polling**: Store task state in PostgreSQL/MongoDB

### Threading vs. Celery

**Current Implementation:** Uses Python's `ThreadPoolExecutor` to run blocking SciDownl calls in background threads.

**Why this works:**
- Simple to implement and understand
- No external dependencies (Redis, RabbitMQ)
- Sufficient for low-to-medium traffic

**When to upgrade:**
- Handling >100 concurrent downloads
- Need for task prioritization
- Require distributed processing
- Want retry logic and task chains

## Storage

Downloaded PDFs are stored in the `server/storage/` directory with unique filenames:
```
{sanitized_keyword}_{timestamp}_{hash}.pdf
```

The storage directory is:
- Created automatically on first run
- Excluded from Git (via `.gitignore`)
- Persisted via Docker volume in containerized deployments

## Development

### Running Tests

Currently, this service does not include unit tests. To add tests:

```bash
pip install pytest pytest-asyncio httpx
pytest
```

### Code Structure

```
server/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app and endpoints
│   └── services/
│       ├── __init__.py
│       └── scihub_service.py    # SciDownl wrapper
├── storage/                     # Downloaded PDFs (gitignored)
├── requirements.txt             # Python dependencies
├── Dockerfile                   # Container definition
├── .gitignore                   # Ignore __pycache__, .venv, storage
└── README.md                    # This file
```

## Next Steps

For production deployment, consider:

1. **Authentication & Authorization**: Add API keys or OAuth
2. **Rate Limiting**: Prevent abuse with request throttling
3. **Persistent Task Queue**: Migrate to Celery + Redis
4. **Database Integration**: Store download history and metadata
5. **File Cleanup**: Implement automatic deletion of old PDFs
6. **Monitoring**: Add logging to external service (Sentry, CloudWatch)
7. **HTTPS**: Use reverse proxy (nginx, Traefik) with SSL
8. **Resource Limits**: Set download timeouts and file size limits

## Troubleshooting

### "SciDownl library not available"
Ensure you've installed dependencies: `pip install -r requirements.txt`

### "No PDF file found after download"
The paper may not be available on Sci-Hub. Try:
- Verifying the DOI/PMID/arXiv ID is correct
- Checking if the paper exists on Sci-Hub directly
- Using a different identifier type

### Download hangs or times out
Sci-Hub may be slow or unreachable. The service doesn't currently implement timeouts.

### Storage directory permission errors
Ensure the server has write permissions to the `storage/` directory.

## License

This code is provided as-is for educational purposes. See the main repository LICENSE for details.
