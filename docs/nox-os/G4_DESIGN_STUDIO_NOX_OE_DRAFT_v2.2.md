# NØX-OS Gate 4 — Design Studio + NØX-OE (Draft)

Status: `DRAFT — CANONICAL BLOCKERS REMAIN`

This document records the implementation contract for the complete Gate 4 v2.2 prompt. It does not freeze Gate 4 and does not supersede G0–G3.

## Source binding

| Source                                        | Version               | SHA-256                                                            |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------ |
| `nox_master_blueprint.md`                     | `2.0-FINAL CANONICAL` | `be765579803248e90b495e7d84e3d9c4f8b049fe44b5371a1fdb68123bfb3bae` |
| `G4_MASTER_EXECUTION_PROMPT_v2.2_COMPLETE.md` | `2.2-COMPLETE`        | `a1679b5d7ea291df2b529c10577c25ce9a686f7db83e566a4587ca494a034013` |

The prompt begin marker, end marker and `END_OF_FILE=TRUE` were verified before implementation. The machine-readable source binding lives in `contracts/g4-sources.json`.

## User-approved canonical amendments

1. Design Studio exposes exactly two primary modes: `FORMULA_GENERATION` and `ACCORD_ARCHITECTURE`.
2. Executable composition is stored and transported as positive integer milligram strings. The reference Formula is exactly `1,000,000 mg`.
3. Formula Generation produces `FAITHFUL`, `EXPRESSIVE` and one contextual direction. A constrained budget without a trusted CostResolver produces `MINIMALIST`, never a fabricated budget-efficient claim.
4. `TrialContext.targetMassMg` replaces decimal gram input at the G5 handoff contract.

## Implemented boundaries

- P0–P4 intent arbitration with explicit human confirmation.
- Canonical `osmo_v1.2` validation and unresolved-concept handling.
- Material-free Accord Architecture planning and explicit Accord development boundary.
- Approved/accessible Material evidence, structured dilution resolution and component checks.
- Deterministic integer-mg Formula synthesis, largest-remainder scaling and mass formatting.
- Versioned Formula perception scoring, preliminary known-limit states and `NOT_ASSESSED` release readiness.
- Deterministic Formula Bundle Hash and a persistence port for the future canonical Freeze transaction.
- Design Studio Module Registry authority, permissions and an accessible shell-native UI foundation.
- NØX-OE Python 3.11/FastAPI sidecar, RDKit boundary, 72/12 graph schema, five-layer AttentiveFP architecture, 256D embedding contract, 138 Descriptor-only head, checkpoint/label integrity validation and isolated `scientific_artifacts` writer.
- Server-only NØX-OE gateway with graceful core degradation.

## Fail-closed canonical blockers

### G4 persistence schema

No approved migrations or tables exist for Projects, Briefs, Formulas, Formula Versions, Formula Lines or `formula_frozen_snapshots`. The implementation therefore does not invent DDL. Formula Freeze and persisted G5 handoff remain blocked by `FORMULA_FROZEN_SNAPSHOT_SCHEMA_MISSING`.

No approved typed JSON Brief/document field exists for Accord Architecture. Accord plans remain non-canonical runtime results and report `ACCORD_PLAN_PERSISTENCE_UNSPECIFIED`.

### Blueprint migration namespace conflict

The required migration is preserved verbatim at `supabase/migrations/20260831150000_g3_g4_enhancements.sql`. It references unqualified `material_properties` and `materials`, while the frozen repository contract owns these tables under the private `material_intelligence` schema. Silently schema-qualifying or redesigning the source migration is forbidden. The migration must not be applied to Staging until the canonical authority approves a namespace-safe resolution.

### Scientific deployment

No approved NØX-OE deployment target or valid model checkpoint/138-label manifest exists. `NOX_OE_DEPLOYMENT=NOT_CONFIGURED`, `NOX_OE_MODEL_CHECKPOINT=UNAVAILABLE`, and random-weight inference is forbidden. Curated G3 taxonomy evidence remains operational.

## Production boundary

No Production deployment, migration or data mutation is authorized for Gate 4.
