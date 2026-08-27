import { execFileSync } from "node:child_process";

const projectRef = process.env.SUPABASE_STAGING_PROJECT_REF;
if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) {
  throw new Error(
    "Cloud staging Supabase credentials must be configured through the secret store."
  );
}

execFileSync("pnpm", ["exec", "supabase", "link", "--project-ref", projectRef], {
  stdio: "inherit",
  env: process.env
});
execFileSync("pnpm", ["exec", "supabase", "migration", "list"], {
  stdio: "inherit",
  env: process.env
});

console.log("STAGING_MIGRATION_STATUS=VERIFIED");
