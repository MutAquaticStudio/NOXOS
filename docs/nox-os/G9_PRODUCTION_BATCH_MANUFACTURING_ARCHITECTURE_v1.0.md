# NØX-OS Gate 9 — Production & Batch Manufacturing

Status: DRAFT (implementation candidate)

## Authority and boundaries

G9 consumes the immutable, approved `FULL_FORMULA` and its Bundle Hash from
G4, the current effective `READY` assessment from G6, and lot/reservation
authority from G7. It does not duplicate Formula, readiness, inventory, QC or
finished-goods truth. Production is a tenant-scoped module at `/production`.

The physical invariant is **one Production Order → one started Production
Batch**. Drafting never consumes stock. Release atomically creates G7
`PRODUCTION` reservations without changing On Hand. Start revalidates current
G6 readiness and atomically consumes the exact active reservations. Abort does
not return stock; Complete records actual output only. QC remains
`NOT_ASSESSED` and belongs to G10.

## Persistence

The private `production` schema contains exactly four tables:

1. `production.production_orders`
2. `production.production_order_lines`
3. `production.production_material_allocations`
4. `production.production_batches`

G2 `platform.audit_events` is the audit authority. G7 inventory tables remain
the stock, reservation and movement authority. No finished-goods or QC table
is introduced in G9.

## Provider contracts

- G4: `scaleFormulaMasses` and frozen snapshot hashes.
- G6: read-only `ProductionReadinessSource`, which returns RESOLVED,
  MISSING, or AMBIGUOUS; missing/ambiguous/non-READY is fail-closed.
- G7: typed `ProductionInventoryPort`; reservations and movements use
  `source_module=PRODUCTION` and allocation IDs as provenance.
- Runtime region remains the accepted G1/G8 Sydney strategy (`syd1` +
  `ap-southeast-2`).

## State transitions

`DRAFT → RELEASED → IN_PROGRESS → COMPLETED`, with `DRAFT → CANCELLED`,
`RELEASED → CANCELLED`, and `IN_PROGRESS → ABORTED`. There is no reopen and a
second START cannot create another batch or consumption set.

## API surface

The API is namespaced under `/api/v1/production` and exposes order listing,
creation, planning, allocation, release, cancel, start, complete, abort and
batch trace reads. The server derives actor/tenant context and Formula/G6/G7
truth; the browser supplies no provenance, readiness, balance or requirement
values.

## G9 freeze criteria

G9 freezes only after targeted tests, one final CI run, exact-SHA Preview and
exact-SHA Staging acceptance prove the complete G9 DoD. Production deployment,
migrations and data mutation remain forbidden.
