import { readFileSync } from "node:fs";

const files = [
  "infra/cloudflare/dns.json",
  "infra/cloudflare/turnstile.json",
  "infra/cloudflare/access.json",
  "infra/environments.json"
];
const configuration = Object.fromEntries(
  files.map((file) => [file, JSON.parse(readFileSync(file, "utf8"))])
);

if (configuration["infra/cloudflare/dns.json"].publicApplication.proxied !== false) {
  throw new Error("Public Vercel application must remain Cloudflare DNS-only.");
}
if (
  configuration["infra/cloudflare/access.json"].applicationAuthorization.accessIsNotRbac !== true
) {
  throw new Error("Cloudflare Access must not be represented as NØX RBAC.");
}
if (configuration["infra/cloudflare/turnstile.json"].serverValidation.singleUse !== true) {
  throw new Error("Turnstile must be verified server-side as a single-use token.");
}

const environments = configuration["infra/environments.json"];
if (
  environments.preview.productionAccess ||
  environments.staging.productionAccess ||
  !environments.production.productionAccess
) {
  throw new Error("Preview, Staging, and Production must remain isolated.");
}
if (
  environments.preview.database === environments.production.database ||
  environments.staging.database === environments.production.database ||
  environments.preview.storage === environments.production.storage ||
  environments.staging.storage === environments.production.storage
) {
  throw new Error("Non-production resources must not use Production.");
}

console.log("INFRA_CONTRACT=PASS");
