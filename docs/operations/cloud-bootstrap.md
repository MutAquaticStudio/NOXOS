# G1 v1.1 cloud operations

G1 uses only Vercel and Supabase. Cloudflare, Turnstile, custom domains, and Production are
outside this gate.

The protected GitHub `staging` environment uses these non-secret variables:

```text
SUPABASE_STAGING_PROJECT_REF
SUPABASE_PRODUCTION_PROJECT_REF
SUPABASE_STAGING_URL
SUPABASE_STAGING_STORAGE_BUCKET
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

It uses only the following execution secrets:

```text
NOX_RUNTIME_DATABASE_URL
NOX_WORKFLOW_DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
VERCEL_TOKEN
VERCEL_AUTOMATION_BYPASS_SECRET
NOX_DIAGNOSTIC_PROBE_TOKEN
```

GitHub Actions performs the normal path: validate, confirm Staging isolation, replay/status
migrations, reconcile the private Staging bucket, deploy the existing Vercel project, then
verify API, DB roles, Queue round-trip, Storage lifecycle, browser shell, and exact SHA.
Preview stays secretless and is verified from its Vercel deployment URL.
