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
  return [
    "exec",
    "vercel",
    "--cwd",
    "apps/nox-os",
    "--scope",
    required("VERCEL_ORG_ID"),
    "--token",
    required("VERCEL_TOKEN"),
    ...args
  ];
}

for (const key of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "EXPECTED_SOURCE_SHA",
  "NOX_RUNTIME_DATABASE_URL",
  "NOX_WORKFLOW_DATABASE_URL",
  "NOX_DIAGNOSTIC_PROBE_TOKEN"
]) {
  required(key);
}

const target = process.env.NOX_DEPLOY_ENV ?? "staging";
if (target !== "staging") {
  throw new Error("The staging deployment script may target only the staging environment.");
}

const expectedSourceSha = required("EXPECTED_SOURCE_SHA");
if (!/^[0-9a-f]{40,128}$/i.test(expectedSourceSha)) {
  throw new Error("EXPECTED_SOURCE_SHA must be a full Git commit SHA.");
}

const identityEnvironment = {
  ...process.env,
  NOX_ENV: target,
  NOX_SOURCE_SHA: expectedSourceSha,
  VITE_NOX_ENV: target,
  VITE_NOX_SOURCE_SHA: expectedSourceSha
};

// Vercel requires a target-aware build to create .vercel/output before --prebuilt can deploy it.
runVercel(["pull", "--yes", "--environment=" + target]);
runVercel(["build", "--yes", "--target=" + target]);
const submittedUrl = deployVercel([
  "deploy",
  "--prebuilt",
  "--target=" + target,
  "--yes",
  "--env",
  "NOX_ENV=" + target,
  "--env",
  "NOX_SOURCE_SHA=" + expectedSourceSha,
  "--env",
  "VERCEL_TARGET_ENV=" + target,
  "--env",
  "NOX_RUNTIME_DATABASE_URL=" + required("NOX_RUNTIME_DATABASE_URL"),
  "--env",
  "NOX_WORKFLOW_DATABASE_URL=" + required("NOX_WORKFLOW_DATABASE_URL"),
  "--env",
  "NOX_DIAGNOSTIC_PROBE_TOKEN=" + required("NOX_DIAGNOSTIC_PROBE_TOKEN"),
  "--env",
  "NOX_FOUNDATION_DIAGNOSTICS_ENABLED=true",
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
    target,
    token: required("VERCEL_TOKEN")
  },
  submittedUrl
);

console.log("STAGING_DEPLOY=SUBMITTED_AND_VERIFIED");
console.log("STAGING_DEPLOY_URL=" + deploymentUrl);
