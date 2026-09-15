# UI v3 narrow G4 creation amendment

Status: IMPLEMENTED, PostgreSQL execution evidence PENDING.
Authorization: user approved the explicitly requested narrow G4 Project/Brief
creation replay + atomic audit hardening. This does not reopen other Gate behavior
or authorize deployment. Frozen G0/UX/Gate documents are not rewritten.

## Scope and contract

Only these existing commands are amended:

- `POST /api/v1/design-studio/projects`
- `POST /api/v1/design-studio/projects/:projectId/briefs`

Both accept optional UUID `operationKey` in the existing JSON body. The v3
authoring UI supplies it. Old callers omitting it retain create-on-each-call
semantics, but now also receive atomic creation/audit. No new endpoint is added.

For keyed requests, uniqueness is scoped to command/table + tenant + actor + key.
The same scoped key and normalized creation payload returns the same entity ID
without inserting another audit event. A changed payload (including another
Brief parent Project) returns `409 IDEMPOTENCY_KEY_CONFLICT`.
Every HTTP attempt still passes current G2 authorization/module checks first;
the key is not authorization. Other tenants/actors cannot retrieve an entity by
guessing its creation key.

Replay guarantees the creation effect and stable identity, not byte-identical
historical HTTP responses. The returned DTO is the existing object's current
state; replay does not undo later edits, confirmation or archival. The historical
creation fingerprint is never recomputed from the edited row. HTTP 201 remains
compatible with existing consumers. A response is not authority to skip later
server transition guards.

## Minimal persistence

The append-only migration adds nullable `creation_key` and
`creation_payload_hash` columns to the two existing G4 tables, with scoped unique
constraints and key/hash pairing checks. No new table, generic operation ledger,
queue, lock service, dependency, provider, or duplicate domain truth.

The fingerprint is SHA-256 over canonical object-key-ordered creation input.
Tracing IDs and operation keys are excluded. Array order is preserved. Raw Brief
contents are not copied into audit metadata or another persistence record.
The key lasts with the entity; normal G4 UI workflows do not hard-delete it.

`INSERT ... ON CONFLICT DO NOTHING` uses PostgreSQL unique-index arbitration.
The losing request reads the committed winner and compares the fingerprint.
Both insertion and the existing canonical audit action run on the same postgres.js
transaction connection. Any audit failure rolls back the new entity and key.
No new audit event/action type and no runtime privilege expansion.

References: [PostgreSQL conflict handling](https://www.postgresql.org/docs/current/sql-insert.html),
[postgres.js transactions](https://github.com/porsager/postgres#transactions).

## Client retry boundary

The G4 component retains separate Project and Brief keys in memory for the same
payload/tenant. Lost responses retain keys for explicit retry. A Brief-only edit
changes its key but retains the Project key. A new workflow or tenant remount
starts a new intent. A full page reload loses in-memory intent; this is not a
cross-session saved-draft/recovery system. No raw Brief is persisted to browser
storage and no failed command is automatically retried.

## Rollout and verification

Apply the additive migration before deploying the new server/client. Old rows
remain unchanged. Rolling back code needs no destructive schema rollback, but
old code does not provide the new atomicity guarantee.

- API tests: replay identity, changed-payload conflict, scope/permissions,
  invalid key, trace propagation, and failure propagation.
- Browser fixture: lost Project response, lost Brief response, retry with same
  keys, edited Brief with new key and retained Project key.
- Real PostgreSQL suite: concurrent Project/Brief retries, one audit per creation,
  scope isolation, payload/parent conflict, FK denial, audit-failure rollback and
  successful retry. Added to the existing cloud migration replay job after reset.
  It refuses non-loopback URLs and uses disposable fixtures with restricted
  `current_user=nox_app_runtime` for store operations.

No local PostgreSQL/Docker was available during this implementation. Skipped real
DB tests are NOT PASS. Do not mark the affected v3 mutation manifest READY or
certify deployed atomicity until that cloud suite succeeds for the candidate SHA.
Production, remote migrations, provider state, Git commits/pushes and deployments
were not changed by this implementation.
