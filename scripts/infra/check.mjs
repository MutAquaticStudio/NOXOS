import { readFileSync } from "node:fs";

const files = ["infra/environments.json", "infra/vercel/preview-security.json"];
const configuration = Object.fromEntries(
  files.map((file) => [file, JSON.parse(readFileSync(file, "utf8"))])
);

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
const authenticatedPreview =
  configuration["infra/vercel/preview-security.json"].protectedAuthenticatedAcceptancePreview;
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
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET"
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

const requiredAuthenticatedPreviewRuntimeKeys = [
  "NOX_ENV",
  "NOX_SOURCE_SHA",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_FEATURE_FLAGS"
];
const forbiddenAuthenticatedPreviewRuntimeKeys = [
  "NOX_WORKFLOW_DATABASE_URL",
  "NOX_MIGRATION_DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_STORAGE_BUCKET",
  "NOX_DIAGNOSTIC_PROBE_TOKEN"
];
if (
  authenticatedPreview.authority !== "ADR-0004" ||
  authenticatedPreview.providerGitIntegration !== false ||
  authenticatedPreview.deploymentSource !== "protected GitHub Preview environment" ||
  authenticatedPreview.dataPlane !== "isolated-preview" ||
  authenticatedPreview.productionAccess !== false ||
  authenticatedPreview.credentialScope !== "limited runtime role only" ||
  authenticatedPreview.ordinaryPullRequestPreviewUnchanged !== true ||
  !requiredAuthenticatedPreviewRuntimeKeys.every((key) =>
    authenticatedPreview.allowedRuntimeEnvironmentKeys.includes(key)
  ) ||
  !forbiddenAuthenticatedPreviewRuntimeKeys.every((key) =>
    authenticatedPreview.forbiddenRuntimeEnvironmentKeys.includes(key)
  )
) {
  throw new Error(
    "Protected authenticated Preview must remain a limited, isolated acceptance path."
  );
}

console.log("INFRA_CONTRACT=PASS");
