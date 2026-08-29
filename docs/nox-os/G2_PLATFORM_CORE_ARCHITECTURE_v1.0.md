# NØX-OS — Gate 2 Platform Core Architecture v1.0

**Status:** `DRAFT — freezes only through SHA-bound Staging evidence`

**Scope:** G2 Platform Core; no Material Intelligence or other G3 business behavior.
**G1 baseline:** `886f58aecbaaa3f32c9142ad060e3e590cde340d`

## Authority and boundary

This document extends the frozen G1 foundation. It does not amend the frozen G0 Architecture
or UX/UI Guideline. G2 retains React/Vite, Vercel Functions, Supabase PostgreSQL/Auth/Storage,
postgres.js, the Module Registry, and the G1 shell.

G2 owns the platform-control boundary only:

- Supabase Auth verifies email/password identities and session lifecycle.
- NØX owns `PlatformUser`, `PlatformOwner`, tenants, membership, static RBAC, entitlements,
  authorization, and audit semantics.
- `PLATFORM_OWNER` and tenant membership are separate authorities. A PlatformOwner has no
  automatic tenant workspace access.
- Browser code uses Supabase only for authentication. All platform and tenant data flow through
  `/api/v1/*` and server-side postgres.js adapters.

## Data and authorization model

The private `platform` schema contains exactly five G2 tables:

1. `platform.platform_users`
2. `platform.tenants`
3. `platform.tenant_memberships`
4. `platform.tenant_entitlements`
5. `platform.audit_events`

`nox_app_runtime` has only the required DML boundary; it has no DDL, role-management, DROP, or
TRUNCATE capability. Audit rows are insert/select only for the runtime role. The application
resolves current user, tenant, membership, role, and entitlement state for every request;
client authority headers are ignored.

Core platform roles are `PLATFORM_OWNER`, `TENANT_OWNER`, `TENANT_ADMIN`, and
`TENANT_MEMBER`. Their permission maps live in source and fail closed for unknown roles or
permissions. Last active PlatformOwner and effective TenantOwner integrity are transactionally
protected with PostgreSQL locks.

## Module authorization and availability

Each registry definition owns a `ModuleAuthorizationManifest` with module-local permissions and
default grants for tenant roles. Registry validation rejects duplicate permissions, foreign or
core namespaces, wildcards, and grants that name unknown permissions.

Module availability is resolved in this order:

1. lifecycle unavailable → `DISABLED`
2. feature flag false → `DISABLED`
3. entitlement `module.<moduleId>` absent/false → `NOT_ENTITLED`
4. module permission absent → `NO_PERMISSION`
5. otherwise → `AVAILABLE`

Entitlement is neither a user permission nor an engineering feature flag. The test-only
`foundation-test` manifest is Staging-only and is not part of the canonical 12-module registry.

## Audit integrity

Every consequential G2 mutation writes its audit event in the same PostgreSQL transaction.
No-op mutations emit no audit event. The audit API is read-only and does not expose raw metadata.

## UI boundary

The existing NØX shell contains `/sign-in`, tenant selection, `/settings/tenant`, and the
PlatformOwner-only routes `/platform/tenants`, `/platform/users`, and `/platform/audit`.
The UI is a control plane, not a second shell or a business workspace. Destructive owner/status
actions require confirmation; the server remains authoritative.

## Freeze and evidence rule

The source document stays `DRAFT` until an exact merged-main SHA completes the authoritative
Staging workflow. The workflow must upload the `g2-staging-evidence-<SHA>` artifact, and an
annotated Git tag points at that same accepted SHA. That artifact—not a later source commit—is
the freeze-status record.

## Definition of Done

Every item below is blocking and must be individually `PASS` for the accepted SHA.

| Requirement                                                             | Required evidence                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Auth, PlatformUser, PlatformOwner, bootstrap, and owner safety          | focused unit/integration/API acceptance                                             |
| Platform/Tenant separation, tenant, membership, and tenant-owner safety | API and transaction acceptance                                                      |
| Static Platform/Tenant RBAC and trusted RequestContext                  | source and forged-authority tests                                                   |
| Module permission extension, flags, entitlement, availability           | registry and API acceptance                                                         |
| Audit foundation and transaction rollback                               | integration and deployed audit acceptance                                           |
| Session lifecycle, tenant settings, and Platform Control UI             | browser acceptance                                                                  |
| PR CI and exact-SHA Preview                                             | cloud CI and deployment read-back                                                   |
| Exact-SHA Staging                                                       | migration, deployment, DB/storage/workflow/browser probes and G2 fixture acceptance |
| No G3 business feature and Production untouched                         | source review and workflow evidence                                                 |
| Architecture severity                                                   | `P0=0`, `P1=0`, `P2=0`                                                              |

An accepted evidence artifact asserts `GATE_2_STATUS=FROZEN`, `GATE_2_DOD=PASS`, and
`G3_READY=YES` only after all rows above pass for the same immutable SHA.
