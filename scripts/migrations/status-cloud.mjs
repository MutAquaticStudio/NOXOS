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

execFileSync("pnpm", ["exec", "supabase", "link", "--project-ref", projectRef], {
  stdio: "inherit",
  env: process.env
});
const output = execFileSync(
  "pnpm",
  ["exec", "supabase", "migration", "list", "--output-format", "json"],
  {
    encoding: "utf8",
    env: process.env
  }
);

let parsed;
try {
  parsed = JSON.parse(output);
} catch {
  throw new Error("Supabase migration status did not return machine-readable JSON.");
}

const rows = Array.isArray(parsed)
  ? parsed
  : parsed && typeof parsed === "object" && Array.isArray(parsed.migrations)
    ? parsed.migrations
    : undefined;
if (!rows) {
  throw new Error("Supabase migration status returned an unrecognized JSON shape.");
}

for (const row of rows) {
  if (!row || typeof row !== "object") {
    throw new Error("Supabase migration status contains an invalid row.");
  }
  const local = row.local ?? row.LOCAL;
  const remote = row.remote ?? row.REMOTE;
  if (!local || !remote || String(local) !== String(remote)) {
    throw new Error("Supabase migration history drift was detected.");
  }
}

console.log("CLOUD_MIGRATION_STATUS=VERIFIED");
