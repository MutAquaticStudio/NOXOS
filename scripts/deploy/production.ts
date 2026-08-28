import { execFileSync } from "node:child_process";
import { verifyVercelDeployment } from "../verify/vercel-deployment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " must be supplied through the cloud secret store.");
  }
  return value;
}

function runVercel(args: string[]): void {
  execFileSync("pnpm", vercelArguments(args), {
    env: identityEnvironment,
    stdio: "inherit"
  });
}

function deployVercel(args: string[]): string {
  return String(
    execFileSync("pnpm", vercelArguments(args), {
      env: identityEnvironment,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8"
    })
  ).trim();
}

function vercelArguments(args: string[]): string[] {
  return ["exec", "vercel", "--cwd", "apps/nox-os", "--token", required("VERCEL_TOKEN"), ...args];
}

for (const key of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "EXPECTED_SOURCE_SHA",
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_WORKFLOW_DATABASE_URL"
]) {
  required(key);
}

const expectedSourceSha = required("EXPECTED_SOURCE_SHA");
if (!/^[0-9a-f]{40,128}$/i.test(expectedSourceSha)) {
  throw new Error("EXPECTED_SOURCE_SHA must be a full Git commit SHA.");
}

const identityEnvironment = {
  ...process.env,
  NOX_ENV: "production",
  NOX_SOURCE_SHA: expectedSourceSha,
  VITE_NOX_ENV: "production",
  VITE_NOX_SOURCE_SHA: expectedSourceSha
};

runVercel(["pull", "--yes", "--environment=production"]);
runVercel(["build", "--yes", "--target=production"]);
const submittedUrl = deployVercel([
  "deploy",
  "--prebuilt",
  "--target=production",
  "--yes",
  "--env",
  "NOX_ENV=production",
  "--env",
  "NOX_SOURCE_SHA=" + expectedSourceSha,
  "--env",
  "NOX_RUNTIME_DATABASE_URL=" + required("NOX_RUNTIME_DATABASE_URL"),
  "--env",
  "NOX_WORKFLOW_DATABASE_URL=" + required("NOX_WORKFLOW_DATABASE_URL"),
  "--env",
  "NOX_FOUNDATION_DIAGNOSTICS_ENABLED=false",
  "--meta",
  "githubDeployment=1",
  "--meta",
  "githubCommitSha=" + expectedSourceSha
]);

const deploymentUrl = await verifyVercelDeployment(
  {
    organizationId: required("VERCEL_ORG_ID"),
    projectId: required("VERCEL_PROJECT_ID"),
    sourceSha: expectedSourceSha,
    target: "production",
    token: required("VERCEL_TOKEN")
  },
  submittedUrl
);

console.log("PRODUCTION_DEPLOY=SUBMITTED_AND_VERIFIED");
console.log("PRODUCTION_DEPLOY_URL=" + deploymentUrl);
