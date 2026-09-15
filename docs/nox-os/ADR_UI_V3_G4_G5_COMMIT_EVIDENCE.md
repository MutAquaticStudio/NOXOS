# UI v3 — narrow G4/G5 commit evidence and revision replay

Status: implemented; PostgreSQL execution evidence pending. User explicitly
authorized this patch. No business authority transfer, migration, dependency,
provider operation or Production mutation.

## Boundaries

- G4 continues to approve FormulaVersion; G5 owns Trial/evaluation evidence.
- API permission and evidence checks remain. The PostgreSQL approval transaction
  additionally calls the G5-owned database read seam, holding Trial/evaluation
  SHARE locks until commit. The shared G5 predicate requires the exact tenant,
  Trial, FormulaVersion, COMPLETED Trial, FINAL decision and finalization timestamp.
- Approval update and audit remain atomic. Concurrent duplicate approval changes
  zero rows after the first commit and does not insert another audit. Existing
  duplicate-transition API behavior is preserved (not silently converted to 200).
- Revision candidate generation remains unpersisted. `recordRevisionRequest`
  serializes on the existing Trial, rechecks FINAL REVISION_REQUIRED evidence and
  records `revision.requested` once per tenant/evaluation. It introduces no job,
  persisted candidate or revision-request table.
- Revision Freeze keeps the existing parent Formula lock. Under that lock it
  rechecks G5 evidence and looks for the existing atomic `formula.generated`
  audit for **tenant + parent version + Trial + evaluation + strategy**. The same
  candidate payload returns the existing frozen revision; another payload returns
  `409 IDEMPOTENCY_KEY_CONFLICT`. Different strategies remain separate candidates.
  A new physical Trial/evaluation remains a separate revision intent.
- The payload hash includes the candidate except snapshot retrieval `capturedAt`;
  Material snapshot hash, source update time, composition and engine remain bound.
  Material revalidation remains fail-closed even on replay. A changed Material may
  therefore reject a retry; the existing version remains readable via its route.
- Historical matching audits without the new payload hash, or ambiguous duplicates,
  fail closed. No historical evidence is rewritten or inferred. A replay result
  must also match the parent Formula/version and strategy.

## Verification scope

`tests/unit/trial-final-evidence.test.ts` checks the shared evidence predicate.
The existing Trial API journey now checks repeated candidate request/audit behavior.
`packages/database/src/design-studio-evidence.postgres.test.ts` is wired into the
existing disposable cloud migration-replay job and covers invalid/foreign evidence,
lock lifetime, approval rollback/concurrency, revision concurrency/payload conflict,
revision rollback and request-audit deduplication. Commands run as nox_app_runtime;
fixture setup uses only the disposable loopback database. Immutable fixtures remain
until the existing CI database teardown. No live project is accepted by this probe.

Local unit/API evidence is not proof of PostgreSQL locking or authenticated release
behavior. DS-04 stays BLOCKED until those probes and remaining manifest/capability
acceptance actually pass. No full UI v3 completion is declared by this ADR.
