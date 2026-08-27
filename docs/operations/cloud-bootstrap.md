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
Preview   -> isolated non-production resources
Staging   -> persistent isolated non-production resources
Production -> production-only resources
```

No Preview or Staging credential may point to Production.
