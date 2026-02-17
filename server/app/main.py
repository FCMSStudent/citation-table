"""
FastAPI microservice for downloading research papers using SciDownl.

This service provides a simple HTTP API for downloading papers by DOI, PMID, or title.
Downloads are processed in background threads and status can be polled.
"""

import os
import uuid
import threading
import shutil
from typing import Dict, Optional, Literal
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from scidownl import scihub_download
from app.services.pdf_extraction_service import (
    ExtractStudiesRequest,
    ExtractStudiesResponse,
    extract_studies_batch,
)

# Configuration
STORAGE_DIR = Path(__file__).parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)

# Security Constants
MAX_TASKS = 100
MAX_CONCURRENT_DOWNLOADS = 5
PDF_EXTRACTOR_BEARER_TOKEN = os.getenv("PDF_EXTRACTOR_BEARER_TOKEN", "").strip()

# Task storage (in-memory for lightweight implementation)
tasks: Dict[str, dict] = {}
tasks_lock = threading.Lock()
# Semaphore to limit concurrent background downloads
download_semaphore = threading.Semaphore(MAX_CONCURRENT_DOWNLOADS)

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
    keyword: str = Field(..., max_length=500, description="DOI, PMID, or paper title")
    paper_type: Literal["doi", "pmid", "title"] = Field(..., description="Type of keyword")


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
    """
    with download_semaphore:
        task_dir = STORAGE_DIR / task_id
        try:
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id]["status"] = "processing"

            task_dir.mkdir(exist_ok=True)
            scihub_download(keyword, paper_type=paper_type, out=str(task_dir))

            downloaded_files = list(task_dir.glob("*.pdf"))
            if downloaded_files:
                latest_file = max(downloaded_files, key=lambda p: p.stat().st_mtime)
                filename = latest_file.name
                with tasks_lock:
                    if task_id in tasks:
                        tasks[task_id].update({
                            "status": "completed",
                            "completed_at": datetime.utcnow().isoformat(),
                            "filename": filename,
                            "filepath": f"storage/{task_id}/{filename}",
                        })
            else:
                with tasks_lock:
                    if task_id in tasks:
                        tasks[task_id].update({
                            "status": "failed",
                            "completed_at": datetime.utcnow().isoformat(),
                            "error": "Paper not available or download failed.",
                        })
        except Exception:
            with tasks_lock:
                if task_id in tasks:
                    tasks[task_id].update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error": "An unexpected error occurred during download.",
                    })
        finally:
            # Cleanup task directory if no PDF was successfully saved
            if task_dir.exists() and not list(task_dir.glob("*.pdf")):
                shutil.rmtree(task_dir, ignore_errors=True)


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "Research Paper Download Service",
        "version": "1.0.0",
        "endpoints": {
            "download": "POST /api/download",
            "status": "GET /api/status/{task_id}",
            "extract_studies": "POST /extract/studies",
            "health": "GET /health",
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    with tasks_lock:
        active = len([t for t in tasks.values() if t["status"] == "processing"])
        total = len(tasks)
    # Security: Health check should not disclose internal file system paths (e.g. storage_dir)
    return {
        "status": "healthy",
        "active_tasks": active,
        "total_tasks_cached": total,
        "concurrency_limit": MAX_CONCURRENT_DOWNLOADS,
        "pdf_extractor_auth_enabled": bool(PDF_EXTRACTOR_BEARER_TOKEN),
    }


async def verify_token(authorization: Optional[str] = Header(default=None)) -> None:
    """
    Verify the Bearer token against PDF_EXTRACTOR_BEARER_TOKEN.
    Security: Functional endpoints must be protected to prevent unauthorized resource consumption.
    """
    if not PDF_EXTRACTOR_BEARER_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    supplied = authorization.replace("Bearer ", "", 1).strip()
    if supplied != PDF_EXTRACTOR_BEARER_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid bearer token")


@app.post("/extract/studies", response_model=ExtractStudiesResponse, dependencies=[Depends(verify_token)])
async def extract_studies_endpoint(request: ExtractStudiesRequest):
    """
    Deterministically extract study fields from PDFs (with abstract fallback).
    """
    try:
        return extract_studies_batch(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(exc)[:160]}")


@app.post("/api/download", response_model=DownloadResponse, status_code=202, dependencies=[Depends(verify_token)])
async def download_paper(request: DownloadRequest):
    """Request a paper download by DOI, PMID, or title."""
    task_id = str(uuid.uuid4())
    task_record = {
        "task_id": task_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "keyword": request.keyword,
        "paper_type": request.paper_type,
    }
    
    evict_path = None
    with tasks_lock:
        if len(tasks) >= MAX_TASKS:
            evict_id = next(iter(tasks))
            evicted = tasks.pop(evict_id)
            if evicted["status"] != "processing":
                evict_path = STORAGE_DIR / evict_id
        tasks[task_id] = task_record
    
    if evict_path and evict_path.exists():
        shutil.rmtree(evict_path, ignore_errors=True)

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


@app.get("/api/status/{task_id}", response_model=TaskStatus, dependencies=[Depends(verify_token)])
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


@app.get("/api/tasks", dependencies=[Depends(verify_token)])
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
