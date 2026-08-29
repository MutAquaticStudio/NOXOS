const requiredVariables = [
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_STAGING_URL",
  "SUPABASE_STAGING_PUBLISHABLE_KEY",
  "SUPABASE_STAGING_STORAGE_BUCKET",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID"
];

const requiredSecrets = [
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_WORKFLOW_DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "NOX_DIAGNOSTIC_PROBE_TOKEN"
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
const stagingPublishableKey = process.env.GITHUB_VAR__SUPABASE_STAGING_PUBLISHABLE_KEY;

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
if (!/^\S{16,4096}$/.test(stagingPublishableKey)) {
  throw new Error("Protected Staging Supabase publishable key is invalid.");
}
if (process.env.GITHUB_VAR__VERCEL_PROJECT_ID !== "prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx") {
  throw new Error("Protected Staging targets an unexpected Vercel project.");
}

console.log("PROTECTED_STAGING_CONFIGURATION=PASS");
