const requiredVariables = [
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_STAGING_URL",
  "SUPABASE_STAGING_STORAGE_BUCKET",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "CF_ZONE_ID",
  "CF_ACCOUNT_ID",
  "NOX_PUBLIC_APP_HOSTNAME",
  "VERCEL_PUBLIC_CNAME_TARGET",
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
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "NOX_DIAGNOSTIC_PROBE_TOKEN",
  "CF_API_TOKEN",
  "TURNSTILE_SECRET_KEY"
];

const canonicalStagingProjectRef = "uyfddpmbszjkhdkqvncz";
const canonicalProductionProjectRef = "soioshmcdwxhlgrjzkoc";

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
const stagingUrl = new URL(process.env.GITHUB_VAR__SUPABASE_STAGING_URL);

if (stagingRef === productionRef) {
  throw new Error("Protected Staging project must remain distinct from Production.");
}
if (stagingRef !== canonicalStagingProjectRef) {
  throw new Error("Protected Staging targets an unexpected Supabase project.");
}
if (productionRef !== canonicalProductionProjectRef) {
  throw new Error(
    "Protected Production identity does not match the canonical isolation reference."
  );
}
if (!/^[a-z0-9][a-z0-9_-]{2,62}$/i.test(stagingBucket)) {
  throw new Error("Protected Staging storage bucket ID is invalid.");
}
if (stagingUrl.protocol !== "https:" || stagingUrl.hostname !== stagingRef + ".supabase.co") {
  throw new Error("Protected Staging Supabase URL does not match its project reference.");
}
if (process.env.GITHUB_VAR__CF_PRIVILEGED_PROXY_APPROVED !== "true") {
  throw new Error("Cloudflare privileged Access reconciliation must be explicit.");
}
if (process.env.GITHUB_VAR__VERCEL_PROJECT_ID !== "prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx") {
  throw new Error("Protected Staging targets an unexpected Vercel project.");
}

console.log("PROTECTED_STAGING_CONFIGURATION=PASS");
