import { execFileSync } from "node:child_process";

const projectRef = process.env.SUPABASE_STAGING_PROJECT_REF;
if (!projectRef) {
  throw new Error("SUPABASE_STAGING_PROJECT_REF is required for the cloud staging migration.");
}
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  throw new Error("SUPABASE_ACCESS_TOKEN must be supplied through the cloud secret store.");
}

execFileSync("pnpm", ["exec", "supabase", "link", "--project-ref", projectRef], {
  stdio: "inherit",
  env: process.env
});
execFileSync("pnpm", ["exec", "supabase", "db", "push", "--include-all"], {
  stdio: "inherit",
  env: process.env
});
execFileSync("pnpm", ["exec", "supabase", "migration", "list"], {
  stdio: "inherit",
  env: process.env
});

console.log("STAGING_MIGRATION=APPLIED");
