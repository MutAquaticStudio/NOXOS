import { execFileSync } from "node:child_process";
import { verifyVercelDeployment } from "../verify/vercel-deployment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " must be supplied through the cloud secret store.");
  }
  return value;
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
    "--project",
    required("VERCEL_PROJECT_ID"),
    "--token",
    required("VERCEL_TOKEN"),
    ...args
  ];
}

for (const key of [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "NOX_VERCEL_STAGING_ENVIRONMENT_ID",
  "EXPECTED_SOURCE_SHA",
  "VITE_TURNSTILE_SITE_KEY",
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

// Deploy source to Vercel's reconciled custom environment. Vercel performs the same remote build
// path already exercised by Preview; only explicitly public Vite values cross the build boundary.
const submittedUrl = deployVercel([
  "deploy",
  "--target=" + target,
  "--yes",
  "--force",
  "--build-env",
  "VITE_NOX_ENV=" + target,
  "--build-env",
  "VITE_NOX_SOURCE_SHA=" + expectedSourceSha,
  "--build-env",
  "VITE_TURNSTILE_SITE_KEY=" + required("VITE_TURNSTILE_SITE_KEY"),
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
    customEnvironmentId: required("NOX_VERCEL_STAGING_ENVIRONMENT_ID"),
    token: required("VERCEL_TOKEN")
  },
  submittedUrl
);

console.log("STAGING_DEPLOY=SUBMITTED_AND_VERIFIED");
console.log("STAGING_DEPLOY_URL=" + deploymentUrl);
