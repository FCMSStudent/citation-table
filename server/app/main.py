"""
FastAPI microservice for downloading research papers using SciDownl.

This service provides a simple HTTP API for downloading papers by DOI, PMID, or title.
Downloads are processed in background threads and status can be polled.
"""

import os
import uuid
import threading
from typing import Dict, Optional
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from scidownl import scihub_download

# Configuration
STORAGE_DIR = Path(__file__).parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)

# Security & Resource limits
MAX_CONCURRENT_TASKS = 5
MAX_TASKS_IN_MEMORY = 100

# Task storage (in-memory for lightweight implementation)
# In production, consider Redis/database for persistence
tasks: Dict[str, dict] = {}
tasks_lock = threading.Lock()

app = FastAPI(
    title="Research Paper Download Service",
    description="Lightweight microservice for downloading research papers",
    version="1.0.0",
)

# CORS middleware to allow frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DownloadRequest(BaseModel):
    """Request model for paper download."""
    keyword: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="DOI, PMID, or paper title"
    )
    paper_type: str = Field(..., description="Type: 'doi', 'pmid', or 'title'")


class DownloadResponse(BaseModel):
    """Response model for download request."""
    task_id: str
    status: str
    message: str


class TaskStatus(BaseModel):
    """Response model for task status."""
    task_id: str
    status: str
    created_at: str
    completed_at: Optional[str] = None
    filename: Optional[str] = None
    filepath: Optional[str] = None
    error: Optional[str] = None


def download_paper_task(task_id: str, keyword: str, paper_type: str):
    """
    Background task to download a paper using SciDownl.
    
    Args:
        task_id: Unique task identifier
        keyword: DOI, PMID, or paper title
        paper_type: Type of keyword ('doi', 'pmid', or 'title')
    """
    # Create a unique directory for this task to prevent race conditions
    task_dir = STORAGE_DIR / task_id

    try:
        # Update task status to processing
        with tasks_lock:
            if task_id in tasks:
                tasks[task_id]["status"] = "processing"

        task_dir.mkdir(exist_ok=True)
        
        # Download the paper using SciDownl
        # scihub_download returns the output filename
        output_path = str(task_dir)
        
        # Download based on paper_type
        # Security: scihub_download handles its own internal security/requests
        scihub_download(
            keyword,
            paper_type=paper_type,
            out=output_path
        )
        
        # Find the downloaded file in the task-specific directory
        downloaded_files = list(task_dir.glob("*.pdf"))
        if downloaded_files:
            # Get the most recently modified file in the task dir
            latest_file = max(downloaded_files, key=lambda p: p.stat().st_mtime)
            filename = latest_file.name

            # Move file to STORAGE_DIR to allow access (if needed) or keep in task_dir
            # For now, we'll keep it in task_dir but return its relative path
            filepath = str(latest_file.relative_to(STORAGE_DIR.parent))
            
            # Update task with success
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id].update({
                        "status": "completed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "filename": filename,
                        "filepath": filepath,
                    })
        else:
            # No file was downloaded
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id].update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error": "No PDF file was downloaded. The paper may not be available.",
                    })
    
    except Exception as e:
        # Handle any errors during download
        with tasks_lock:
            if task_id in tasks:
                tasks[task_id].update({
                    "status": "failed",
                    "completed_at": datetime.utcnow().isoformat(),
                    "error": str(e),
                })


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "Research Paper Download Service",
        "version": "1.0.0",
        "endpoints": {
            "download": "POST /api/download",
            "status": "GET /api/status/{task_id}",
            "health": "GET /health",
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "storage_dir": str(STORAGE_DIR),
        "active_tasks": len([t for t in tasks.values() if t["status"] == "processing"]),
    }


@app.post("/api/download", response_model=DownloadResponse, status_code=202)
async def download_paper(request: DownloadRequest):
    """
    Request a paper download by DOI, PMID, or title.
    
    Returns a task_id that can be used to poll the download status.
    The download is processed in a background thread.
    
    Args:
        request: DownloadRequest with keyword and paper_type
        
    Returns:
        DownloadResponse with task_id and initial status
    """
    # Validate paper_type
    valid_types = ["doi", "pmid", "title"]
    if request.paper_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid paper_type. Must be one of: {', '.join(valid_types)}"
        )
    
    # Resource limit: check concurrent tasks
    with tasks_lock:
        active_tasks = [t for t in tasks.values() if t["status"] in ["pending", "processing"]]
        if len(active_tasks) >= MAX_CONCURRENT_TASKS:
            raise HTTPException(
                status_code=429,
                detail="Too many concurrent download tasks. Please try again later."
            )

        # Security: Cleanup old tasks to prevent memory exhaustion
        if len(tasks) >= MAX_TASKS_IN_MEMORY:
            # Remove oldest 20% of tasks
            sorted_tasks = sorted(tasks.values(), key=lambda x: x["created_at"])
            num_to_remove = int(MAX_TASKS_IN_MEMORY * 0.2)
            removed_count = 0
            for i in range(len(sorted_tasks)):
                if removed_count >= num_to_remove:
                    break

                task_to_remove = sorted_tasks[i]["task_id"]
                # Don't remove currently processing tasks if possible
                if sorted_tasks[i]["status"] not in ["pending", "processing"]:
                    tasks.pop(task_to_remove, None)
                    removed_count += 1

    # Generate unique task ID
    task_id = str(uuid.uuid4())
    
    # Initialize task record
    task_record = {
        "task_id": task_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "keyword": request.keyword,
        "paper_type": request.paper_type,
    }
    
    with tasks_lock:
        tasks[task_id] = task_record
    
    # Start background thread for download
    thread = threading.Thread(
        target=download_paper_task,
        args=(task_id, request.keyword, request.paper_type),
        daemon=True
    )
    thread.start()
    
    return DownloadResponse(
        task_id=task_id,
        status="pending",
        message=f"Download task created. Poll /api/status/{task_id} for updates."
    )


@app.get("/api/status/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    """
    Get the status of a download task.
    
    Args:
        task_id: The unique task identifier
        
    Returns:
        TaskStatus with current task information
    """
    with tasks_lock:
        task = tasks.get(task_id)
    
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"Task {task_id} not found"
        )
    
    return TaskStatus(**task)


@app.get("/api/tasks")
async def list_tasks():
    """
    List all tasks (for debugging/monitoring).
    
    Returns:
        List of all tasks with their current status
    """
    with tasks_lock:
        all_tasks = list(tasks.values())
    
    return {
        "total": len(all_tasks),
        "tasks": all_tasks
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
