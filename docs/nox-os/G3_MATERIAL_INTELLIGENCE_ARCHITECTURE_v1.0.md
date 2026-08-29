# NØX-OS — Gate 3 Material Intelligence Architecture v1.0

**Status:** `DRAFT — freezes only through SHA-bound Staging evidence`
**G3-A baseline:** `7f6e75a868672af1d8eb9a26923ee598dce29187`

## Authority and boundary

Gate 3 consumes the frozen G2 identity, tenant, RBAC, audit, Module Registry,
React/Vite shell, Vercel Functions, and Supabase PostgreSQL foundation. It owns
canonical Material truth only. Formula and FormulaVersion belong to G4; Trial
and Sensory belong to G5. No browser code reads Supabase Material tables
directly.

The private `material_intelligence` schema remains exactly the eight G3-A
tables: `materials`, `chemical_entities`, `material_identifiers`,
`material_properties`, `material_odor_assignments`, `material_concentrates`,
`material_components`, and `material_change_requests`. Material history is a
read projection of G2 `platform.audit_events`; no Material history, revision,
or snapshot table is introduced.

## Experience contract

The canonical product routes are `/materials`, `/materials/new`,
`/materials/:materialId`, `/materials/review`,
`/materials/review/:requestId`, `/platform/material-intelligence/review`, and
`/platform/material-intelligence/review/:requestId`. The old
`/material-intelligence` route may only redirect to `/materials`; it cannot
render a parallel registry.

Material Intelligence consumes the existing NØX Shell, compact registry
profile, tokens, table pattern, forms, dialogs, notifications, responsive
primitives, and accessibility behavior. It creates no alternate shell, theme,
density system, data-grid package, or generic workflow engine.

The Registry uses server-side PostgreSQL search for name, CAS, FEMA, INCI,
Material type, approval state, scope, visibility, note classification, and a
pinned taxonomy term. URL query state represents filtering and pagination.
Rows open the route-based Material Detail Workspace.

Tenant detail responses never include ChemicalEntity fields. A same-tenant
viewer may see the permitted contributor display name; a cross-tenant shared
viewer receives only `Shared by <Tenant Name>`. Dilutions are structured,
mass-based source/concentration/solvent records without a basis selector.
Natural and Mixture composition is optional and is not presented as a complete
formula when partial or absent.

Creation always creates a pending, governed request. Identity matches are
checked before submission, with an explicit choice to open an existing Material
or continue a distinct submission. Approved changes and sharing are submitted
through the existing change-request transition; no UI action writes canonical
truth directly. TGSC is a server-side optional reference adapter: unavailable
providers surface an unavailable state and never supply fabricated data.

## Authority and downstream handoff

Module actions use the G2 context and Material module permissions. Tenant
approvers resolve only Tenant Material requests. Platform Material correction
review lives in the existing Platform Control Plane and requires its existing
Platform module permissions; Platform authority still uses the same governed
transition and audit transaction.

`MaterialIntelligenceSnapshot` remains the structured G4 handoff: stable
`material_id`, type, approval/access state, identifiers, physical/reference
data, Osmo assignments/version, dilution, known components, snapshot hash, and
authorized-internal ChemicalEntity data. G4 never needs display-name parsing or
direct browser database access. G5 never mutates Material canonical truth.

## Freeze and evidence rule

This source document stays `DRAFT` until one merged-main SHA completes the
authoritative G3 Staging workflow. The workflow must upload a
`g3-staging-evidence-<SHA>` artifact and create an annotated acceptance tag at
that same SHA. That artifact, rather than a later source commit, is the final
Gate status record.

## Definition of Done

Every item is blocking and must be individually `PASS` for the accepted SHA.

| #   | Requirement                                    | Required evidence                            |
| --- | ---------------------------------------------- | -------------------------------------------- |
| 01  | Authorized user finds Material                 | Registry API and authenticated browser       |
| 02  | Tenant user creates Material                   | Browser and API journey                      |
| 03  | Four Material types preserve semantics         | targeted integration and Staging probes      |
| 04  | Physical/reference data is structured          | DTO and UI/API acceptance                    |
| 05  | Osmo taxonomy is pinned, versioned, and usable | taxonomy API and validation test             |
| 06  | Dilution is structured without name parsing    | API and browser acceptance                   |
| 07  | Natural/Mixture optional components work       | targeted integration acceptance              |
| 08  | ChemicalEntity is internal only                | tenant DTO security test                     |
| 09  | Tenant review preserves Platform truth         | authority denial and review tests            |
| 10  | Platform Owner resolves global correction      | authenticated browser/API journey            |
| 11  | Cross-tenant contributor privacy holds         | shared DTO and Staging matrix                |
| 12  | History reuses G2 AuditEvent                   | Material history read-model test             |
| 13  | Pending Material is downstream ineligible      | domain acceptance                            |
| 14  | Approved accessible Material is eligible       | domain acceptance                            |
| 15  | G4 snapshot handoff is complete                | G3-A snapshot evidence and direct regression |
| 16  | Final PR CI passes                             | exact CI run                                 |
| 17  | Final Preview exact SHA passes                 | Vercel read-back                             |
| 18  | Authenticated Preview acceptance passes        | real browser/Auth evidence                   |
| 19  | Merge passes                                   | merged-main SHA                              |
| 20  | Persistent Staging acceptance passes           | authoritative workflow artifact              |
| 21  | Staging exact SHA passes                       | deployment read-back                         |
| 22  | Tenant User A journey passes                   | authenticated Staging fixture                |
| 23  | Tenant Approver A journey passes               | authenticated Staging fixture                |
| 24  | Tenant B sharing/isolation passes              | authenticated Staging fixture                |
| 25  | Platform Owner journey passes                  | authenticated Staging fixture                |
| 26  | Production remains untouched                   | workflow and provider evidence               |
| 27  | No undocumented G3-A redesign occurred         | source and migration review                  |
| 28  | No G4/G5 scope was implemented                 | source review                                |

Only the evidence artifact may assert `GATE_3_STATUS=FROZEN`,
`GATE_3_DOD=PASS`, and `G4_READY=YES`.
