from __future__ import annotations

import hashlib
from dataclasses import dataclass


class InvalidStructure(ValueError):
    pass


class ScientificDependencyUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class StandardizedStructure:
    canonical_smiles: str
    structure_hash: str


class StructureStandardizer:
    version = "rdkit-standardizer-v1"

    def standardize(self, smiles: str) -> StandardizedStructure:
        try:
            from rdkit import Chem
            from rdkit.Chem.MolStandardize import rdMolStandardize
        except ImportError as error:
            raise ScientificDependencyUnavailable("SCIENTIFIC_RUNTIME_UNAVAILABLE") from error

        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            raise InvalidStructure("INVALID_STRUCTURE")
        molecule = rdMolStandardize.Cleanup(molecule)
        molecule = rdMolStandardize.FragmentParent(molecule)
        canonical = Chem.MolToSmiles(molecule, canonical=True, isomericSmiles=True)
        return StandardizedStructure(canonical, hashlib.sha256(canonical.encode("utf-8")).hexdigest())
