# ADR 0001: Gate 1 technical baseline

## Status

Accepted for the provider-neutral foundation; provider-dependent acceptance remains
pending cloud bootstrap and live probes.

## Decisions

| Area             | Decision                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node 24.x, pnpm 11.19.0                                                                                                                      |
| Web              | React 19.2.8, Vite 8.2.2, TypeScript 7.0.2                                                                                                   |
| Frontend routing | React Router 7.18.2                                                                                                                          |
| API transport    | Vercel Node Function thin adapter over an internal dispatch function                                                                         |
| Validation       | Zod 4.4.3                                                                                                                                    |
| Database client  | postgres.js 3.4.9 with prepared statements disabled for transaction pooling                                                                  |
| Tests            | Vitest 4.1.11 and Playwright 1.62.1                                                                                                          |
| Formatting/lint  | Prettier 3.9.6 and ESLint 10.9.1                                                                                                             |
| Provider tooling | Vercel CLI 59.9.1 and Supabase CLI 2.116.0                                                                                                   |
| Workflow         | Provider-neutral port; live Vercel Workflow selection waits for a successful provider probe because the currently evaluated SDK path is beta |

## Consequences

The Vercel adapter owns request/response conversion. Domain packages remain independent
of Vercel, Supabase, React, and browser APIs. Supabase serverless runtime traffic uses
a transaction-pooler URL and disables prepared statements. Migrations use a separate
admin connection.

The public app uses Cloudflare DNS-only. Cloudflare Turnstile is verified server-side.
Cloudflare Access is a separate privileged-surface admission layer and never an RBAC
source.
