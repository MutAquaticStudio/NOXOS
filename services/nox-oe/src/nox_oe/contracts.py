from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NODE_FEATURE_COUNT = 72
EDGE_FEATURE_COUNT = 12
EMBEDDING_DIMENSION = 256
DESCRIPTOR_HEAD_COUNT = 138
TAXONOMY_VERSION = "osmo_v1.2"


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_id: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")
    canonical_smiles: str = Field(min_length=1, max_length=4096)


class DescriptorPrediction(BaseModel):
    taxonomy_term: str
    probability: float = Field(ge=0.0, le=1.0)


class EvaluateSuccess(BaseModel):
    state: Literal["AVAILABLE"] = "AVAILABLE"
    structure_hash: str
    model_version: str
    taxonomy_version: Literal["osmo_v1.2"] = TAXONOMY_VERSION
    descriptor_schema_version: str
    embedding: list[float] = Field(min_length=EMBEDDING_DIMENSION, max_length=EMBEDDING_DIMENSION)
    descriptors: list[DescriptorPrediction] = Field(
        min_length=DESCRIPTOR_HEAD_COUNT, max_length=DESCRIPTOR_HEAD_COUNT
    )


class EvaluateUnavailable(BaseModel):
    state: Literal["UNAVAILABLE"] = "UNAVAILABLE"
    code: Literal[
        "MODEL_UNAVAILABLE",
        "INVALID_STRUCTURE",
        "DESCRIPTOR_SCHEMA_MISMATCH",
        "SCIENTIFIC_RUNTIME_UNAVAILABLE",
    ]
    reason: str
