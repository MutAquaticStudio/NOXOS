# ADR 0004: Protected Authenticated Preview acceptance

## Status

Accepted by the NØX-OS owner on 2026-08-29. This is an append-only G1 v1.1
amendment for G3 acceptance. It does not modify G0, the UX/UI Guideline, the
historical G1 contract, or the ordinary pull-request Preview boundary.

## Context

G3 requires proof that a real authenticated browser session can traverse
Supabase Auth, NØX RequestContext, tenant context, and Material Intelligence
routes. The ordinary Git-integrated Preview is intentionally secretless. It
cannot provide that proof because it has neither a limited application database
connection nor a non-production browser Auth configuration.

## Decision

Keep the ordinary Git-integrated Preview exactly as it is: secretless,
provider-verified, and without runtime, migration, storage, service-role, or
provider credentials.

Add one separately deployed **Protected Authenticated Preview** for internal
acceptance only. GitHub Actions creates that deployment from the exact PR SHA
after entering the protected `Preview` environment. It uses the existing Vercel
project and the distinct `nox-os-preview` Supabase project. No new provider
project, database, or application is created.

The deployed Function may receive only:

- `NOX_ENV=preview` and the exact `NOX_SOURCE_SHA`;
- the isolated Preview `SUPABASE_URL` and public publishable key;
- the `nox_app_runtime` Supavisor transaction-pool connection; and
- the Material Intelligence feature flag.

The Function must not receive a service-role key, migration/admin database
password, Supabase management token, workflow role, Storage credential,
diagnostic token, or Vercel automation token. The Auth fixture and migration
credentials remain in GitHub Actions only. All Preview fixture data is
non-production and can be reconciled idempotently.

## Consequences

- Authenticated Preview evidence is real, SHA-bound, and isolated from
  Production.
- Ordinary PR Preview remains safe for broad Git integration use.
- A candidate branch that can execute the protected acceptance job can access
  only a limited, non-production runtime credential. It cannot access
  Production, Staging, Supabase administration, Storage administration, or
  provider tokens through its deployment environment.
- The acceptance workflow fails closed when any required protected Preview
  configuration is absent or refers to Production.

## Explicit non-changes

- No change to G0 or frozen UX/UI authority.
- No Production deployment, migration, data mutation, or Auth provisioning.
- No change to the G1 limited-role design or to the normal Staging bootstrap.
- No additional cloud provider or Vercel project.
