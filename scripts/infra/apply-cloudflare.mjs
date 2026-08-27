import { readFileSync } from "node:fs";

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " must be supplied through the cloud secret store.");
  }
  return value;
}

async function cloudflare(path, options) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...options,
    headers: {
      authorization: "Bearer " + required("CF_API_TOKEN"),
      "content-type": "application/json",
      ...options.headers
    }
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error("Cloudflare API operation failed for " + path);
  }
  return result.result;
}

const dns = JSON.parse(readFileSync("infra/cloudflare/dns.json", "utf8"));
const turnstile = JSON.parse(readFileSync("infra/cloudflare/turnstile.json", "utf8"));
const access = JSON.parse(readFileSync("infra/cloudflare/access.json", "utf8"));
const zoneId = required("CF_ZONE_ID");
const publicHostname = required("NOX_PUBLIC_APP_HOSTNAME");
const vercelTarget = required("VERCEL_PUBLIC_CNAME_TARGET");

if (dns.publicApplication.proxied !== false) {
  throw new Error("Public Vercel app must remain DNS-only.");
}
if (publicHostname.endsWith(".example.invalid")) {
  throw new Error("A real public hostname is required.");
}

const records = await cloudflare(
  "/zones/" + zoneId + "/dns_records?name=" + encodeURIComponent(publicHostname),
  { method: "GET" }
);
const record = {
  type: "CNAME",
  name: publicHostname,
  content: vercelTarget,
  ttl: 1,
  proxied: false
};
if (records.length === 0) {
  await cloudflare("/zones/" + zoneId + "/dns_records", {
    method: "POST",
    body: JSON.stringify(record)
  });
} else {
  await cloudflare("/zones/" + zoneId + "/dns_records/" + records[0].id, {
    method: "PATCH",
    body: JSON.stringify(record)
  });
}

if (process.env.CF_CREATE_TURNSTILE_WIDGET === "true") {
  const accountId = required("CF_ACCOUNT_ID");
  await cloudflare("/accounts/" + accountId + "/challenges/widgets", {
    method: "POST",
    body: JSON.stringify({
      name: turnstile.name,
      domains: [publicHostname],
      mode: turnstile.mode
    })
  });
}

if (process.env.CF_PRIVILEGED_PROXY_APPROVED === "true") {
  required("CF_ACCOUNT_ID");
  required("NOX_OPS_HOSTNAME");
  required("CF_ACCESS_IDENTITY_GROUP_ID");
  if (access.applicationAuthorization.accessIsNotRbac !== true) {
    throw new Error("Cloudflare Access can never replace NØX RBAC.");
  }
} else {
  console.log("CLOUDFLARE_ACCESS=AWAITING_EXPLICIT_PROXY_APPROVAL");
}

console.log("CLOUDFLARE_DNS=PASS");
