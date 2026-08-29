const requiredVariables = [
  "SUPABASE_PREVIEW_PROJECT_REF",
  "SUPABASE_PRODUCTION_PROJECT_REF",
  "SUPABASE_PREVIEW_URL",
  "SUPABASE_PREVIEW_PUBLISHABLE_KEY",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID"
];

const requiredSecrets = [
  "SUPABASE_PREVIEW_ACCESS_TOKEN",
  "SUPABASE_PREVIEW_DB_PASSWORD",
  "NOX_PREVIEW_RUNTIME_DATABASE_URL",
  "NOX_PREVIEW_MATERIAL_USER_ID",
  "NOX_PREVIEW_MATERIAL_USER_EMAIL",
  "NOX_PREVIEW_MATERIAL_USER_PASSWORD",
  "VERCEL_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET"
];

function configured(kind, name) {
  return Boolean(process.env["GITHUB_" + kind + "__" + name]);
}

const missingVariables = requiredVariables.filter((name) => !configured("VAR", name));
const missingSecrets = requiredSecrets.filter((name) => !configured("SECRET", name));
console.log(
  "MISSING_PREVIEW_ENV_VARS=" +
    (missingVariables.length === 0 ? "NONE" : missingVariables.join(","))
);
console.log(
  "MISSING_PREVIEW_ENV_SECRETS=" + (missingSecrets.length === 0 ? "NONE" : missingSecrets.join(","))
);
if (missingVariables.length > 0 || missingSecrets.length > 0) {
  throw new Error("Protected authenticated Preview configuration is incomplete.");
}

const previewRef = process.env.GITHUB_VAR__SUPABASE_PREVIEW_PROJECT_REF;
const productionRef = process.env.GITHUB_VAR__SUPABASE_PRODUCTION_PROJECT_REF;
const previewUrl = new URL(process.env.GITHUB_VAR__SUPABASE_PREVIEW_URL);
const publishableKey = process.env.GITHUB_VAR__SUPABASE_PREVIEW_PUBLISHABLE_KEY;
if (previewRef === productionRef || previewRef !== "uurkjmkhvtqydeikncaw") {
  throw new Error(
    "Protected authenticated Preview must use the canonical isolated Preview project."
  );
}
if (previewUrl.protocol !== "https:" || previewUrl.hostname !== previewRef + ".supabase.co") {
  throw new Error("Protected Preview Supabase URL does not match the isolated Preview project.");
}
if (!/^\S{16,4096}$/.test(publishableKey)) {
  throw new Error("Protected Preview Supabase publishable key is invalid.");
}
if (process.env.GITHUB_VAR__VERCEL_PROJECT_ID !== "prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx") {
  throw new Error("Protected Preview targets an unexpected Vercel project.");
}
console.log("PROTECTED_AUTHENTICATED_PREVIEW_CONFIGURATION=PASS");
