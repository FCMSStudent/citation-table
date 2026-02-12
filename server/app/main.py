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
    keyword: str = Field(..., description="DOI, PMID, or paper title")
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
    try:
        # Update task status to processing
        with tasks_lock:
            tasks[task_id]["status"] = "processing"
        
        # Download the paper using SciDownl
        # scihub_download returns the output filename
        output_path = str(STORAGE_DIR)
        
        # Download based on paper_type
        result = scihub_download(
            keyword,
            paper_type=paper_type,
            out=output_path
        )
        
        # Find the downloaded file
        # SciDownl creates files with sanitized names
        downloaded_files = list(STORAGE_DIR.glob("*.pdf"))
        if downloaded_files:
            # Get the most recently modified file
            latest_file = max(downloaded_files, key=lambda p: p.stat().st_mtime)
            filename = latest_file.name
            filepath = str(latest_file.relative_to(STORAGE_DIR.parent))
            
            # Update task with success
            with tasks_lock:
                tasks[task_id].update({
                    "status": "completed",
                    "completed_at": datetime.utcnow().isoformat(),
                    "filename": filename,
                    "filepath": filepath,
                })
        else:
            # No file was downloaded
            with tasks_lock:
                tasks[task_id].update({
                    "status": "failed",
                    "completed_at": datetime.utcnow().isoformat(),
                    "error": "No PDF file was downloaded. The paper may not be available.",
                })
    
    except Exception as e:
        # Handle any errors during download
        with tasks_lock:
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
