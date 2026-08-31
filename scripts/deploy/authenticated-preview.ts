import { execFileSync } from "node:child_process";
import { verifyVercelDeployment } from "../verify/vercel-deployment.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(name + " must be supplied through the protected Preview environment.");
  return value;
}

function projectRepository(): { organization: string; repository: string } {
  const [organization, repository, ...extra] = required("EXPECTED_GIT_REPOSITORY").split("/");
  if (!organization || !repository || extra.length > 0) {
    throw new Error("EXPECTED_GIT_REPOSITORY must be an owner/repository pair.");
  }
  return { organization, repository };
}

const expectedSourceSha = required("EXPECTED_SOURCE_SHA");
if (!/^[0-9a-f]{40}$/i.test(expectedSourceSha)) {
  throw new Error("Protected authenticated Preview requires a full immutable source SHA.");
}
const { organization, repository } = projectRepository();
const gitRef = required("EXPECTED_GIT_REF");
const token = required("VERCEL_TOKEN");
const projectId = required("VERCEL_PROJECT_ID");
const organizationId = required("VERCEL_ORG_ID");
const supabaseUrl = required("SUPABASE_URL");
const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
const runtimeDatabaseUrl = required("NOX_RUNTIME_DATABASE_URL");

const environment = {
  ...process.env,
  NOX_ENV: "preview",
  NOX_SOURCE_SHA: expectedSourceSha,
  VITE_NOX_ENV: "preview",
  VITE_NOX_SOURCE_SHA: expectedSourceSha
};

const output = String(
  execFileSync(
    "pnpm",
    [
      "exec",
      "vercel",
      "--project",
      projectId,
      "--token",
      token,
      "deploy",
      "--yes",
      "--force",
      "--build-env",
      "VITE_NOX_ENV=preview",
      "--build-env",
      "VITE_NOX_SOURCE_SHA=" + expectedSourceSha,
      "--build-env",
      "VITE_SUPABASE_URL=" + supabaseUrl,
      "--build-env",
      "VITE_SUPABASE_PUBLISHABLE_KEY=" + publishableKey,
      "--env",
      "NOX_ENV=preview",
      "--env",
      "NOX_SOURCE_SHA=" + expectedSourceSha,
      "--env",
      "SUPABASE_URL=" + supabaseUrl,
      "--env",
      "SUPABASE_PUBLISHABLE_KEY=" + publishableKey,
      "--env",
      "NOX_RUNTIME_DATABASE_URL=" + runtimeDatabaseUrl,
      "--env",
      "NOX_FEATURE_FLAGS=module.material-intelligence,module.design-studio,module.trial-sensory",
      "--meta",
      "githubDeployment=1",
      "--meta",
      "githubCommitSha=" + expectedSourceSha,
      "--meta",
      "githubCommitOrg=" + organization,
      "--meta",
      "githubCommitRepo=" + repository,
      "--meta",
      "githubCommitRef=" + gitRef
    ],
    { env: environment, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }
  )
).trim();

const deploymentUrl = await verifyVercelDeployment(
  {
    organizationId,
    projectId,
    sourceSha: expectedSourceSha,
    target: "preview",
    token,
    gitSource: { organization, repository, ref: gitRef }
  },
  output
);

console.log("AUTHENTICATED_PREVIEW_DEPLOY=SUBMITTED_AND_VERIFIED");
console.log("AUTHENTICATED_PREVIEW_URL=" + deploymentUrl);
