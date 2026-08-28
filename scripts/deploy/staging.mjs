import { execFileSync } from "node:child_process";

const required = ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(key + " must be supplied through the cloud secret store.");
  }
}

execFileSync("pnpm", ["build"], { stdio: "inherit", env: process.env });
execFileSync(
  "pnpm",
  ["exec", "vercel", "deploy", "--prebuilt", "--yes", "--scope", process.env.VERCEL_ORG_ID],
  { stdio: "inherit", env: process.env }
);

console.log("STAGING_DEPLOY=SUBMITTED");
