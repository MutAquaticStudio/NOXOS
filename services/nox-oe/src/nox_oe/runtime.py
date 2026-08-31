from __future__ import annotations

from pathlib import Path

from .checkpoint import CheckpointProblem, ValidatedCheckpoint, validate_checkpoint


class ScientificRuntime:
    """Fail-closed runtime. Random initialized inference is never permitted."""

    def __init__(self, checkpoint_path: Path | None, manifest_path: Path | None) -> None:
        self._checkpoint_path = checkpoint_path
        self._manifest_path = manifest_path
        self.checkpoint: ValidatedCheckpoint | None = None
        self.problem = "MODEL_UNAVAILABLE"

    def load(self) -> None:
        try:
            self.checkpoint = validate_checkpoint(self._checkpoint_path, self._manifest_path)
            self.problem = ""
        except CheckpointProblem as error:
            self.checkpoint = None
            self.problem = str(error)

    @property
    def ready(self) -> bool:
        return self.checkpoint is not None

    def infer(self, *_args, **_kwargs):
        if not self.ready:
            raise CheckpointProblem(self.problem or "MODEL_UNAVAILABLE")
        # Loading the validated state dict and graph tensors is intentionally
        # kept behind the deployment/model-artifact boundary.
        raise CheckpointProblem("MODEL_UNAVAILABLE")
