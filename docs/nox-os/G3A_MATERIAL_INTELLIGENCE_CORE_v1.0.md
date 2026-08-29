# NØX-OS G3-A — Material Intelligence Core v1.0

**Status:** G3-A implementation contract; G3-B experience and Gate 3 closure remain pending.

## Ownership and persistence

Material Intelligence owns the canonical Material aggregate. Its private
`material_intelligence` PostgreSQL schema contains exactly these eight tables:

1. `materials`
2. `chemical_entities`
3. `material_identifiers`
4. `material_properties`
5. `material_odor_assignments`
6. `material_concentrates`
7. `material_components`
8. `material_change_requests`

All Material audit evidence reuses the G2 append-only
`platform.audit_events` table. The schema is unavailable to Supabase browser
roles; `nox_app_runtime` reaches it only through the application API.

`material_id` is the sole durable downstream reference. G4 and G5 must not
use display name, CAS, FEMA, INCI, or ChemicalEntity identifiers as a business
foreign key.

## Taxonomy provenance

`taxonomy/osmo/1.2.json` is the unchanged upstream Osmo Scent Taxonomy v1.2,
pinned to source commit `fcd538b578e0a3c6261503380de03d0691b47344`. It is
licensed by Osmo, Inc. under ODbL v1.0; its source and attribution notice are
kept alongside the data. Every odor assignment records its taxonomy version,
so later taxonomy revisions cannot remap prior assignments.

## Snapshot canonicalization

`MaterialIntelligenceSnapshot` has `schemaVersion: 1`. Its SHA-256
`snapshotHash` is computed from a canonical, key-sorted semantic payload:
Material fields, CAS/FEMA/INCI, physical/reference properties, odor
assignments, dilution, components, and (only for authorized internal callers)
ChemicalEntity scientific data. Arrays are sorted deterministically.

The semantic hash excludes `capturedAt`, `snapshotHash`, request/correlation
identifiers, and reviewer UI state. Tenant serialization always removes
`scientificInternal`. Snapshots are current read models, not a Material history
or revision store.

## Explicit G3-A boundary

G3-A provides backend domain/API contracts and targeted tests only. It does
not add final Material UX, Formula, FormulaVersion, Trial, Sensory, Inventory,
Production, Scientific Runtime, Preview, Staging, merge, or Production work.
