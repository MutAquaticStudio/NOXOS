# NØX-OS Gate 4 — Design Studio + NØX-OE

Document version: `2.3-COMPLETE CANDIDATE`

Gate status: `CANDIDATE — SHA-BOUND CLOUD ACCEPTANCE REQUIRED`

This is the canonical Gate 4 architecture record. Its acceptance state is not
mutated after deployment: the annotated Gate tag and SHA-bound GitHub Actions
evidence artifact are authoritative for the final `FROZEN` decision.

## Source binding

| Source                                        | Version               | SHA-256                                                            |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------ |
| `nox_master_blueprint.md`                     | `2.0-FINAL CANONICAL` | `be765579803248e90b495e7d84e3d9c4f8b049fe44b5371a1fdb68123bfb3bae` |
| `G4_MASTER_EXECUTION_PROMPT_v2.2_COMPLETE.md` | `2.2-COMPLETE`        | `a1679b5d7ea291df2b529c10577c25ce9a686f7db83e566a4587ca494a034013` |
| Gate 4 canonical closure amendment            | `2.3-COMPLETE`        | `8c47afef52f2bec629a1d7ae382362766c491f8a34d0c84dbc204c49d50fec26` |

Every begin marker, end marker and end-of-file marker was verified before
implementation. `contracts/g4-sources.json` is the deterministic source lock.

## Canonical boundaries

- G3 remains the sole owner of Material truth and `ChemicalEntity` internals.
- G4 owns Project, Brief, Formula, FormulaVersion, FormulaLine and immutable
  Formula frozen snapshots—exactly six `design_studio` tables.
- Formula composition uses positive integer milligrams. The reference Formula
  is exactly `1,000,000 mg`.
- Formula Freeze and approval are separate transitions. Frozen composition,
  intent, scientific context, validation and Material snapshots are immutable.
- G5 receives typed Trial, revision-return and approval-evidence contracts; G4
  creates no Trial, sensory or production data.
- G6 owns release readiness. Gate 4 always reports `NOT_ASSESSED`.

## G3 amendment consumed by G4

The namespace-safe G3 migration adds structured measurement projections,
application-specific formulation guidance and private derived scientific
artifacts. Formulation guidance changes use the existing governed G3 change
request and approval transaction. `MaterialIntelligenceSnapshot` carries both
normalized projections and guidance in its deterministic hash while tenant DTOs
continue to exclude `ChemicalEntity` fields.

## Formula baseline

The engine is `g4-bounded-formulation-v1`. It deterministically retrieves only
server-authorized, approved and application-guided Materials; rejects recursive
or inaccessible composition graphs; excludes zero-fit Materials; enforces
min/recommended/max guidance; covers required intent; and resolves an exact
one-kilogram composition.

The three comparison directions are `FAITHFUL`, `EXPRESSIVE` and a contextual
third direction (`LAYERED_ACCORD` or `MINIMALIST`). Without a trusted cost
resolver, cost is explicitly not assessed. Mixture interaction is explicitly
not modeled. The engine is a bounded design baseline requiring physical G5
validation—not a scientifically validated performance model.

## Accord Architecture

Accord plans are versioned JSON documents inside `design_briefs`, not separate
business tables. The default plan is Material-free, groups confirmed taxonomy
targets into bounded functional roles and phases, and supports edit, add,
remove, save and reload. “Develop This Accord” produces
`ACCORD_FORMULATION`; “Build Complete Formula” performs one global formulation
over confirmed accord targets.

## Experience and authority

The existing NØX shell and design tokens remain authoritative. The module uses
dynamic OSMO taxonomy, editable Human Intent Review, private source-asset
provenance with manual fallback, server-side candidate retrieval, candidate
comparison, read-only Material Peek, explicit Freeze confirmation and G5
handoff. Actor, tenant, entitlement and permissions come only from the G2
authenticated RequestContext. Browser-supplied identities, permissions and
Material candidate IDs have no authority.

Required G2 audit actions are:

- `project.created`
- `brief.updated`
- `intent.confirmed`
- `accord.plan.saved`
- `formula.generated`
- `formula.frozen`
- `formula.approved`

## NØX-OE degraded boundary

NØX-OE is optional. A valid checkpoint checksum alone cannot produce `READY`;
readiness also requires a schema-bound smoke-verified inference adapter. Random
weights and padded pseudo-feature inference are forbidden. When deployment or a
validated model is unavailable, Design Studio remains operational as
`CURATED_ONLY` and reports the scientific limitation without fabricating output.
Derived artifacts live only in `scientific_runtime.scientific_artifacts`.

## Acceptance and freeze

Final freeze requires one immutable source state with:

- repository validation and migration replay passing;
- Python scientific contract tests passing in CI;
- authenticated exact-SHA Preview Formula and Accord workflows passing;
- exact-SHA Staging migrations and acceptance passing under repository policy;
- all Gate 4 DoD 21.1–21.10 items passing;
- Production promotion, migration and data mutation all remaining `NO`.

Only the SHA-bound acceptance artifact may assert:

```text
GATE_4_STATUS=FROZEN
GATE_4_DOD=PASS
NEXT_GATE=G5 — TRIAL & SENSORY
```

No Production deployment, migration or data mutation is authorized by Gate 4.
