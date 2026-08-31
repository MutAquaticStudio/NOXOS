from __future__ import annotations

from dataclasses import dataclass

from .contracts import EDGE_FEATURE_COUNT, NODE_FEATURE_COUNT
from .structure import ScientificDependencyUnavailable


@dataclass(frozen=True)
class MolecularGraph:
    node_features: list[list[float]]
    edge_index: list[tuple[int, int]]
    edge_features: list[list[float]]


class GraphFeaturizer:
    version = "nox-oe-graph-72x12-v1"
    node_feature_count = NODE_FEATURE_COUNT
    edge_feature_count = EDGE_FEATURE_COUNT

    def featurize(self, canonical_smiles: str) -> MolecularGraph:
        del canonical_smiles
        # The old mostly-zero padding was not a verified model feature schema.
        # Molecular graph construction stays unusable until a checkpoint ships
        # with an exact feature manifest and a matching implementation.
        raise ScientificDependencyUnavailable("SCIENTIFIC_RUNTIME_UNAVAILABLE")
