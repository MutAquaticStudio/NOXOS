const requiredVariables = [
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_STAGING_URL",
  "SUPABASE_STAGING_STORAGE_BUCKET",
  "SUPABASE_PRODUCTION_STORAGE_BUCKET",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "CF_ZONE_ID",
  "CF_ACCOUNT_ID",
  "NOX_PUBLIC_APP_HOSTNAME",
  "VERCEL_PUBLIC_CNAME_TARGET",
  "CF_CREATE_TURNSTILE_WIDGET",
  "CF_PRIVILEGED_PROXY_APPROVED",
  "NOX_OPS_HOSTNAME",
  "CF_PRIVILEGED_CNAME_TARGET",
  "CF_ACCESS_IDENTITY_GROUP_ID",
  "VITE_TURNSTILE_SITE_KEY"
];

const requiredSecrets = [
  "FROZEN_G0_ARCHITECTURE_GZIP_BASE64",
  "FROZEN_UXUI_GUIDELINE_GZIP_BASE64",
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_WORKFLOW_DATABASE_URL",
  "NOX_STAGING_RUNTIME_DATABASE_URL_SHA256",
  "NOX_PRODUCTION_RUNTIME_DATABASE_URL_SHA256",
  "NOX_STAGING_WORKFLOW_DATABASE_URL_SHA256",
  "NOX_PRODUCTION_WORKFLOW_DATABASE_URL_SHA256",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NOX_STAGING_SUPABASE_SERVICE_ROLE_KEY_SHA256",
  "NOX_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY_SHA256",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "NOX_DIAGNOSTIC_PROBE_TOKEN",
  "CF_API_TOKEN",
  "TURNSTILE_SECRET_KEY"
];

function configured(kind, name) {
  return Boolean(process.env["GITHUB_" + kind + "__" + name]);
}

const missingVariables = requiredVariables.filter((name) => !configured("VAR", name));
const missingSecrets = requiredSecrets.filter((name) => !configured("SECRET", name));

console.log(
  "MISSING_GITHUB_ENV_VARS=" + (missingVariables.length === 0 ? "NONE" : missingVariables.join(","))
);
console.log(
  "MISSING_GITHUB_ENV_SECRETS=" + (missingSecrets.length === 0 ? "NONE" : missingSecrets.join(","))
);

if (missingVariables.length > 0 || missingSecrets.length > 0) {
  throw new Error(
    "Protected staging configuration is incomplete; only missing names were emitted."
  );
}

const stagingRef = process.env.GITHUB_VAR__SUPABASE_STAGING_PROJECT_REF;
const productionRef = process.env.GITHUB_VAR__SUPABASE_PRODUCTION_PROJECT_REF;
const stagingBucket = process.env.GITHUB_VAR__SUPABASE_STAGING_STORAGE_BUCKET;
const productionBucket = process.env.GITHUB_VAR__SUPABASE_PRODUCTION_STORAGE_BUCKET;
const stagingUrl = new URL(process.env.GITHUB_VAR__SUPABASE_STAGING_URL);

if (stagingRef === productionRef || stagingBucket === productionBucket) {
  throw new Error("Protected Staging resources must remain distinct from Production.");
}
if (stagingUrl.protocol !== "https:" || stagingUrl.hostname !== stagingRef + ".supabase.co") {
  throw new Error("Protected Staging Supabase URL does not match its project reference.");
}
if (
  process.env.GITHUB_VAR__CF_CREATE_TURNSTILE_WIDGET !== "true" ||
  process.env.GITHUB_VAR__CF_PRIVILEGED_PROXY_APPROVED !== "true"
) {
  throw new Error("Cloudflare Turnstile and privileged Access reconciliation must be explicit.");
}
if (process.env.GITHUB_VAR__VERCEL_PROJECT_ID !== "prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx") {
  throw new Error("Protected Staging targets an unexpected Vercel project.");
}

console.log("PROTECTED_STAGING_CONFIGURATION=PASS");
