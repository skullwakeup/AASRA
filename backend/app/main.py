"""
Phase 1 — FastAPI application.

Endpoints
---------
GET  /health        liveness / configuration snapshot
POST /api/analyze   multipart upload (field name: `image`) -> analysis JSON

Validation covers file extension, MIME type, size and decodability. Failures
return a clean JSON error; stack traces are never sent to the client.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

from fastapi import FastAPI, File, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .pipeline import run_analysis
from .services.preprocessing import ImageDecodeError, ImageTooSmallError

logger = logging.getLogger("aasra")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(
    title=config.APP_TITLE,
    description=config.APP_DESCRIPTION,
    version=config.APP_VERSION,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Local development origins always work, with no configuration needed. The
# deployed frontend's origin (e.g. a Vercel URL) is added via the
# CORS_ORIGINS environment variable — a comma-separated list, e.g.
#   CORS_ORIGINS=https://aasra.vercel.app,https://aasra-git-main-you.vercel.app
# The API has no auth/cookies (allow_credentials=False), so a wildcard origin
# would not expose user data — but a fixed, explicit list is not meaningfully
# harder to operate and avoids letting arbitrary third-party sites relay
# traffic through a visitor's browser to this API for free.
_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
_configured_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = _DEV_ORIGINS + _configured_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE_BYTES = config.MAX_FILE_SIZE_MB * 1024 * 1024


def _error(message: str, code: str, http_status: int) -> JSONResponse:
    """Uniform, trace-free error envelope."""
    return JSONResponse(
        status_code=http_status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


@app.get("/health")
def health() -> Dict[str, Any]:
    """Confirm the backend is running and report the active configuration."""
    return {
        "success": True,
        "status": "ok",
        "service": config.APP_NAME,
        "version": config.APP_VERSION,
        "analysis_mode": dict(config.ANALYSIS_MODE),
        "limits": {
            "max_file_size_mb": config.MAX_FILE_SIZE_MB,
            "max_image_dimension": config.MAX_IMAGE_DIMENSION,
            "allowed_extensions": sorted(config.ALLOWED_EXTENSIONS),
            "max_zones": config.MAX_ZONES,
        },
    }


@app.get("/")
def root() -> Dict[str, Any]:
    """Minimal index so a browser hit on the root is not a 404."""
    return {
        "success": True,
        "service": config.APP_TITLE,
        "version": config.APP_VERSION,
        "endpoints": ["/health", "/api/analyze", "/docs"],
        "notice": (
            "Computer-vision decision-support prototype. Candidate regions only."
        ),
    }


@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...)):
    """Analyse an aerial flood image and return candidate relief zones."""

    # ---- Validation: filename / extension ---------------------------------
    filename = image.filename or ""
    extension = os.path.splitext(filename)[1].lower()
    if extension not in config.ALLOWED_EXTENSIONS:
        return _error(
            "Unsupported file type. Upload a JPG, JPEG or PNG image.",
            "UNSUPPORTED_FILE_TYPE",
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )

    # ---- Validation: declared content type --------------------------------
    content_type = (image.content_type or "").lower().split(";")[0].strip()
    if content_type and content_type not in config.ALLOWED_CONTENT_TYPES:
        return _error(
            f"Unsupported content type '{content_type}'. Expected JPEG or PNG.",
            "UNSUPPORTED_CONTENT_TYPE",
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )

    # ---- Validation: size --------------------------------------------------
    try:
        data = await image.read()
    except Exception:
        logger.exception("Failed to read the uploaded file")
        return _error(
            "The uploaded file could not be read.",
            "UPLOAD_READ_FAILED",
            status.HTTP_400_BAD_REQUEST,
        )
    finally:
        await image.close()

    if not data:
        return _error(
            "The uploaded file is empty.", "EMPTY_FILE", status.HTTP_400_BAD_REQUEST
        )

    if len(data) > MAX_FILE_SIZE_BYTES:
        return _error(
            f"File is too large. Maximum size is {config.MAX_FILE_SIZE_MB} MB.",
            "FILE_TOO_LARGE",
            413,  # Content Too Large
        )

    # ---- Analysis ----------------------------------------------------------
    try:
        result = run_analysis(data)
    except ImageDecodeError:
        return _error(
            "The image could not be decoded. It may be corrupt or not a real "
            "JPG/PNG file.",
            "CORRUPT_IMAGE",
            status.HTTP_400_BAD_REQUEST,
        )
    except ImageTooSmallError as exc:
        return _error(str(exc), "IMAGE_TOO_SMALL", status.HTTP_400_BAD_REQUEST)
    except MemoryError:
        logger.exception("Out of memory while analysing image")
        return _error(
            "The image was too large to process.",
            "IMAGE_TOO_LARGE_TO_PROCESS",
            413,  # Content Too Large
        )
    except Exception:
        # Logged server-side only — never returned to the client.
        logger.exception("Unhandled error during analysis")
        return _error(
            "Analysis failed due to an internal error.",
            "ANALYSIS_FAILED",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return JSONResponse(status_code=status.HTTP_200_OK, content=result)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all so no stack trace ever reaches a client."""
    logger.exception("Unhandled exception on %s", request.url.path)
    return _error(
        "An unexpected server error occurred.",
        "INTERNAL_ERROR",
        status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
