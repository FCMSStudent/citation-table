"""
SciHub download service wrapper for SciDownl library.
Downloads academic papers using SciHub and stores them in the server/storage directory.
"""
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Dict, Optional
from scidownl.api.scihub import scihub_download


# Storage directory for downloaded PDFs
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)


def download_paper(
    keyword: str,
    paper_type: str = "doi",
    proxies: Optional[Dict[str, str]] = None
) -> Dict[str, str]:
    """
    Download a paper using SciHub via SciDownl and store it in server/storage.
    
    Args:
        keyword: The paper identifier (DOI, PMID, or URL)
        paper_type: Type of identifier - "doi", "pmid", or "url"
        proxies: Optional proxy configuration dict
    
    Returns:
        Dict with keys:
            - filepath: Full path to the downloaded PDF
            - filename: Name of the downloaded file
    
    Raises:
        Exception: If download fails or no PDF is found
    """
    # Create temporary directory for download
    tmpdir = tempfile.mkdtemp()
    
    try:
        # Download paper to temporary directory
        scihub_download(
            keyword=keyword,
            paper_type=paper_type,
            out=tmpdir,
            proxies=proxies
        )
        
        # Find the downloaded PDF file
        pdf_files = list(Path(tmpdir).glob("*.pdf"))
        
        if not pdf_files:
            raise Exception(f"No PDF file found after download for keyword: {keyword}")
        
        # Get the latest PDF (in case multiple files exist)
        latest_pdf = max(pdf_files, key=lambda p: p.stat().st_mtime)
        
        # Generate unique filename to avoid conflicts
        unique_id = str(uuid.uuid4())[:8]
        original_name = latest_pdf.stem
        new_filename = f"{original_name}_{unique_id}.pdf"
        target_path = STORAGE_DIR / new_filename
        
        # Move PDF to storage directory
        shutil.move(str(latest_pdf), str(target_path))
        
        return {
            "filepath": str(target_path),
            "filename": new_filename
        }
        
    finally:
        # Clean up temporary directory
        shutil.rmtree(tmpdir, ignore_errors=True)
