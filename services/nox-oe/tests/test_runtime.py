from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from nox_oe.artifacts import PostgresScientificArtifactStore
from nox_oe.checkpoint import CheckpointProblem, validate_checkpoint
from nox_oe.contracts import DESCRIPTOR_HEAD_COUNT, EDGE_FEATURE_COUNT, EMBEDDING_DIMENSION, NODE_FEATURE_COUNT
from nox_oe.graph import GraphFeaturizer
from nox_oe.runtime import ScientificRuntime


class RuntimeContractTests(unittest.TestCase):
    def test_graph_dimensions_are_frozen(self) -> None:
        self.assertEqual(NODE_FEATURE_COUNT, 72)
        self.assertEqual(EDGE_FEATURE_COUNT, 12)
        self.assertEqual(EMBEDDING_DIMENSION, 256)
        self.assertEqual(DESCRIPTOR_HEAD_COUNT, 138)
        self.assertEqual(GraphFeaturizer.node_feature_count, 72)
        self.assertEqual(GraphFeaturizer.edge_feature_count, 12)

    def test_missing_checkpoint_disables_inference(self) -> None:
        runtime = ScientificRuntime(None, None)
        runtime.load()
        self.assertFalse(runtime.ready)
        with self.assertRaisesRegex(CheckpointProblem, "MODEL_UNAVAILABLE"):
            runtime.infer("CCO")

    def test_label_order_and_checkpoint_hash_are_validated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "model.pt"
            checkpoint.write_bytes(b"validated-fixture")
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                        "model_version": "fixture-v1",
                        "descriptor_schema_version": "descriptor-138-v1",
                        "descriptor_labels": [f"descriptor-{index:03d}" for index in range(138)],
                        "taxonomy_version": "osmo_v1.2",
                        "node_feature_count": 72,
                        "edge_feature_count": 12,
                    }
                ),
                encoding="utf-8",
            )
            validated = validate_checkpoint(checkpoint, manifest)
            self.assertEqual(validated.model_version, "fixture-v1")
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["descriptor_labels"] = payload["descriptor_labels"][:-1]
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(CheckpointProblem, "DESCRIPTOR_SCHEMA_MISMATCH"):
                validate_checkpoint(checkpoint, manifest)

    def test_artifact_store_targets_only_scientific_artifacts(self) -> None:
        sql = PostgresScientificArtifactStore.INSERT_SQL.lower()
        self.assertIn("insert into scientific_artifacts", sql)
        self.assertNotIn("material_odor_assignments", sql)
        self.assertNotIn("update materials", sql)


if __name__ == "__main__":
    unittest.main()
