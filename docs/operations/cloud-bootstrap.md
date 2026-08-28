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

## Canonical provider identities

Gate 1 reconciles the existing resources; it must not create replacements merely because
automation is rerun.

| Resource                    | Canonical identity                         |
| --------------------------- | ------------------------------------------ |
| GitHub repository           | `MutAquaticStudio/NOXOS`                   |
| Vercel team / project       | `noxelis` / `nox-os`                       |
| Vercel project ID           | `prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx`         |
| Vercel Staging environment  | `env_9m44u7jMBpyR8DqYTqUCfqZwfZav`         |
| Supabase Staging            | `uyfddpmbszjkhdkqvncz`                     |
| Supabase Production         | `soioshmcdwxhlgrjzkoc`                     |
| Supabase region             | Sydney (`ap-southeast-2`)                  |
| Vercel Functions and Queues | Sydney (`syd1`, matching `ap-southeast-2`) |
| Staging private bucket      | `nox-os-staging-private`                   |

The Production Supabase project is an isolation reference during G1. G1 does not run a
Production migration, create Production business data, or promote the application to
Production.

## Protected GitHub environments

Create or reconcile three protected environments: `preview`, `staging`, and
`frozen-contracts`. Repository automation emits only missing names and fails closed when a
required value is absent. Secret values are never printed.

The `staging` environment requires these non-secret variables:

```text
SUPABASE_STAGING_PROJECT_REF
SUPABASE_PRODUCTION_PROJECT_REF
SUPABASE_STAGING_URL
SUPABASE_STAGING_STORAGE_BUCKET
VERCEL_ORG_ID
VERCEL_PROJECT_ID
CF_ZONE_ID
CF_ACCOUNT_ID
NOX_PUBLIC_APP_HOSTNAME
VERCEL_PUBLIC_CNAME_TARGET
CF_PRIVILEGED_PROXY_APPROVED
NOX_OPS_HOSTNAME
CF_PRIVILEGED_CNAME_TARGET
CF_ACCESS_IDENTITY_GROUP_ID
VITE_TURNSTILE_SITE_KEY
```

The `staging` environment requires these encrypted secrets:

```text
FROZEN_G0_ARCHITECTURE_GZIP_BASE64
FROZEN_UXUI_GUIDELINE_GZIP_BASE64
NOX_RUNTIME_DATABASE_URL
NOX_WORKFLOW_DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
VERCEL_TOKEN
VERCEL_AUTOMATION_BYPASS_SECRET
NOX_DIAGNOSTIC_PROBE_TOKEN
CF_API_TOKEN
TURNSTILE_SECRET_KEY
```

`NOX_RUNTIME_DATABASE_URL` and `NOX_WORKFLOW_DATABASE_URL` must be Supavisor transaction
pooler URLs on port 6543 for the limited `nox_app_runtime` and `nox_workflow_runtime` roles.
They must never use `postgres`, the database owner, a superuser, or the Supabase service-role
key. `SUPABASE_DB_PASSWORD` authenticates only the official non-interactive migration CLI
path and remains separate from both runtime connections.

The `preview` environment requires the existing Vercel read identity and protection bypass
used for exact-SHA acceptance. It never receives database, storage, migration, workflow,
Cloudflare, or diagnostic credentials.

The `frozen-contracts` environment contains only the two gzip/base64 encrypted canonical
document mirrors named above. CI checks their bytes against the committed SHA-256 baseline.
The source documents remain the single human authority and are not disclosed in the public
repository. Ordinary pull requests cannot change the checksum/control files because the
trusted base-branch workflow rejects those paths.

## One-time secret bootstrap

Provider/account owners may need to perform the following one-time actions when no authorized
automation session exists. Values must be entered directly into the provider UI or approved
secret-store tooling, never into an issue, pull request, workflow log, or chat:

1. In an approved Supabase Staging administrator session, set independent strong passwords for
   `nox_app_runtime` and `nox_workflow_runtime`. Do not put either password in a migration,
   repository file, issue, workflow input, log, or chat.
2. Build the two Staging Supavisor transaction-pool URLs from the provider's current Connect
   panel using port 6543 and project-qualified usernames
   `nox_app_runtime.uyfddpmbszjkhdkqvncz` and
   `nox_workflow_runtime.uyfddpmbszjkhdkqvncz`. Store only the complete URLs directly as the
   protected GitHub `staging` secrets `NOX_RUNTIME_DATABASE_URL` and
   `NOX_WORKFLOW_DATABASE_URL`. Do not retain a second plaintext password copy.
3. Store the Staging Supabase service-role key and the separate migration access token/database
   password. Staging receives no Production database URL, service-role key, or credential
   fingerprint; isolation is proven through distinct project references and live Staging probes.
4. Enable a Vercel automation bypass secret for protected Preview/Staging verification and
   store it in the matching GitHub environments.
5. Bootstrap the canonical Turnstile widget once when needed, copy its public site key and server
   secret directly to protected GitHub configuration, and select an existing Access identity
   group. Then authorize a narrowly scoped Cloudflare token for routine DNS/DNSSEC, widget, and
   Access application/policy reconciliation. The automation deliberately refuses to auto-create
   a widget when it cannot persist the returned secret.
6. Store encrypted canonical document mirrors in `frozen-contracts` and `staging`.

After this bootstrap, provider mutation, migrations, deployments, and acceptance run through
the versioned workflows; routine dashboard mutation is not part of the operating model.

## SHA-bound Gate evidence

The protected Staging workflow generates the per-SHA JSON evidence only after every migration,
deployment, data-plane, Cloudflare, browser, and exact-source check passes. It uploads the JSON as
the Actions artifact `g1-staging-evidence-<accepted-main-sha>` and creates the annotated Git tag
`g1-staging-accepted-<accepted-main-sha>` on that exact commit. The tag records the Actions run and
artifact name. A future Production promotion skeleton verifies this immutable tag instead of
trusting a mutable environment variable. Neither evidence mechanism writes current provider state
back into the accepted source commit.

The public Vercel hostname stays Cloudflare DNS-only. A future privileged hostname may
be proxied only after an explicit architecture approval so that Cloudflare Access can be
an edge admission gate; it never replaces NØX authentication, tenant checks, RBAC, or
auditing.

## Vercel monorepo placement

The single `nox-os` Vercel project uses `apps/nox-os` as its Root Directory. Its
`vercel.json`, Vite output (`dist`), and `/api/v1/*` Function live under that same app root;
the repository root does not carry a competing Vercel configuration. The project must retain
Vercel’s supported monorepo access to the declared workspace packages outside the app root.
That provider setting is read back during Preview acceptance rather than inferred from source.

## Environment isolation

```text
Preview    -> ordinary Git PR runtime; secretless and no data-plane resource
Staging    -> trusted post-merge persistent isolated non-production resources
Production -> production-only resources
```

No Preview or Staging credential may point to Production.

Supabase Storage identity is the pair `(project_ref, bucket_id)`. A bucket ID may be identical in
Staging and Production without identifying the same object store because the projects are
distinct. The Staging workflow validates the project reference, reconciles the existing bucket,
and proves private object behavior against that project; it never compares bucket names alone.

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
