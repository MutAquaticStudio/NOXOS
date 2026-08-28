# NØX-OS Gate 1 — Cloud Engineering Foundation Architecture Contract

**Document version:** 1.0  
**Lifecycle:** controlled candidate; the immutable acceptance tag is the release-status authority.  
**Gate:** G1 — Cloud Engineering Foundation & Module System

## Authority and freeze model

This is the canonical G1 architecture contract. The frozen G0 Architecture Contract and
the frozen UX/UI Guideline are inputs, not editable by G1. Cloud CI receives only encrypted,
checksum-verified mirrors of those inputs.

The source document is intentionally not rewritten after Staging acceptance. The authoritative
freeze record is the annotated tag `g1-staging-accepted-<main-sha>` plus its SHA-bound GitHub
Actions evidence artifact. That tag is valid only when it records:

```text
GATE_1_DOCUMENT_VERSION=1.0
GATE_1_STATUS=FROZEN
GATE_1_DOD=PASS
G2_READY=YES
PRODUCTION_PROMOTION_PERFORMED=NO
```

Any source change creates a new candidate SHA and invalidates earlier Preview and Staging
evidence for freeze purposes.

## Frozen technical decisions

| Area                | Decision                                                          |
| ------------------- | ----------------------------------------------------------------- |
| Runtime             | Node 24.x and pnpm 11.19.0                                        |
| Web                 | React 19.2.8, Vite 8.2.2, TypeScript 7.0.2, React Router 7.18.2   |
| API                 | Raw Vercel Node Functions at `/api/v1/*`; no Next.js or Nitro     |
| Validation and data | Zod 4.4.3; postgres.js 3.4.9 over Supavisor transaction pooling   |
| Quality             | Vitest 4.1.11, Playwright 1.62.1, ESLint 10.9.1, Prettier 3.9.6   |
| Provider tooling    | Vercel CLI 59.9.1, Supabase CLI 2.116.0                           |
| Workflow            | `@vercel/queue@0.5.1` behind the internal `WorkflowLauncher` port |
| Region              | Vercel server/queue `syd1`; Supabase `ap-southeast-2`             |

The modular monolith remains one repository, one primary Vercel application, one PostgreSQL
platform, and domain packages with enforced inward dependency boundaries. Provider SDK types
must not define domain contracts.

## Environment and provider boundaries

`PREVIEW`, `STAGING`, and `PRODUCTION` are distinct. Preview and Staging must never use
Production database, storage, privileged credentials, or secrets. Preview is secretless and
uses only a verified, non-production data-context identity. Staging uses separate limited
database roles: `nox_app_runtime` and `nox_workflow_runtime`; neither may be an owner,
superuser, role creator, database creator, replication-capable, or RLS-bypassing.

Storage identity is `(project_ref, bucket_id)`. The Staging bucket is private and must prove
public-read denial plus authorized put/stat/read/delete. Migration authority is exclusively
`supabase/migrations/*.sql`; breaking change safety is expand → compatible deploy → backfill →
verify → contract later.

Cloudflare public application DNS is DNS-only. The privileged ops hostname is proxied only for
the explicit Access boundary. Turnstile is server-verified anti-abuse infrastructure, and
Cloudflare Access is edge admission only; neither is NØX authentication, RBAC, entitlement, or
tenant authorization.

## Preview bootstrap amendment B-001

The privileged Preview workflow checks out only its trusted base revision while using provider
credentials. If that base verifier itself requires a compatibility repair, exactly one
bootstrap PR may merge with the obsolete Preview check bypassed by an administrator after all
non-provider checks pass. The PR must be limited to this contract/ADR, verifier compatibility,
attestation gating, and their tests.

The bootstrap Staging run must fail closed at accepted-Preview resolution before infrastructure
reconciliation, migrations, deployment, or data-plane probes. A normal, subsequent
acceptance-trigger PR must then pass the repaired Preview workflow and merge without bypass
before any Staging deployment may occur.

## Definition of Done

Every group is blocking and must be individually evidenced as `PASS` against the accepted SHA.

| Group                    | Required evidence                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------ |
| A. Frozen inputs         | G0 and UX read, checksum verified, unchanged                                         |
| B. Cloud-only            | No routine user-local operation; isolated cloud execution                            |
| C. Repository            | Green modular-monolith workspace and deterministic install/build                     |
| D. Dependencies          | Forbidden import-edge tests reject invalid dependencies                              |
| E. Module system         | Canonical registry and availability resolver validation                              |
| F. Routes                | Unique product/API namespaces; no engineering-gate route leakage                     |
| G. UX/UI                 | OS tokens, themes, density, shell and module-profile contract tests                  |
| H. Web                   | React/Vite shell, deep links, lazy routes, safe client configuration                 |
| I. API                   | `/api/v1/health` and `/api/v1/version`, request/error/context contracts              |
| J. PostgreSQL            | Pooling, limited roles, migration replay/history/drift, deployed probes              |
| K. Storage               | Private Staging bucket and full controlled diagnostic lifecycle                      |
| L. Durable workflow      | Queue delivery, retry, idempotency, correlation, workflow DB role                    |
| M. Scientific            | Gateway graceful degradation; never an ERP critical path                             |
| N. Cloudflare            | DNS-only public path, protected ops path, Turnstile and Access boundaries            |
| O. Environment isolation | Preview ≠ Staging ≠ Production and no credential contamination                       |
| P. CI/CD                 | Required checks, SHA-bound Preview attestation, automated Staging flow               |
| Q. Security              | Secret scan and negative boundary tests                                              |
| R. Observability         | Request/correlation traceability without sensitive payloads                          |
| S. Preview acceptance    | Real READY Vercel Preview, browser/API/isolation/exact-SHA proof                     |
| T. Staging acceptance    | Real automated Staging deployment and all provider/browser probes                    |
| U. Gate hygiene          | Evidence artifact, annotated acceptance tag, complete audit, no Production promotion |

Freeze is prohibited if a blocking group is `FAIL` or `NOT_VERIFIABLE`, if any architecture
P0/P1/P2 finding remains, or if the deployed Staging SHA differs from its expected main SHA.
