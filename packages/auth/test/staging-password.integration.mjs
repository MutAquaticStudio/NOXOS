import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createSupabasePasswordAdapter } from "../dist/supabase-password.js";

test("real Staging provider verifies a temporary password identity without application authority", async () => {
  if (process.env.APP_ENV !== "staging") throw Error("STAGING_ONLY");
  const url = "https://uyfddpmbszjkhdkqvncz.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("MISSING_PROTECTED_AUTH_FIXTURE_KEY");
  // Public provider key read from the canonical Staging project; not a secret.
  const publishableKey = "sb_publishable_8VJhorH40fliafv7cUtcdg_WFv28ML-";
  const adapter = createSupabasePasswordAdapter({ environment: "staging", url, publishableKey });
  const email = `v24-auth-${randomUUID()}@example.test`;
  const password = `${randomBytes(32).toString("base64url")}aA1!`;
  const adminHeaders = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json"
  };
  let userId;
  let phase = "PROVISION";
  try {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ email, password, email_confirm: true })
    });
    if (!created.ok) throw Error("PROVISION_FAILED");
    const user = await created.json();
    if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id))
      throw Error("INVALID_FIXTURE_ID");
    userId = user.id;
    phase = "VERIFY";
    const identity = await adapter.verifyPassword({ identifier: email, password });
    assert.equal(identity.kind, "VERIFIED");
    assert.equal(identity.subject, userId);
    assert.equal(identity.issuer, `${url}/auth/v1`);
    assert.equal(identity.assurance, "A1");
    assert.equal(identity.environment, "staging");
    assert.equal("tenantId" in identity, false);
    assert.equal("access_token" in identity, false);
    assert.equal("refresh_token" in identity, false);
    phase = "DENIAL";
    assert.deepEqual(
      await adapter.verifyPassword({ identifier: email, password: `${password}-wrong` }),
      { kind: "DENIED" }
    );
  } catch {
    throw Error(`STAGING_PASSWORD_ACCEPTANCE_FAILED:${phase}`);
  } finally {
    if (userId) {
      const removed = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: adminHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      if (!removed.ok) throw Error("STAGING_AUTH_FIXTURE_CLEANUP_FAILED");
      const absent = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        headers: adminHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      if (absent.status !== 404) throw Error("STAGING_AUTH_FIXTURE_ABSENCE_NOT_PROVEN");
    }
  }
});
