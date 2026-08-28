import { readFileSync } from "node:fs";

const files = [
  "infra/cloudflare/dns.json",
  "infra/cloudflare/turnstile.json",
  "infra/cloudflare/access.json",
  "infra/environments.json",
  "infra/vercel/preview-security.json"
];
const configuration = Object.fromEntries(
  files.map((file) => [file, JSON.parse(readFileSync(file, "utf8"))])
);

if (configuration["infra/cloudflare/dns.json"].publicApplication.proxied !== false) {
  throw new Error("Public Vercel application must remain Cloudflare DNS-only.");
}
if (
  configuration["infra/cloudflare/access.json"].applicationAuthorization.accessIsNotRbac !== true
) {
  throw new Error("Cloudflare Access must not be represented as NØX RBAC.");
}
if (
  configuration["infra/cloudflare/access.json"].policy.identityGroupEnvironmentKey !==
  "CF_ACCESS_IDENTITY_GROUP_ID"
) {
  throw new Error(
    "Cloudflare Access policy must source its identity group from cloud configuration."
  );
}
if (configuration["infra/cloudflare/turnstile.json"].serverValidation.singleUse !== true) {
  throw new Error("Turnstile must be verified server-side as a single-use token.");
}

const environments = configuration["infra/environments.json"];
if (
  environments.preview.productionAccess ||
  environments.staging.productionAccess ||
  !environments.production.productionAccess
) {
  throw new Error("Preview, Staging, and Production must remain isolated.");
}
if (
  environments.preview.database === environments.production.database ||
  environments.staging.database === environments.production.database ||
  environments.preview.storage === environments.production.storage ||
  environments.staging.storage === environments.production.storage
) {
  throw new Error("Non-production resources must not use Production.");
}

const previewSecurity =
  configuration["infra/vercel/preview-security.json"].ordinaryPullRequestPreview;
const requiredPreviewSecretlessKeys = [
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_WORKFLOW_DATABASE_URL",
  "NOX_MIGRATION_DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_STORAGE_BUCKET",
  "NOX_DIAGNOSTIC_PROBE_TOKEN",
  "TURNSTILE_SECRET_KEY",
  "CF_API_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "FROZEN_G0_ARCHITECTURE_GZIP_BASE64",
  "FROZEN_UXUI_GUIDELINE_GZIP_BASE64"
];
if (
  previewSecurity.providerGitIntegration !== true ||
  previewSecurity.verificationSource !== "trusted-pull-request-target-base-branch" ||
  previewSecurity.serverRuntimeCredentials !== "forbidden" ||
  previewSecurity.dataPlaneAcceptance !== "trusted-post-merge-staging-only" ||
  !requiredPreviewSecretlessKeys.every((key) =>
    previewSecurity.forbiddenEnvironmentKeys.includes(key)
  )
) {
  throw new Error("Ordinary pull-request Preview must remain a secretless provider runtime.");
}

console.log("INFRA_CONTRACT=PASS");
