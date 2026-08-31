from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException

from .contracts import EvaluateRequest, EvaluateUnavailable
from .runtime import ScientificRuntime

checkpoint = Path(os.environ["NOX_OE_CHECKPOINT_PATH"]) if os.getenv("NOX_OE_CHECKPOINT_PATH") else None
manifest = Path(os.environ["NOX_OE_MANIFEST_PATH"]) if os.getenv("NOX_OE_MANIFEST_PATH") else None
runtime = ScientificRuntime(checkpoint, manifest)
runtime.load()
app = FastAPI(title="NØX-OE", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "HEALTHY", "service": "nox-oe"}


@app.get("/ready")
def ready() -> dict[str, str]:
    return {
        "status": "READY" if runtime.ready else "DEGRADED",
        "scientificCapability": "AVAILABLE" if runtime.ready else runtime.problem,
    }


@app.post("/v1/evaluate", response_model=EvaluateUnavailable)
def evaluate(request: EvaluateRequest, authorization: str | None = Header(default=None)):
    expected = os.getenv("NOX_OE_INTERNAL_TOKEN")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=403, detail="Internal scientific access denied.")
    if not runtime.ready:
        return EvaluateUnavailable(code="MODEL_UNAVAILABLE", reason="A validated model checkpoint is unavailable.")
    return EvaluateUnavailable(code="MODEL_UNAVAILABLE", reason="Validated inference adapter is not configured.")
