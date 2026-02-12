"""
FastAPI microservice for downloading academic papers using SciDownl.

This service provides endpoints to:
- POST /api/download: Submit a paper download request (returns task_id)
- GET /api/status/{task_id}: Check the status of a download task

Note: This implementation uses an in-memory TASKS dictionary for task tracking.
This is ephemeral and will be lost on server restart. For production use,
replace with a persistent task queue like Celery + Redis.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, Optional, Literal
import uuid
from concurrent.futures import ThreadPoolExecutor
import logging

from app.services.scihub_service import download_paper

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Research Paper Download Service",
    description="Microservice for downloading academic papers using SciDownl",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory task storage
# WARNING: This is ephemeral and will be lost on restart.
# For production, use a persistent task queue (Celery + Redis).
TASKS: Dict[str, dict] = {}

# Thread pool for background tasks
# For heavy use, switch to Celery/Redis for better scalability
executor = ThreadPoolExecutor(max_workers=4)


class DownloadRequest(BaseModel):
    """Request model for paper download."""
    keyword: str = Field(..., description="DOI, PubMed ID, or arXiv ID")
    paper_type: Literal["doi", "pmid", "arxiv"] = Field(
        default="doi",
        description="Type of paper identifier"
    )


class DownloadResponse(BaseModel):
    """Response model for download request."""
    task_id: str
    status: str


class TaskStatus(BaseModel):
    """Response model for task status."""
    task_id: str
    status: Literal["pending", "processing", "completed", "failed"]
    result: Optional[Dict] = None
    error: Optional[str] = None


def process_download(task_id: str, keyword: str, paper_type: str):
    """
    Background task to download a paper.
    
    Args:
        task_id: Unique task identifier
        keyword: Paper identifier (DOI, PMID, arXiv ID)
        paper_type: Type of identifier
    """
    try:
        logger.info(f"Starting download for task {task_id}: {keyword} ({paper_type})")
        TASKS[task_id]["status"] = "processing"
        
        # Call the scihub service
        result = download_paper(keyword, paper_type)
        
        TASKS[task_id]["status"] = "completed"
        TASKS[task_id]["result"] = result
        logger.info(f"Completed download for task {task_id}")
        
    except Exception as e:
        logger.error(f"Failed download for task {task_id}: {str(e)}")
        TASKS[task_id]["status"] = "failed"
        TASKS[task_id]["error"] = str(e)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "Research Paper Download Service",
        "status": "running",
        "version": "1.0.0"
    }


@app.post("/api/download", response_model=DownloadResponse, status_code=202)
async def download(request: DownloadRequest):
    """
    Submit a paper download request.
    
    Returns a task_id that can be used to check the download status.
    The download runs in the background and may take several seconds.
    
    Args:
        request: Download request with keyword and paper_type
        
    Returns:
        DownloadResponse with task_id and initial status
    """
    task_id = str(uuid.uuid4())
    
    # Initialize task in TASKS dict
    TASKS[task_id] = {
        "status": "pending",
        "result": None,
        "error": None,
    }
    
    # Submit to thread pool
    executor.submit(process_download, task_id, request.keyword, request.paper_type)
    
    logger.info(f"Created download task {task_id} for {request.keyword}")
    
    return DownloadResponse(
        task_id=task_id,
        status="pending"
    )


@app.get("/api/status/{task_id}", response_model=TaskStatus)
async def get_status(task_id: str):
    """
    Get the status of a download task.
    
    Args:
        task_id: The task identifier returned by POST /api/download
        
    Returns:
        TaskStatus with current status, result (if completed), or error (if failed)
        
    Raises:
        HTTPException 404: If task_id not found
    """
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    task = TASKS[task_id]
    
    return TaskStatus(
        task_id=task_id,
        status=task["status"],
        result=task.get("result"),
        error=task.get("error")
    )


@app.get("/api/tasks")
async def list_tasks():
    """
    List all tasks (for debugging).
    
    Returns:
        Dictionary of all tasks and their statuses
    """
    return {
        "total_tasks": len(TASKS),
        "tasks": {
            task_id: {
                "status": task["status"],
                "has_result": task.get("result") is not None,
                "has_error": task.get("error") is not None,
            }
            for task_id, task in TASKS.items()
        }
    }
