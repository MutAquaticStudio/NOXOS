# NØX-OS Gate 1 evidence manifest

**Status:** `PARTIAL — provider bootstrap and live acceptance required`  
**Purpose:** This register separates source-level evidence from live cloud evidence. A field
is never treated as `PASS` merely because its automation exists.

## Immutable input evidence

| Input           | Status | Evidence                                                                                                                                                                          |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Architecture | PASS   | Read in full; SHA-256 `02dcb885dcce4f7ea0842e05f3cb35d981cc8375eaebb159c3ac56cb17c83606` is protected by `contracts/frozen-inputs.json` and `pnpm contracts:check-frozen-inputs`. |
| UX/UI Guideline | PASS   | Read in full; SHA-256 `790b2a26d395bcf5007599a084c5c16b1c65927d552b53a2a4ed2f2e7d7580b9` is protected by the same deterministic check.                                            |
| G0 acceptance   | PASS   | Canonical G0 record states `GATE_0_STATUS: FROZEN` and `GATE_0_DOD: PASS`.                                                                                                        |

## Source-level evidence

| Control                                                                            | Status                          | Evidence                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository foundation, module registry, routes, UX shell, API, scientific boundary | PASS                            | Automated architecture, registry, UX-contract, integration, security, and browser tests in `tests/`.                                                                                                                                    |
| Performance foundation                                                             | PASS                            | Lazy module routes; 350 kB Vite warning; 8-second API response budget; 10-second Vercel Function cap; 5/10/60-second serverless Postgres connection policy.                                                                             |
| Source verification commands                                                       | PASS                            | `pnpm typecheck`, `pnpm test` (47 tests), `pnpm build`, `pnpm test:e2e` (6 browser tests), `pnpm contracts:check-frozen-inputs`, `pnpm db:validate`, `pnpm infra:check`, and `pnpm secrets:scan`.                                       |
| Latest remote foundation CI                                                        | PASS for its immutable SHA only | GitHub Actions run `33136145538` passed `foundation`, `browser-foundation`, and `cloud-migration-replay` for `c6dc5aabb354b699f1b57e6ea3f60f9da41c9bf1`. This is not deployment evidence and must not be reused for a later source SHA. |

## SHA-binding rule

Every cloud execution must record its own immutable `GITHUB_SHA`/deployment SHA in the
GitHub run and provider read-back. This file is a durable status register, not a substitute for
that per-run artifact. A Preview or Staging result is valid only when its expected SHA, deployed
SHA, CI run, deployment identity, and probe evidence all refer to the same source state.

## Current non-PASS / non-NONE fields

| Field                                       | Current status           | Exact evidence or reason                                                                                                                                                             |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TECHNICAL_DECISIONS_FROZEN`                | NOT_VERIFIABLE           | Durable workflow provider/adapter and provider region strategy require a live verified Staging probe; the current HTTPS adapter is only a provider-neutral foundation.               |
| `VERCEL_PROJECT`                            | HUMAN_ACTION_REQUIRED    | No connected authorized Vercel project can be queried. The owner must authorize project/read access and choose custom Staging or the documented Git-ref-bound equivalent.            |
| `VERCEL_PREVIEW`                            | NOT_VERIFIABLE           | No authenticated provider deployment detail exists for the candidate source SHA and exact project/Preview target/ref.                                                                |
| `SUPABASE_POSTGRES`                         | HUMAN_ACTION_REQUIRED    | `NOX Studio` is accessible, but no existing project is authorized for NØX-OS reuse. A new isolated NØX-OS non-production resource needs organization, region, and cost confirmation. |
| `SUPABASE_MIGRATIONS`                       | NOT_VERIFIABLE           | Cloud replay passes, but no NØX-OS staging project exists for migration apply/history/drift evidence.                                                                                |
| `SUPABASE_STORAGE_PRIVATE`                  | NOT_VERIFIABLE           | The private FileStore implementation exists, but a bucket read-back and put/stat/read/delete probe have not run on a NØX-OS resource.                                                |
| `WORKFLOW_FOUNDATION`                       | NOT_VERIFIABLE           | Port, retry, idempotency, and correlation tests pass; no selected durable provider has completed the deployed API-to-workflow probe.                                                 |
| `CLOUDFLARE_DNS`                            | HUMAN_ACTION_REQUIRED    | Cloudflare account/zone authorization has not been connected for DNS-only public host read-back.                                                                                     |
| `CLOUDFLARE_TURNSTILE_FOUNDATION`           | NOT_VERIFIABLE           | Server-side verification contract is tested, but no Cloudflare widget/configuration is read back.                                                                                    |
| `CLOUDFLARE_ACCESS_FOUNDATION`              | NOT_VERIFIABLE           | Access/RBAC separation is tested, but no privileged Access application/policy is read back.                                                                                          |
| `PREVIEW_PRODUCTION_ISOLATION`              | NOT_VERIFIABLE           | Secretless Preview policy is implemented; provider environment/read-back must prove no prohibited credentials are scoped to ordinary PR Preview.                                     |
| `STAGING_PRODUCTION_ISOLATION`              | NOT_VERIFIABLE           | Fail-closed identity/fingerprint scripts exist; protected Staging and Production resource/credential fingerprints have not been configured or compared.                              |
| `STAGING_DEPLOY_AUTOMATION`                 | NOT_VERIFIABLE           | Versioned workflow exists but cannot run without protected GitHub environment configuration and provider authorization.                                                              |
| `EXACT_SHA_VERIFICATION`                    | NOT_VERIFIABLE           | No live Preview or Staging provider deployment has returned a matching immutable SHA.                                                                                                |
| `SECURITY_BASELINE`                         | NOT_VERIFIABLE           | Source-level negative tests pass; live private storage, Cloudflare Access, and protected-environment contamination probes are pending.                                               |
| `OBSERVABILITY_BASELINE`                    | NOT_VERIFIABLE           | Structured logs and local correlation tests pass; deployed API-to-workflow correlation has not been observed.                                                                        |
| `MANUAL_VERCEL_ROUTINE_ACTION_REQUIRED`     | NOT_VERIFIABLE           | Cannot be confirmed until one-time Vercel bootstrap completes and the automated path runs.                                                                                           |
| `MANUAL_SUPABASE_ROUTINE_ACTION_REQUIRED`   | NOT_VERIFIABLE           | Cannot be confirmed until an isolated NØX-OS project is created and migration automation runs.                                                                                       |
| `MANUAL_CLOUDFLARE_ROUTINE_ACTION_REQUIRED` | NOT_VERIFIABLE           | Cannot be confirmed until Cloudflare configuration automation runs against the selected account/zone.                                                                                |
| `GATE_1_STATUS` / `GATE_1_DOD` / `G2_READY` | NOT_PASS / NOT_PASS / NO | Blocking live Preview, Staging, provider-isolation, exact-SHA, workflow, storage, and Cloudflare evidence is absent. Freeze is prohibited.                                           |

## Minimal external actions needed

1. Authorize the NØX-OS Vercel project, its read-only deployment lookup, Firewall read-back,
   and the approved Staging pattern; keep ordinary Git PR Preview secretless.
2. Select a new isolated NØX-OS Supabase resource in `NOX Studio`, choose its region, review
   the provider cost, and approve creation; do not reuse unrelated projects.
3. Authorize the scoped Cloudflare account/zone for DNS-only public routing, Turnstile, and a
   separately approved privileged Access application/policy.
4. Configure GitHub Actions protected environments/variables/secrets and an immutable read-only
   canonical-input source without placing secrets in chat.
5. Select and probe a durable workflow provider through the existing `WorkflowLauncher` port.

No password, API token, service key, database password, or personal access token is requested
in this manifest or in chat.
