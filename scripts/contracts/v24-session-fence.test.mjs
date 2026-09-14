import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTenantSessionCurrent,
  sessionCookie,
  readSessionCookie,
  clearSessionCookie,
  assertMutationOrigin
} from "../../packages/auth/src/session-fence.ts";

const now = Date.parse("2026-09-14T05:00:00.000Z");
const session = {
  id: "session-1",
  actorKind: "TENANT_USER",
  actorId: "user-a",
  tenantId: "tenant-a",
  issuedHost: "a.example.test",
  routingVersionAtIssue: 1,
  realm: "TENANT",
  mode: "NORMAL",
  assurance: "A1",
  credentialEpoch: "c1",
  authorizationEpoch: "a1",
  state: "ACTIVE",
  entityVersion: 1,
  issuedAt: "2026-09-14T04:30:00.000Z",
  lastAuthoritativeActivityAt: "2026-09-14T04:55:00.000Z",
  idleExpiresAt: "2026-09-14T05:10:00.000Z",
  absoluteExpiresAt: "2026-09-14T08:00:00.000Z"
};
const authority = {
  tenantId: "tenant-a",
  actorId: "user-a",
  host: "a.example.test",
  routingVersion: 1,
  routeState: "ACTIVE",
  actorState: "ACTIVE",
  tenantState: "ACTIVE",
  bindingState: "ACTIVE",
  credentialEpoch: "c1",
  authorizationEpoch: "a1"
};

test("current normal tenant session passes the read fence", () => {
  assert.doesNotThrow(() => assertTenantSessionCurrent(session, authority, now));
});

test("session/host/actor/epoch mismatches, limited mode and platform realm deny business access", () => {
  for (const patch of [
    { tenantId: "tenant-b" },
    { actorId: "user-b" },
    { issuedHost: "b.example.test" },
    { routingVersionAtIssue: 2 },
    { credentialEpoch: "c0" },
    { authorizationEpoch: "a0" },
    { state: "REVOKED" },
    { state: "UNKNOWN" },
    { mode: "ACCOUNT_ONLY" },
    { realm: "PLATFORM" },
    { actorKind: "PLATFORM_ACTOR" },
    { assurance: "unknown" },
    { entityVersion: 0 }
  ])
    assert.throws(() => assertTenantSessionCurrent({ ...session, ...patch }, authority, now));
});

test("current authority is rechecked independently of a still-active session", () => {
  for (const patch of [
    { routeState: "REDIRECT_ALIAS" },
    { actorState: "DISABLED" },
    { tenantState: "SUSPENDED" },
    { bindingState: "DISABLED" },
    { routingVersion: 2 },
    { credentialEpoch: "c2" },
    { authorizationEpoch: "a2" }
  ]) {
    assert.throws(() => assertTenantSessionCurrent(session, { ...authority, ...patch }, now));
  }
});

test("idle and absolute limits are exclusive, malformed/future clock fields fail closed", () => {
  assert.throws(() =>
    assertTenantSessionCurrent(session, authority, Date.parse(session.idleExpiresAt))
  );
  assert.throws(() =>
    assertTenantSessionCurrent(
      { ...session, idleExpiresAt: session.absoluteExpiresAt },
      authority,
      Date.parse(session.absoluteExpiresAt)
    )
  );
  for (const field of [
    "issuedAt",
    "lastAuthoritativeActivityAt",
    "idleExpiresAt",
    "absoluteExpiresAt"
  ]) {
    assert.throws(() =>
      assertTenantSessionCurrent({ ...session, [field]: "invalid" }, authority, now)
    );
  }
  assert.throws(() =>
    assertTenantSessionCurrent({ ...session, issuedAt: "2026-09-14T06:00:00.000Z" }, authority, now)
  );
  assert.throws(() => assertTenantSessionCurrent(session, authority, NaN));
});

test("cookie is host-only, strict, opaque, and expires no later than server absolute expiry", () => {
  const secret = Buffer.alloc(32, 1).toString("base64url");
  const cookie = sessionCookie(secret, now + 1999, now);
  assert.equal(
    cookie,
    `__Host-noxos-session=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1`
  );
  assert.equal(readSessionCookie(cookie), secret);
  assert.equal(
    readSessionCookie(`x=1; __Host-noxos-session=${secret}; __Host-noxos-session=${secret}`),
    null
  );
  assert.equal(readSessionCookie(`__Host-noxos-session=${secret}=`), null);
  assert.equal(readSessionCookie("authorization=Bearer-fake"), null);
  assert.throws(() => sessionCookie("invalid\r\nX-Evil: true", now + 1000, now));
  assert.throws(() => sessionCookie(secret, now, now));
  assert.match(clearSessionCookie(), /Max-Age=0$/);
});

test("mutation origin must exactly match server-resolved host, cross-site metadata denies", () => {
  assert.doesNotThrow(() =>
    assertMutationOrigin("a.example.test", "https://a.example.test", "same-origin")
  );
  for (const origin of [
    undefined,
    "null",
    "https://b.example.test",
    "https://a.example.test:443",
    "https://a.example.test/"
  ]) {
    assert.throws(() => assertMutationOrigin("a.example.test", origin, "same-origin"));
  }
  assert.throws(() =>
    assertMutationOrigin("a.example.test", "https://a.example.test", "cross-site")
  );
});
