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

async function upsertDnsRecord(zoneId, record) {
  const records = await cloudflare(
    "/zones/" + zoneId + "/dns_records?name=" + encodeURIComponent(record.name),
    { method: "GET" }
  );
  const existing = records.find((candidate) => candidate.type === record.type);
  if (!existing) {
    await cloudflare("/zones/" + zoneId + "/dns_records", {
      method: "POST",
      body: JSON.stringify(record)
    });
    return;
  }
  await cloudflare("/zones/" + zoneId + "/dns_records/" + existing.id, {
    method: "PATCH",
    body: JSON.stringify(record)
  });
}

async function verifyDnsRecord(zoneId, expected) {
  const records = await cloudflare(
    "/zones/" + zoneId + "/dns_records?name=" + encodeURIComponent(expected.name),
    { method: "GET" }
  );
  const matches = records.filter((record) => record.type === expected.type);
  if (
    matches.length !== 1 ||
    matches[0].content !== expected.content ||
    matches[0].proxied !== expected.proxied
  ) {
    throw new Error("Cloudflare DNS verification detected a missing or ambiguous record.");
  }
}

async function ensureDnssec(zoneId) {
  let state = await cloudflare("/zones/" + zoneId + "/dnssec", { method: "GET" });
  if (state.status !== "active") {
    state = await cloudflare("/zones/" + zoneId + "/dnssec", { method: "POST" });
  }
  if (state.status !== "active") {
    throw new Error("Cloudflare DNSSEC did not reach active state.");
  }
}

async function verifyTurnstileSecret(secret) {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret,
      response: "nox-foundation-intentionally-invalid-token"
    })
  });
  const result = await response.json();
  const codes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
  if (!response.ok || result.success !== false || codes.includes("invalid-input-secret")) {
    throw new Error("Cloudflare Turnstile server-secret verification failed.");
  }
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

await upsertDnsRecord(zoneId, {
  type: "CNAME",
  name: publicHostname,
  content: vercelTarget,
  ttl: 1,
  proxied: false
});
await verifyDnsRecord(zoneId, {
  type: "CNAME",
  name: publicHostname,
  content: vercelTarget,
  proxied: false
});
await ensureDnssec(zoneId);

const accountId = required("CF_ACCOUNT_ID");
const configuredSiteKey = required("VITE_TURNSTILE_SITE_KEY");
const widgets = await cloudflare("/accounts/" + accountId + "/challenges/widgets", {
  method: "GET"
});
const namedWidgets = widgets.filter((widget) => widget.name === turnstile.name);
if (namedWidgets.length !== 1 || namedWidgets[0].sitekey !== configuredSiteKey) {
  throw new Error(
    "The canonical Turnstile widget and protected site key require one-time provider bootstrap."
  );
}
const widgetPayload = {
  name: turnstile.name,
  domains: [publicHostname],
  mode: turnstile.mode
};
let configured = namedWidgets[0];
if (
  configured.mode !== turnstile.mode ||
  configured.domains?.length !== 1 ||
  !configured.domains.includes(publicHostname)
) {
  configured = await cloudflare(
    "/accounts/" + accountId + "/challenges/widgets/" + configuredSiteKey,
    { method: "PUT", body: JSON.stringify(widgetPayload) }
  );
}
const verifiedWidget = await cloudflare(
  "/accounts/" + accountId + "/challenges/widgets/" + configuredSiteKey,
  { method: "GET" }
);
if (
  configured.sitekey !== configuredSiteKey ||
  verifiedWidget.sitekey !== configuredSiteKey ||
  verifiedWidget.name !== turnstile.name ||
  verifiedWidget.mode !== turnstile.mode ||
  verifiedWidget.domains?.length !== 1 ||
  !verifiedWidget.domains.includes(publicHostname)
) {
  throw new Error("Cloudflare Turnstile widget read-back verification failed.");
}
await verifyTurnstileSecret(required("TURNSTILE_SECRET_KEY"));
console.log("CLOUDFLARE_TURNSTILE=PASS");

if (process.env.CF_PRIVILEGED_PROXY_APPROVED === "true") {
  const privilegedHostname = required("NOX_OPS_HOSTNAME");
  const privilegedTarget = required("CF_PRIVILEGED_CNAME_TARGET");
  const groupId = required(access.policy.identityGroupEnvironmentKey);
  if (access.applicationAuthorization.accessIsNotRbac !== true) {
    throw new Error("Cloudflare Access can never replace NØX RBAC.");
  }
  const selectedGroup = await cloudflare("/accounts/" + accountId + "/access/groups/" + groupId, {
    method: "GET"
  });
  if (selectedGroup.id !== groupId) {
    throw new Error("Cloudflare Access identity-group read-back verification failed.");
  }

  await upsertDnsRecord(zoneId, {
    type: "CNAME",
    name: privilegedHostname,
    content: privilegedTarget,
    ttl: 1,
    proxied: true
  });
  await verifyDnsRecord(zoneId, {
    type: "CNAME",
    name: privilegedHostname,
    content: privilegedTarget,
    proxied: true
  });

  const applications = await cloudflare("/accounts/" + accountId + "/access/apps", {
    method: "GET"
  });
  const matchingApplications = applications.filter(
    (application) => application.domain === privilegedHostname
  );
  if (matchingApplications.length > 1) {
    throw new Error("Multiple Cloudflare Access applications claim the privileged hostname.");
  }
  const applicationPayload = {
    name: "NØX-OS privileged foundation",
    domain: privilegedHostname,
    type: access.applicationType,
    session_duration: "24h"
  };
  const existingApplication = matchingApplications[0];
  const application = existingApplication
    ? await cloudflare("/accounts/" + accountId + "/access/apps/" + existingApplication.id, {
        method: "PUT",
        body: JSON.stringify(applicationPayload)
      })
    : await cloudflare("/accounts/" + accountId + "/access/apps", {
        method: "POST",
        body: JSON.stringify(applicationPayload)
      });

  const policyPayload = {
    name: access.policy.name,
    decision: access.policy.action,
    include: [{ group: { id: groupId } }]
  };
  const policies = await cloudflare(
    "/accounts/" + accountId + "/access/apps/" + application.id + "/policies",
    { method: "GET" }
  );
  const matchingPolicies = policies.filter((policy) => policy.name === access.policy.name);
  if (matchingPolicies.length > 1) {
    throw new Error("Multiple Cloudflare Access policies claim the canonical name.");
  }
  const existingPolicy = matchingPolicies[0];
  if (existingPolicy) {
    await cloudflare(
      "/accounts/" +
        accountId +
        "/access/apps/" +
        application.id +
        "/policies/" +
        existingPolicy.id,
      { method: "PUT", body: JSON.stringify(policyPayload) }
    );
  } else {
    await cloudflare("/accounts/" + accountId + "/access/apps/" + application.id + "/policies", {
      method: "POST",
      body: JSON.stringify(policyPayload)
    });
  }

  const verifiedApplications = await cloudflare("/accounts/" + accountId + "/access/apps", {
    method: "GET"
  });
  const verifiedApplicationMatches = verifiedApplications.filter(
    (candidate) =>
      candidate.domain === privilegedHostname && candidate.type === access.applicationType
  );
  if (verifiedApplicationMatches.length !== 1) {
    throw new Error("Cloudflare Access application read-back verification failed.");
  }
  const verifiedPolicies = await cloudflare(
    "/accounts/" + accountId + "/access/apps/" + verifiedApplicationMatches[0].id + "/policies",
    { method: "GET" }
  );
  const verifiedPolicyMatches = verifiedPolicies.filter(
    (candidate) =>
      candidate.name === access.policy.name &&
      candidate.decision === access.policy.action &&
      candidate.include?.some((rule) => rule.group?.id === groupId)
  );
  if (verifiedPolicyMatches.length !== 1) {
    throw new Error("Cloudflare Access policy read-back verification failed.");
  }
  console.log("CLOUDFLARE_ACCESS=PASS");
} else {
  throw new Error("Cloudflare Access reconciliation requires explicit privileged-proxy approval.");
}

console.log("CLOUDFLARE_DNS=PASS");
console.log("CLOUDFLARE_DNSSEC=PASS");
