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
        try:
            from rdkit import Chem
        except ImportError as error:
            raise ScientificDependencyUnavailable("SCIENTIFIC_RUNTIME_UNAVAILABLE") from error
        molecule = Chem.MolFromSmiles(canonical_smiles)
        if molecule is None:
            raise ValueError("INVALID_STRUCTURE")
        nodes = [self._atom_features(atom) for atom in molecule.GetAtoms()]
        edges: list[tuple[int, int]] = []
        edge_features: list[list[float]] = []
        for bond in molecule.GetBonds():
            features = self._bond_features(bond)
            left, right = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
            edges.extend([(left, right), (right, left)])
            edge_features.extend([features, features])
        return MolecularGraph(nodes, edges, edge_features)

    @staticmethod
    def _atom_features(atom: object) -> list[float]:
        # Stable, bounded V1 schema: core scalar facts followed by reserved zeros.
        values = [
            float(atom.GetAtomicNum()) / 118.0,
            float(atom.GetTotalDegree()) / 8.0,
            float(atom.GetFormalCharge()) / 8.0,
            float(atom.GetTotalNumHs()) / 8.0,
            float(atom.GetIsAromatic()),
            float(atom.IsInRing()),
        ]
        return values + [0.0] * (NODE_FEATURE_COUNT - len(values))

    @staticmethod
    def _bond_features(bond: object) -> list[float]:
        values = [
            float(bond.GetBondTypeAsDouble()) / 3.0,
            float(bond.GetIsAromatic()),
            float(bond.GetIsConjugated()),
            float(bond.IsInRing()),
        ]
        return values + [0.0] * (EDGE_FEATURE_COUNT - len(values))
