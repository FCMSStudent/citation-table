"""
FastAPI microservice for downloading academic papers via SciHub.
Provides endpoints for initiating downloads and checking task status.
"""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Lock
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.services.scihub_service import download_paper


# Initialize FastAPI app
app = FastAPI(
    title="Academic Paper Download Service",
    description="Lightweight microservice for downloading academic papers via SciHub",
    version="1.0.0"
)


# Task storage (in-memory, ephemeral)
# NOTE: This is not suitable for production. Use Celery + Redis for persistent task queue.
TASKS: Dict[str, Dict] = {}
TASK_LOCK = Lock()


# Thread pool for background downloads
executor = ThreadPoolExecutor(max_workers=4)


# Request/Response models
class DownloadRequest(BaseModel):
    """Request model for paper download."""
    keyword: str
    paper_type: str = "doi"
    

class DownloadResponse(BaseModel):
    """Response model for download initiation."""
    task_id: str
    status: str
    

class TaskStatus(BaseModel):
    """Response model for task status."""
    task_id: str
    status: str
    created_at: str
    completed_at: Optional[str] = None
    result: Optional[Dict] = None
    error: Optional[str] = None


def _update_task_status(task_id: str, status: str, **kwargs):
    """Thread-safe task status update."""
    with TASK_LOCK:
        TASKS[task_id].update({"status": status, **kwargs})


def _download_task(task_id: str, keyword: str, paper_type: str):
    """Background task for downloading a paper."""
    _update_task_status(task_id, "running")
    
    try:
        result = download_paper(keyword=keyword, paper_type=paper_type)
        _update_task_status(
            task_id,
            "success",
            result=result,
            completed_at=datetime.utcnow().isoformat()
        )
    except Exception as e:
        _update_task_status(
            task_id,
            "failed",
            error=str(e),
            completed_at=datetime.utcnow().isoformat()
        )


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "Academic Paper Download Service",
        "status": "healthy",
        "version": "1.0.0"
    }


@app.post("/api/download", response_model=DownloadResponse, status_code=202)
async def download_paper_endpoint(request: DownloadRequest):
    """
    Initiate a paper download task.
    
    Returns a task_id that can be used to check the download status.
    The download runs in the background and the PDF is saved to server/storage/.
    
    Args:
        request: DownloadRequest with keyword and paper_type
        
    Returns:
        DownloadResponse with task_id and initial status
    """
    # Generate unique task ID
    task_id = str(uuid.uuid4())
    
    # Initialize task record
    with TASK_LOCK:
        TASKS[task_id] = {
            "task_id": task_id,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "keyword": request.keyword,
            "paper_type": request.paper_type
        }
    
    # Submit download task to thread pool
    executor.submit(_download_task, task_id, request.keyword, request.paper_type)
    
    return DownloadResponse(task_id=task_id, status="pending")


@app.get("/api/status/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    """
    Get the status of a download task.
    
    Returns the current status, and if completed, the result (filepath and filename)
    or error message.
    
    Args:
        task_id: The task ID returned from the /api/download endpoint
        
    Returns:
        TaskStatus with current state of the task
        
    Raises:
        HTTPException: If task_id is not found
    """
    with TASK_LOCK:
        task = TASKS.get(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    return TaskStatus(**task)


@app.get("/api/tasks")
async def list_tasks():
    """
    List all tasks (for debugging/monitoring).
    
    Returns:
        Dict with all tasks
    """
    with TASK_LOCK:
        return {"tasks": list(TASKS.values())}
