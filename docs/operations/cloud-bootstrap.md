# Cloud bootstrap boundary

NØX-OS Gate 1 uses GitHub, Vercel, Supabase, and Cloudflare. The system is designed so
that normal development, validation, migration, and deployment happen in cloud
automation after a one-time provider bootstrap.

## Required provider scopes

| Provider   | Bootstrap scope                                              | Routine path                                     |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------ |
| GitHub     | Repository and Actions access                                | Pull request checks and main-to-staging workflow |
| Vercel     | Project, environment, deploy, and read access                | Preview and staging deployments                  |
| Supabase   | Isolated Preview/Staging/Production project or branch access | Versioned migrations and private storage         |
| Cloudflare | DNS, Turnstile, and Zero Trust Access automation access      | Versioned security configuration                 |

Secrets must be stored only in the provider's encrypted environment. They must never be
committed, placed in a `VITE_` variable, or pasted into chat.

The public Vercel hostname stays Cloudflare DNS-only. A future privileged hostname may
be proxied only after an explicit architecture approval so that Cloudflare Access can be
an edge admission gate; it never replaces NØX authentication, tenant checks, RBAC, or
auditing.

## Environment isolation

```text
Preview    -> ordinary Git PR runtime; secretless and no data-plane resource
Staging    -> trusted post-merge persistent isolated non-production resources
Production -> production-only resources
```

No Preview or Staging credential may point to Production.

An ordinary Preview receives no runtime database, Storage, workflow, migration,
service-role, diagnostic, Cloudflare, or Vercel-management credential. Preview acceptance is
therefore limited to deployed identity, shell, and safe API health. The trusted Staging workflow
performs the DB, Storage, and workflow diagnostic probes after provider deployment read-back.

## Foundation performance policy

- Module routes stay lazy-loaded; Vite warns when an output chunk exceeds 350 kB.
- The foundation API uses an 8-second response budget; its Vercel Function is capped at 10
  seconds. Long-running work belongs to `WorkflowLauncher`, not the request lifetime.
- Runtime Postgres connections use a 5-second connection timeout, a 10-second idle timeout,
  and a 60-second maximum connection lifetime. Future business queries must introduce bounded
  query behavior as part of their G2 contract.
- The shell has no heavy ambient global motion and honors reduced-motion preferences.
