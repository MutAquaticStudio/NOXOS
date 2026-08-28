# NØX-OS Gate 1 evidence manifest

**Status:** `PARTIAL — provider bootstrap and live acceptance required`  
**Purpose:** This register separates source-level evidence from live cloud evidence. A field
is never treated as `PASS` merely because its automation exists.

The canonical G1 document records the path to the current external per-SHA evidence artifact.
This repository register intentionally carries no mutable deployment SHA, run, or provider
failure identity: an immutable source commit cannot be its own final execution record.

## Immutable input evidence

| Input           | Status | Evidence                                                                                                                                                                          |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Architecture | PASS   | Read in full; SHA-256 `02dcb885dcce4f7ea0842e05f3cb35d981cc8375eaebb159c3ac56cb17c83606` is protected by `contracts/frozen-inputs.json` and `pnpm contracts:check-frozen-inputs`. |
| UX/UI Guideline | PASS   | Read in full; SHA-256 `790b2a26d395bcf5007599a084c5c16b1c65927d552b53a2a4ed2f2e7d7580b9` is protected by the same deterministic check.                                            |
| G0 acceptance   | PASS   | Canonical G0 record states `GATE_0_STATUS: FROZEN` and `GATE_0_DOD: PASS`.                                                                                                        |

## Source-level evidence

| Control                                                                            | Status                    | Evidence                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository foundation, module registry, routes, UX shell, API, scientific boundary | PASS                      | Automated architecture, registry, UX-contract, integration, security, and browser tests in `tests/`.                                                                                                                              |
| Performance foundation                                                             | PASS                      | Lazy module routes; 350 kB Vite warning; 8-second API response budget; 10-second Vercel Function cap; 5/10/60-second serverless Postgres connection policy.                                                                       |
| Source verification commands                                                       | PASS                      | `pnpm typecheck`, `pnpm test` (48 tests), `pnpm build`, `pnpm test:e2e` (6 browser tests), `pnpm contracts:check-frozen-inputs`, `pnpm db:validate`, `pnpm infra:check`, and `pnpm secrets:scan`.                                 |
| Remote foundation CI                                                               | Per-SHA evidence required | Each source SHA must independently pass `foundation`, `browser-foundation`, and `cloud-migration-replay`; the current external artifact records the matching run. None is deployment evidence or reusable for a later source SHA. |
| Vercel Git deployment                                                              | FAIL                      | No successful real Preview has supplied shell, health, source-SHA, or provider read-back evidence. The current deployment identity is recorded only in the external per-SHA artifact.                                             |
| Supabase resource identity                                                         | PASS                      | `nox-os-staging` (`uyfddpmbszjkhdkqvncz`) and `nox-os-production` (`soioshmcdwxhlgrjzkoc`) are distinct `ACTIVE_HEALTHY` projects in `ap-southeast-2`; their database hosts differ.                                               |

## SHA-binding rule

Every cloud execution must record its own immutable `GITHUB_SHA`/deployment SHA in the
GitHub run and provider read-back. This file is a durable status register, not a substitute for
that per-run artifact. A Preview or Staging result is valid only when its expected SHA, deployed
SHA, CI run, deployment identity, and probe evidence all refer to the same source state.

## Non-PASS / non-NONE conditions requiring per-SHA evidence

| Field                                       | Current status           | Exact evidence or reason                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TECHNICAL_DECISIONS_FROZEN`                | NOT_VERIFIABLE           | Durable workflow provider/adapter and provider region strategy require a live verified Staging probe; the current HTTPS adapter is only a provider-neutral foundation.                                                                                |
| `VERCEL_PROJECT`                            | HUMAN_ACTION_REQUIRED    | Git integration identifies `nox-os` (`prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx`), but Codex has no authorized Vercel project/configuration/log read access. The owner must authorize it and choose custom Staging or the documented Git-ref-bound equivalent. |
| `VERCEL_PREVIEW`                            | FAIL                     | No real Preview has supplied a usable URL, shell, health check, or SHA read-back. The current failed deployment identity is in the external per-SHA artifact.                                                                                         |
| `SUPABASE_POSTGRES`                         | NOT_VERIFIABLE           | Distinct active NØX-OS Staging and Production projects exist, but no protected runtime connection or application DB probe has run.                                                                                                                    |
| `SUPABASE_MIGRATIONS`                       | NOT_VERIFIABLE           | Cloud replay passes, but selected Staging has no migration history and no protected CI migration apply/history/drift run.                                                                                                                             |
| `SUPABASE_STORAGE_PRIVATE`                  | FAIL                     | Both selected projects report zero Storage buckets/objects; private bucket provisioning and diagnostic lifecycle have not run.                                                                                                                        |
| `WORKFLOW_FOUNDATION`                       | NOT_VERIFIABLE           | Port, retry, idempotency, and correlation tests pass; no selected durable provider has completed the deployed API-to-workflow probe.                                                                                                                  |
| `CLOUDFLARE_DNS`                            | HUMAN_ACTION_REQUIRED    | Cloudflare account/zone authorization has not been connected for DNS-only public host read-back.                                                                                                                                                      |
| `CLOUDFLARE_TURNSTILE_FOUNDATION`           | NOT_VERIFIABLE           | Server-side verification contract is tested, but no Cloudflare widget/configuration is read back.                                                                                                                                                     |
| `CLOUDFLARE_ACCESS_FOUNDATION`              | NOT_VERIFIABLE           | Access/RBAC separation is tested, but no privileged Access application/policy is read back.                                                                                                                                                           |
| `PREVIEW_PRODUCTION_ISOLATION`              | NOT_VERIFIABLE           | Secretless Preview policy is implemented; provider environment/read-back must prove no prohibited credentials are scoped to ordinary PR Preview.                                                                                                      |
| `STAGING_PRODUCTION_ISOLATION`              | NOT_VERIFIABLE           | Fail-closed identity/fingerprint scripts exist; protected Staging and Production resource/credential fingerprints have not been configured or compared.                                                                                               |
| `STAGING_DEPLOY_AUTOMATION`                 | NOT_VERIFIABLE           | Versioned workflow exists but cannot run without protected GitHub environment configuration and provider authorization.                                                                                                                               |
| `EXACT_SHA_VERIFICATION`                    | NOT_VERIFIABLE           | No live Preview or Staging provider deployment has returned a matching immutable SHA.                                                                                                                                                                 |
| `SECURITY_BASELINE`                         | NOT_VERIFIABLE           | Source-level negative tests pass; live private storage, Cloudflare Access, and protected-environment contamination probes are pending.                                                                                                                |
| `OBSERVABILITY_BASELINE`                    | NOT_VERIFIABLE           | Structured logs and local correlation tests pass; deployed API-to-workflow correlation has not been observed.                                                                                                                                         |
| `MANUAL_VERCEL_ROUTINE_ACTION_REQUIRED`     | NOT_VERIFIABLE           | Cannot be confirmed until one-time Vercel bootstrap completes and the automated path runs.                                                                                                                                                            |
| `MANUAL_SUPABASE_ROUTINE_ACTION_REQUIRED`   | NOT_VERIFIABLE           | Cannot be confirmed until the selected isolated NØX-OS Staging project has completed the automated migration and probe path.                                                                                                                          |
| `MANUAL_CLOUDFLARE_ROUTINE_ACTION_REQUIRED` | NOT_VERIFIABLE           | Cannot be confirmed until Cloudflare configuration automation runs against the selected account/zone.                                                                                                                                                 |
| `GATE_1_STATUS` / `GATE_1_DOD` / `G2_READY` | NOT_PASS / NOT_PASS / NO | Blocking live Preview, Staging, provider-isolation, exact-SHA, workflow, storage, and Cloudflare evidence is absent. Freeze is prohibited.                                                                                                            |

## Minimal external actions needed

1. Authorize the NØX-OS Vercel project, its read-only deployment lookup, Firewall read-back,
   and the approved Staging pattern; keep ordinary Git PR Preview secretless.
2. Configure protected GitHub/CI bindings for the selected distinct NØX-OS Supabase Staging and
   Production resources so the versioned migration, private-bucket provisioning, and probes run
   automatically; do not perform a dashboard/SQL workaround.
3. Authorize the scoped Cloudflare account/zone for DNS-only public routing, Turnstile, and a
   separately approved privileged Access application/policy.
4. Configure GitHub Actions protected environments/variables/secrets and an immutable read-only
   canonical-input source without placing secrets in chat.
5. Select and probe a durable workflow provider through the existing `WorkflowLauncher` port.

No password, API token, service key, database password, or personal access token is requested
in this manifest or in chat.
