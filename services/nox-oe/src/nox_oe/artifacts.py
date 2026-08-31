from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ScientificArtifact:
    material_id: str
    structure_hash: str
    model_version: str
    feature_schema_hash: str
    embedding: list[float]
    predictions: dict[str, object]


class ScientificArtifactStore(Protocol):
    def write(self, artifact: ScientificArtifact) -> None: ...


class PostgresScientificArtifactStore:
    """Writes derived data only; no G3 truth table is ever updated."""

    INSERT_SQL = """
        insert into scientific_runtime.scientific_artifacts (
          material_id, structure_hash, artifact_type, model_family, model_version,
          taxonomy_source, taxonomy_version, feature_schema_hash, embedding, predictions
        ) values (%s, %s, 'DESCRIPTOR_PREDICTION', 'ATTENTIVE_FP', %s,
                  'OSMO', 'osmo_v1.2', %s, %s, %s)
    """

    def __init__(self, connection_factory) -> None:
        self._connection_factory = connection_factory

    def write(self, artifact: ScientificArtifact) -> None:
        import json

        with self._connection_factory() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    self.INSERT_SQL,
                    (
                        artifact.material_id,
                        artifact.structure_hash,
                        artifact.model_version,
                        artifact.feature_schema_hash,
                        artifact.embedding,
                        json.dumps(artifact.predictions),
                    ),
                )
            connection.commit()
