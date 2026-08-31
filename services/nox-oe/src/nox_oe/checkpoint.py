from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .contracts import DESCRIPTOR_HEAD_COUNT, EDGE_FEATURE_COUNT, NODE_FEATURE_COUNT, TAXONOMY_VERSION


class CheckpointProblem(RuntimeError):
    pass


@dataclass(frozen=True)
class ValidatedCheckpoint:
    checkpoint_path: Path
    model_version: str
    descriptor_schema_version: str
    descriptor_labels: tuple[str, ...]


def validate_checkpoint(checkpoint_path: Path | None, manifest_path: Path | None) -> ValidatedCheckpoint:
    if checkpoint_path is None or manifest_path is None or not checkpoint_path.is_file() or not manifest_path.is_file():
        raise CheckpointProblem("MODEL_UNAVAILABLE")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    labels = tuple(manifest.get("descriptor_labels", []))
    if len(labels) != DESCRIPTOR_HEAD_COUNT or len(set(labels)) != DESCRIPTOR_HEAD_COUNT:
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    if manifest.get("taxonomy_version") != TAXONOMY_VERSION:
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    if manifest.get("node_feature_count") != NODE_FEATURE_COUNT:
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    if manifest.get("edge_feature_count") != EDGE_FEATURE_COUNT:
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    expected_sha = manifest.get("checkpoint_sha256")
    actual_sha = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
    if not expected_sha or expected_sha != actual_sha:
        raise CheckpointProblem("MODEL_UNAVAILABLE")
    model_version = manifest.get("model_version")
    schema_version = manifest.get("descriptor_schema_version")
    if not isinstance(model_version, str) or not isinstance(schema_version, str):
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    return ValidatedCheckpoint(checkpoint_path, model_version, schema_version, labels)
