import { reconcileVercelCustomEnvironment } from "./vercel-custom-environment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be supplied through the cloud secret store.`);
  }
  return value;
}

const result = await reconcileVercelCustomEnvironment({
  token: required("VERCEL_TOKEN"),
  organizationId: required("VERCEL_ORG_ID"),
  projectId: required("VERCEL_PROJECT_ID"),
  slug: "staging",
  description: "NØX-OS persistent non-production acceptance environment"
});

console.log(`VERCEL_STAGING_ENVIRONMENT=${result.created ? "CREATED" : "RECONCILED"}`);
console.log("VERCEL_STAGING_ENVIRONMENT_READBACK=PASS");
