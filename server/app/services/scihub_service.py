"""
Wrapper service for SciDownl to download papers from Sci-Hub.

This service handles:
- Calling scidownl.api.scihub.scihub_download()
- Managing temporary download directories
- Moving PDFs to server/storage/ with unique filenames
- Returning metadata about the downloaded file
"""

import os
import tempfile
import shutil
import logging
from pathlib import Path
from typing import Dict
import time

logger = logging.getLogger(__name__)

# Storage directory for downloaded PDFs
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage"
STORAGE_DIR.mkdir(exist_ok=True)


def download_paper(keyword: str, paper_type: str = "doi") -> Dict[str, str]:
    """
    Download a paper using SciDownl and store it in server/storage/.
    
    Args:
        keyword: Paper identifier (DOI, PubMed ID, or arXiv ID)
        paper_type: Type of identifier ("doi", "pmid", or "arxiv")
        
    Returns:
        Dictionary with filepath and filename of the downloaded PDF
        
    Raises:
        Exception: If download fails or file cannot be found
    """
    # Import here to avoid import errors if scidownl is not installed
    try:
        from scidownl.api.scihub import scihub_download
    except ImportError as e:
        logger.error("Failed to import scidownl: %s", e)
        raise Exception("SciDownl library not available. Please install requirements.")
    
    # Create a temporary directory for the download
    with tempfile.TemporaryDirectory() as tmpdir:
        logger.info(f"Downloading {paper_type}:{keyword} to temporary directory: {tmpdir}")
        
        try:
            # Download the paper using scidownl
            # scihub_download returns the path to the downloaded file
            result = scihub_download(
                keyword=keyword,
                paper_type=paper_type,
                out=tmpdir
            )
            
            logger.info(f"SciDownl result: {result}")
            
            # Find the downloaded PDF in the temp directory
            pdf_files = list(Path(tmpdir).glob("*.pdf"))
            
            if not pdf_files:
                raise Exception(f"No PDF file found after download for {keyword}")
            
            # Use the first PDF file found
            source_pdf = pdf_files[0]
            
            # Generate a unique filename based on keyword and timestamp
            # Sanitize the keyword for use in filename
            safe_keyword = keyword.replace("/", "_").replace(":", "_").replace(" ", "_")
            timestamp = int(time.time())
            # Use timestamp and original name for uniqueness (no hash needed for non-security purpose)
            unique_filename = f"{safe_keyword}_{timestamp}.pdf"
            
            # Destination path in storage
            dest_path = STORAGE_DIR / unique_filename
            
            # Copy the file to storage
            shutil.copy2(source_pdf, dest_path)
            logger.info(f"Copied PDF to storage: {dest_path}")
            
            return {
                "filepath": str(dest_path),
                "filename": unique_filename,
                "original_keyword": keyword,
                "paper_type": paper_type
            }
            
        except Exception as e:
            logger.error(f"Error downloading paper {keyword}: {str(e)}")
            raise Exception(f"Failed to download paper: {str(e)}")
