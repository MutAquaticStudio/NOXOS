from __future__ import annotations

from .contracts import DESCRIPTOR_HEAD_COUNT, EDGE_FEATURE_COUNT, EMBEDDING_DIMENSION, NODE_FEATURE_COUNT


def build_attentive_fp_model():
    """Build architecture only after checkpoint integrity has been validated."""
    try:
        import torch
        from torch_geometric.nn import AttentiveFP
    except ImportError as error:
        raise RuntimeError("SCIENTIFIC_RUNTIME_UNAVAILABLE") from error

    class NoxOeAttentiveFp(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.backbone = AttentiveFP(
                in_channels=NODE_FEATURE_COUNT,
                hidden_channels=EMBEDDING_DIMENSION,
                out_channels=EMBEDDING_DIMENSION,
                edge_dim=EDGE_FEATURE_COUNT,
                num_layers=5,
                num_timesteps=2,
                dropout=0.0,
            )
            self.descriptor_head = torch.nn.Linear(EMBEDDING_DIMENSION, DESCRIPTOR_HEAD_COUNT)

        def forward(self, x, edge_index, edge_attr, batch):
            embedding = self.backbone(x, edge_index, edge_attr, batch)
            return embedding, torch.sigmoid(self.descriptor_head(embedding))

    return NoxOeAttentiveFp()
