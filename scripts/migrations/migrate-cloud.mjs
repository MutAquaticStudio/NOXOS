import { execFileSync } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF;
const environment = process.env.NOX_MIGRATION_ENV;
if (!projectRef || !environment || !["preview", "staging", "production"].includes(environment)) {
  throw new Error("SUPABASE_PROJECT_REF and a valid NOX_MIGRATION_ENV are required.");
}
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  throw new Error("SUPABASE_ACCESS_TOKEN must be supplied through the cloud secret store.");
}
if (!process.env.SUPABASE_DB_PASSWORD) {
  throw new Error("SUPABASE_DB_PASSWORD must be supplied through the cloud secret store.");
}

const cliPasswordArgs = ["--password", process.env.SUPABASE_DB_PASSWORD];

execFileSync(
  "pnpm",
  ["exec", "supabase", "link", "--project-ref", projectRef, ...cliPasswordArgs],
  {
    stdio: "inherit",
    env: process.env
  }
);
execFileSync(
  "pnpm",
  ["exec", "supabase", "db", "push", "--include-all", "--dry-run", ...cliPasswordArgs],
  {
    stdio: "inherit",
    env: process.env
  }
);
execFileSync("pnpm", ["exec", "supabase", "db", "push", "--include-all", ...cliPasswordArgs], {
  stdio: "inherit",
  env: process.env
});
execFileSync("node", ["scripts/migrations/status-cloud.mjs"], {
  stdio: "inherit",
  env: process.env
});

console.log("CLOUD_MIGRATION_ENVIRONMENT=" + environment);
console.log("CLOUD_MIGRATION_DRY_RUN=PASS");
console.log("CLOUD_MIGRATION=APPLIED");
