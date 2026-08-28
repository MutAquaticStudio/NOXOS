import { reconcileVercelCustomEnvironment } from "./vercel-custom-environment";
import { reconcileVercelProjectRoot } from "./vercel-project-root";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be supplied through the cloud secret store.`);
  }
  return value;
}

const input = {
  token: required("VERCEL_TOKEN"),
  organizationId: required("VERCEL_ORG_ID"),
  projectId: required("VERCEL_PROJECT_ID")
};

const project = await reconcileVercelProjectRoot({
  ...input,
  rootDirectory: "apps/nox-os"
});
const result = await reconcileVercelCustomEnvironment({
  ...input,
  slug: "staging",
  description: "NØX-OS persistent non-production acceptance environment"
});

console.log(`VERCEL_PROJECT_ROOT=${project.updated ? "UPDATED" : "RECONCILED"}`);
console.log("VERCEL_PROJECT_ROOT_READBACK=PASS");
console.log(`VERCEL_STAGING_ENVIRONMENT=${result.created ? "CREATED" : "RECONCILED"}`);
console.log("VERCEL_STAGING_ENVIRONMENT_READBACK=PASS");
