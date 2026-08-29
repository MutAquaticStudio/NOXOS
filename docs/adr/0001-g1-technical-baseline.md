# ADR 0001: G1 technical baseline

## Status

Accepted. ADR 0003 amends this baseline for G1 v1.1 where the two documents conflict.

## Decisions

| Area             | Decision                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node 24.x, pnpm 11.19.0                                                                                                                                                            |
| Web              | React 19.2.8, Vite 8.2.2, TypeScript 7.0.2                                                                                                                                         |
| Frontend routing | React Router 7.18.2                                                                                                                                                                |
| API routing      | Internal typed router registered by the canonical Module Registry                                                                                                                  |
| API transport    | Raw Vercel Node Functions as thin adapters over internal dispatch; no Next.js or Nitro migration                                                                                   |
| Validation       | Zod 4.4.3                                                                                                                                                                          |
| Database client  | postgres.js 3.4.9 over Supavisor transaction pooling, prepared statements disabled; 5s connection, 10s idle, and 60s lifetime policy                                               |
| Database roles   | Separate `nox_app_runtime` and `nox_workflow_runtime` limited login roles; migration administration remains a separate connection                                                  |
| Tests            | Vitest 4.1.11 and Playwright 1.62.1                                                                                                                                                |
| Formatting/lint  | Prettier 3.9.6 and ESLint 10.9.1                                                                                                                                                   |
| Provider tooling | Vercel CLI 59.9.1 and Supabase CLI 2.116.0                                                                                                                                         |
| Workflow         | `@vercel/queue@0.5.1` behind `WorkflowLauncher`, using the private raw-Node callback consumer and provider idempotency; provider types stay outside domain and contract packages   |
| Region           | Existing Supabase Staging and Production remain in `ap-southeast-2`; Vercel Functions and Queues run in `syd1`, the matching AWS region                                            |
| Frozen inputs    | Local canonical files remain the human authority; committed checksum identities and trusted PR controls protect their G1 integration without CI secret mirrors                     |
| Performance      | Lazy module routes, 350 kB Vite chunk warning, 8s API response budget, 10s public API Function cap, and no synchronous dependency on workflow or Scientific Runtime during startup |

## Consequences

The Vercel adapter owns request/response conversion. Domain packages remain independent
of Vercel, Supabase, React, and browser APIs. Supabase serverless runtime traffic uses
a transaction-pooler URL and disables prepared statements. Migrations use a separate
admin connection.

The existing Supabase projects are healthy, colocated in Sydney, and contain no accepted
business schema. Recreating them solely to change region would duplicate resources and add
migration/credential churn without measured benefit. `syd1` maps to the same
`ap-southeast-2` region, so moving the Vercel server functions and queue consumer closes the
observed `iad1`/Sydney distance while preserving the existing data projects.

The evaluated Vercel Workflow Vite integration requires Nitro to supply its server routes.
Introducing Nitro or migrating to Next.js solely for durable execution would change the
frozen React/Vite/raw-Function stack. `@vercel/queue@0.5.1` exposes a Connect-style
`handleNodeCallback` for plain Vercel Node Functions, provides durable at-least-once delivery
and idempotency, and therefore fits behind the existing provider-neutral port without a
framework migration. G1 v1.1 requires one live API-to-queue-to-completion round-trip with
idempotency and correlation preserved.

The API response budget intentionally remains shorter than the Vercel Function cap. No
long-running work is permitted to rely on an HTTP request lifetime; later consequential API
commands must be cancellation-aware and idempotent before they are introduced.

Cloudflare and Turnstile are outside the G1 v1.1 provider boundary. They are not a G1
runtime, deployment, evidence, or credential requirement.
