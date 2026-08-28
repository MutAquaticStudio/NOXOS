const stagingUrl = process.env.NOX_STAGING_URL;
const expectedSha = process.env.EXPECTED_SOURCE_SHA;
const expectedEnvironment = process.env.NOX_EXPECTED_ENV ?? "staging";
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!stagingUrl || !expectedSha) {
  throw new Error("NOX_STAGING_URL and EXPECTED_SOURCE_SHA are required for staging verification.");
}

const headers = protectionBypass
  ? {
      "x-vercel-protection-bypass": protectionBypass
    }
  : undefined;
const healthResponse = await fetch(new URL("/api/v1/health", stagingUrl), { headers });
const versionResponse = await fetch(new URL("/api/v1/version", stagingUrl), { headers });

if (!healthResponse.ok || !versionResponse.ok) {
  throw new Error("Staging health or version endpoint failed.");
}

const health = await healthResponse.json();
const version = await versionResponse.json();

if (health.environment !== expectedEnvironment || version.environment !== expectedEnvironment) {
  throw new Error("Deployed environment identity is incorrect.");
}
if (health.sourceSha !== expectedSha || version.sourceSha !== expectedSha) {
  throw new Error("Deployed SHA does not equal expected SHA.");
}

console.log("DEPLOYMENT_HTTP_AND_SHA=PASS");
