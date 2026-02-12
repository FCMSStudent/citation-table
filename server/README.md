# Research Paper Download Service

A lightweight Python FastAPI microservice for downloading research papers using SciDownl.

## Features

- **Simple HTTP API**: POST to request downloads, GET to check status
- **Background Processing**: Downloads run in background threads with 202 Accepted response
- **Multiple Input Types**: Support for DOI, PMID, or paper title
- **Status Polling**: Check download progress via task ID
- **Containerized**: Docker support for easy deployment

## Quick Start

### Local Development (Python)

1. **Install dependencies**:
   ```bash
   cd server
   pip install -r requirements.txt
   ```

2. **Run the service**:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **Access the API**:
   - API docs: http://localhost:8000/docs
   - Health check: http://localhost:8000/health

### Docker Deployment

1. **Build the image**:
   ```bash
   cd server
   docker build -t paper-download-service .
   ```

2. **Run the container**:
   ```bash
   docker run -d -p 8000:8000 --name paper-service paper-download-service
   ```

3. **Stop the container**:
   ```bash
   docker stop paper-service
   docker rm paper-service
   ```

## API Endpoints

### POST /api/download

Request a paper download by DOI, PMID, or title.

**Request Body**:
```json
{
  "keyword": "10.1145/3375633",
  "paper_type": "doi"
}
```

**Response** (202 Accepted):
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Download task created. Poll /api/status/{task_id} for updates."
}
```

**Valid paper_type values**: `"doi"`, `"pmid"`, `"title"`

### GET /api/status/{task_id}

Check the status of a download task.

**Response** (task pending):
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "created_at": "2026-02-12T03:30:00.000000"
}
```

**Response** (task completed):
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "created_at": "2026-02-12T03:30:00.000000",
  "completed_at": "2026-02-12T03:30:15.000000",
  "filename": "paper.pdf",
  "filepath": "storage/paper.pdf"
}
```

**Response** (task failed):
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "created_at": "2026-02-12T03:30:00.000000",
  "completed_at": "2026-02-12T03:30:10.000000",
  "error": "Paper not found or not available"
}
```

**Status values**: `"pending"`, `"processing"`, `"completed"`, `"failed"`

### GET /health

Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "storage_dir": "/app/storage",
  "active_tasks": 0
}
```

### GET /api/tasks

List all tasks (for debugging/monitoring).

**Response**:
```json
{
  "total": 5,
  "tasks": [...]
}
```

## Example Usage from Frontend

### JavaScript/TypeScript Example

```typescript
// Request a paper download
async function downloadPaper(doi: string) {
  const response = await fetch('http://localhost:8000/api/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keyword: doi,
      paper_type: 'doi',
    }),
  });
  
  const data = await response.json();
  const taskId = data.task_id;
  
  // Poll for status
  return pollTaskStatus(taskId);
}

async function pollTaskStatus(taskId: string): Promise<any> {
  while (true) {
    const response = await fetch(`http://localhost:8000/api/status/${taskId}`);
    const status = await response.json();
    
    if (status.status === 'completed') {
      return status; // { filename, filepath }
    } else if (status.status === 'failed') {
      throw new Error(status.error);
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Usage
downloadPaper('10.1145/3375633')
  .then(result => console.log('Downloaded:', result.filename))
  .catch(error => console.error('Download failed:', error));
```

### cURL Examples

```bash
# Request a download by DOI
curl -X POST http://localhost:8000/api/download \
  -H "Content-Type: application/json" \
  -d '{"keyword": "10.1145/3375633", "paper_type": "doi"}'

# Check task status
curl http://localhost:8000/api/status/550e8400-e29b-41d4-a716-446655440000

# Health check
curl http://localhost:8000/health
```

## Storage

Downloaded PDFs are stored in the `server/storage/` directory. This directory is:
- Created automatically on startup
- Excluded from git via `.gitignore`
- Persistent in Docker via volumes (if configured)

## Production Considerations

For production deployments, consider:

1. **Persistence**: Use Redis or a database instead of in-memory task storage
2. **CORS**: Configure specific allowed origins instead of `"*"`
3. **Rate Limiting**: Add rate limiting to prevent abuse
4. **File Management**: Implement cleanup for old downloaded files
5. **Authentication**: Add API keys or OAuth for access control
6. **Monitoring**: Add logging and metrics collection
7. **Scalability**: Use Celery + Redis for distributed task processing

## Dependencies

- **FastAPI**: Modern web framework for building APIs
- **Uvicorn**: ASGI server for running FastAPI
- **SciDownl**: Paper download library (from GitHub)
- **python-multipart**: For handling file uploads (future use)

## License

This service is part of the citation-table project.
