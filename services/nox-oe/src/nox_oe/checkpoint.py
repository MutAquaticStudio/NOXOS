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
    feature_schema_hash: str


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
    feature_schema = manifest.get("feature_schema")
    if not isinstance(feature_schema, dict):
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    node_features = feature_schema.get("node_features")
    edge_features = feature_schema.get("edge_features")
    if (
        not isinstance(feature_schema.get("version"), str)
        or not isinstance(feature_schema.get("rdkit_version"), str)
        or not isinstance(node_features, list)
        or not isinstance(edge_features, list)
        or len(node_features) != NODE_FEATURE_COUNT
        or len(edge_features) != EDGE_FEATURE_COUNT
    ):
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    required_feature_fields = {"name", "order", "encoding", "normalization"}
    for expected_order, feature in enumerate([*node_features, *edge_features]):
        if (
            not isinstance(feature, dict)
            or not required_feature_fields.issubset(feature)
            or feature.get("order") != expected_order % (
                NODE_FEATURE_COUNT if expected_order < NODE_FEATURE_COUNT else EDGE_FEATURE_COUNT
            )
        ):
            raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    actual_feature_hash = hashlib.sha256(
        json.dumps(feature_schema, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if manifest.get("feature_schema_hash") != actual_feature_hash:
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    expected_sha = manifest.get("checkpoint_sha256")
    actual_sha = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
    if not expected_sha or expected_sha != actual_sha:
        raise CheckpointProblem("MODEL_UNAVAILABLE")
    model_version = manifest.get("model_version")
    schema_version = manifest.get("descriptor_schema_version")
    if not isinstance(model_version, str) or not isinstance(schema_version, str):
        raise CheckpointProblem("DESCRIPTOR_SCHEMA_MISMATCH")
    return ValidatedCheckpoint(
        checkpoint_path,
        model_version,
        schema_version,
        labels,
        actual_feature_hash,
    )
