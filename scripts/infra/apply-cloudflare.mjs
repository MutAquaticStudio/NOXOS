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

if (process.env.CF_CREATE_TURNSTILE_WIDGET === "true") {
  const accountId = required("CF_ACCOUNT_ID");
  const widgets = await cloudflare("/accounts/" + accountId + "/challenges/widgets", {
    method: "GET"
  });
  const configured = widgets.find(
    (widget) => widget.name === turnstile.name && widget.domains?.includes(publicHostname)
  );
  if (!configured) {
    await cloudflare("/accounts/" + accountId + "/challenges/widgets", {
      method: "POST",
      body: JSON.stringify({
        name: turnstile.name,
        domains: [publicHostname],
        mode: turnstile.mode
      })
    });
  }
}

if (process.env.CF_PRIVILEGED_PROXY_APPROVED === "true") {
  const accountId = required("CF_ACCOUNT_ID");
  const privilegedHostname = required("NOX_OPS_HOSTNAME");
  const privilegedTarget = required("CF_PRIVILEGED_CNAME_TARGET");
  const groupId = required(access.policy.identityGroupEnvironmentKey);
  if (access.applicationAuthorization.accessIsNotRbac !== true) {
    throw new Error("Cloudflare Access can never replace NØX RBAC.");
  }

  await upsertDnsRecord(zoneId, {
    type: "CNAME",
    name: privilegedHostname,
    content: privilegedTarget,
    ttl: 1,
    proxied: true
  });

  const applications = await cloudflare("/accounts/" + accountId + "/access/apps", {
    method: "GET"
  });
  const applicationPayload = {
    name: "NØX-OS privileged foundation",
    domain: privilegedHostname,
    type: access.applicationType,
    session_duration: "24h"
  };
  const existingApplication = applications.find(
    (application) => application.domain === privilegedHostname
  );
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
  const existingPolicy = policies.find((policy) => policy.name === access.policy.name);
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
  console.log("CLOUDFLARE_ACCESS=PASS");
} else {
  console.log("CLOUDFLARE_ACCESS=AWAITING_EXPLICIT_PROXY_APPROVAL");
}

console.log("CLOUDFLARE_DNS=PASS");
