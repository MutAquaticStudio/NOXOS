import { describe, expect, it } from "vitest";
import type { ApiRequest } from "@nox-os/contracts";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import { createFoundationApi, createPlatformCoreApi, createRequestContext } from "@nox-os/platform";
import { UnavailableScientificAdapter } from "@nox-os/scientific";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { InMemoryPlatformStore } from "../helpers/in-memory-platform-store";
import { foundationTestDefinition } from "../helpers/foundation-test-module";

const IDs = {
  platformOwner: "00000000-0000-4000-8000-000000000001",
  tenantAOwner: "00000000-0000-4000-8000-000000000002",
  tenantBOwner: "00000000-0000-4000-8000-000000000003",
  tenantAMember: "00000000-0000-4000-8000-000000000004",
  tenantAAdmin: "00000000-0000-4000-8000-000000000005",
  tenantADisabled: "00000000-0000-4000-8000-000000000006",
  unprivileged: "00000000-0000-4000-8000-000000000007",
  tenantA: "10000000-0000-4000-8000-000000000001",
  tenantB: "10000000-0000-4000-8000-000000000002"
} as const;

function fixture() {
  const store = new InMemoryPlatformStore();
  store.seedUser({ id: IDs.platformOwner, platformRoleKey: "PLATFORM_OWNER" });
  store.seedUser({ id: IDs.tenantAOwner });
  store.seedUser({ id: IDs.tenantBOwner });
  store.seedUser({ id: IDs.tenantAMember });
  store.seedUser({ id: IDs.tenantAAdmin });
  store.seedUser({ id: IDs.tenantADisabled });
  store.seedUser({ id: IDs.unprivileged });
  store.seedTenant({ id: IDs.tenantA, name: "Tenant A", slug: "tenant-a" });
  store.seedTenant({ id: IDs.tenantB, name: "Tenant B", slug: "tenant-b" });
  store.seedMembership({
    tenantId: IDs.tenantA,
    userId: IDs.tenantAOwner,
    roleKey: "TENANT_OWNER"
  });
  store.seedMembership({
    tenantId: IDs.tenantB,
    userId: IDs.tenantBOwner,
    roleKey: "TENANT_OWNER"
  });
  store.seedMembership({
    tenantId: IDs.tenantA,
    userId: IDs.tenantAMember,
    roleKey: "TENANT_MEMBER"
  });
  store.seedMembership({
    tenantId: IDs.tenantA,
    userId: IDs.tenantAAdmin,
    roleKey: "TENANT_ADMIN"
  });
  store.seedMembership({
    tenantId: IDs.tenantB,
    userId: IDs.tenantAAdmin,
    roleKey: "TENANT_MEMBER"
  });
  store.seedMembership({
    tenantId: IDs.tenantA,
    userId: IDs.tenantADisabled,
    roleKey: "TENANT_MEMBER",
    status: "DISABLED"
  });
  const core = createPlatformCoreApi({
    store,
    accessTokenVerifier: {
      async verifyAccessToken(token) {
        const userId = Object.values(IDs).find((id) => id === token);
        return userId ? { kind: "AUTHENTICATED", identity: { userId } } : { kind: "AUTH_INVALID" };
      }
    },
    moduleDefinitions: [foundationTestDefinition()],
    featureFlags: new LocalFeatureFlagResolver(["module.foundation-test"])
  });
  const api = createFoundationApi({
    modules: moduleDefinitions,
    scientificGateway: new UnavailableScientificAdapter(),
    environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "g2-test-sha" },
    platformCore: core
  });
  return { api, core, store };
}

async function request(
  api: ReturnType<typeof createFoundationApi>,
  input: {
    method?: string;
    path: string;
    actor?: string;
    tenantId?: string;
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  }
) {
  const headers: Record<string, string> = { "x-correlation-id": "corr_g2_test", ...input.headers };
  if (input.actor) headers.authorization = `Bearer ${input.actor}`;
  if (input.tenantId) headers["x-nox-tenant-id"] = input.tenantId;
  const apiRequest: ApiRequest = {
    method: input.method ?? "GET",
    path: input.path,
    headers,
    query: input.query,
    body: input.body,
    context: createRequestContext(api.identity, headers)
  };
  return api.dispatch(apiRequest);
}

describe("G2-A Platform Core", () => {
  it("enforces bearer authentication and ignores forged authority headers", async () => {
    const { api } = fixture();
    const missing = await request(api, { path: "/me" });
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

    const forged = await request(api, {
      path: "/platform/tenants",
      actor: IDs.unprivileged,
      headers: {
        "x-role": "PLATFORM_OWNER",
        "x-permission": "platform.tenant.read",
        "x-permissions": "platform.tenant.read",
        "x-is-admin": "true",
        "x-is-owner": "true",
        "x-platform-role": "PLATFORM_OWNER",
        "x-user-id": IDs.platformOwner
      }
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toMatchObject({ error: { code: "PLATFORM_ACCESS_DENIED" } });
  });

  it("keeps PlatformOwner and tenant authority separate", async () => {
    const { api } = fixture();
    const platform = await request(api, { path: "/platform/tenants", actor: IDs.platformOwner });
    expect(platform.status).toBe(200);
    const tenant = await request(api, {
      path: "/tenant",
      actor: IDs.platformOwner,
      tenantId: IDs.tenantA
    });
    expect(tenant.status).toBe(403);
    expect(tenant.body).toMatchObject({ error: { code: "TENANT_ACCESS_DENIED" } });
  });

  it("enforces tenant isolation and tenant role boundaries", async () => {
    const { api } = fixture();
    const crossTenant = await request(api, {
      path: "/tenant",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantB
    });
    expect(crossTenant.status).toBe(403);

    const adminOwnerPromotion = await request(api, {
      method: "PATCH",
      path: `/tenant/members/${IDs.tenantAMember}`,
      actor: IDs.tenantAAdmin,
      tenantId: IDs.tenantA,
      body: { roleKey: "TENANT_OWNER" }
    });
    expect(adminOwnerPromotion.status).toBe(403);
    expect(adminOwnerPromotion.body).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
  });

  it("rejects duplicate slugs and duplicate memberships", async () => {
    const { api } = fixture();
    const duplicateSlug = await request(api, {
      method: "POST",
      path: "/platform/tenants",
      actor: IDs.platformOwner,
      body: { name: "Duplicate", slug: "tenant-a", initialOwnerUserId: IDs.tenantAOwner }
    });
    expect(duplicateSlug.status).toBe(409);
    expect(duplicateSlug.body).toMatchObject({ error: { code: "TENANT_SLUG_CONFLICT" } });

    const duplicateMembership = await request(api, {
      method: "POST",
      path: `/platform/tenants/${IDs.tenantA}/members`,
      actor: IDs.platformOwner,
      body: { userId: IDs.tenantAMember, roleKey: "TENANT_MEMBER" }
    });
    expect(duplicateMembership.status).toBe(409);
    expect(duplicateMembership.body).toMatchObject({
      error: { code: "MEMBERSHIP_ALREADY_EXISTS" }
    });
  });

  it("preserves the last PlatformOwner and effective TenantOwner", async () => {
    const { api } = fixture();
    const lastPlatformOwner = await request(api, {
      method: "PATCH",
      path: `/platform/users/${IDs.platformOwner}`,
      actor: IDs.platformOwner,
      body: { platformRoleKey: null }
    });
    expect(lastPlatformOwner.status).toBe(409);
    expect(lastPlatformOwner.body).toMatchObject({
      error: { code: "LAST_ACTIVE_PLATFORM_OWNER_REQUIRED" }
    });

    const lastTenantOwner = await request(api, {
      method: "PATCH",
      path: `/tenant/members/${IDs.tenantAOwner}`,
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA,
      body: { roleKey: "TENANT_MEMBER" }
    });
    expect(lastTenantOwner.status).toBe(409);
    expect(lastTenantOwner.body).toMatchObject({
      error: { code: "LAST_ACTIVE_TENANT_OWNER_REQUIRED" }
    });

    const disableOwner = await request(api, {
      method: "PATCH",
      path: `/platform/users/${IDs.tenantAOwner}`,
      actor: IDs.platformOwner,
      body: { status: "DISABLED" }
    });
    expect(disableOwner.status).toBe(409);
    expect(disableOwner.body).toMatchObject({ error: { code: "TENANT_OWNER_DEPENDENCY_EXISTS" } });
  });

  it("serializes concurrent owner disables so no tenant becomes ownerless", async () => {
    const { api, store } = fixture();
    store.seedMembership({
      tenantId: IDs.tenantA,
      userId: IDs.tenantAMember,
      roleKey: "TENANT_OWNER"
    });
    const [first, second] = await Promise.all([
      request(api, {
        method: "PATCH",
        path: `/platform/users/${IDs.tenantAOwner}`,
        actor: IDs.platformOwner,
        body: { status: "DISABLED" }
      }),
      request(api, {
        method: "PATCH",
        path: `/platform/users/${IDs.tenantAMember}`,
        actor: IDs.platformOwner,
        body: { status: "DISABLED" }
      })
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await store.countEffectiveActiveTenantOwners(IDs.tenantA)).toBe(1);
  });

  it("bootstraps an existing identity as PlatformOwner without an HTTP route or persistent bootstrap secret", async () => {
    const { core, store } = fixture();
    const first = await core.bootstrapPlatformOwner({
      userId: IDs.unprivileged,
      requestId: "bootstrap_request",
      correlationId: "bootstrap_correlation"
    });
    const second = await core.bootstrapPlatformOwner({
      userId: IDs.unprivileged,
      requestId: "bootstrap_request_second",
      correlationId: "bootstrap_correlation_second"
    });
    expect(first).toMatchObject({ status: "ACTIVE", platformRoleKey: "PLATFORM_OWNER" });
    expect(second).toMatchObject({ status: "ACTIVE", platformRoleKey: "PLATFORM_OWNER" });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      action: "platform.owner.bootstrap",
      actorUserId: null
    });
  });

  it("validates registered entitlement keys, reflects them in tenant context, and skips audit on no-op", async () => {
    const { api, store } = fixture();
    const unknown = await request(api, {
      method: "PUT",
      path: `/platform/tenants/${IDs.tenantA}/entitlements/module.unknown`,
      actor: IDs.platformOwner,
      body: { enabled: true }
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ error: { code: "UNKNOWN_ENTITLEMENT_KEY" } });

    const before = store.auditEvents.length;
    const enabled = await request(api, {
      method: "PUT",
      path: `/platform/tenants/${IDs.tenantA}/entitlements/module.foundation-test`,
      actor: IDs.platformOwner,
      body: { enabled: true }
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({ changed: true, entitlement: { enabled: true } });
    expect(store.auditEvents).toHaveLength(before + 1);

    const repeated = await request(api, {
      method: "PUT",
      path: `/platform/tenants/${IDs.tenantA}/entitlements/module.foundation-test`,
      actor: IDs.platformOwner,
      body: { enabled: true }
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ changed: false });
    expect(store.auditEvents).toHaveLength(before + 1);

    const context = await request(api, {
      path: "/context",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA
    });
    expect(context.status).toBe(200);
    expect(context.body).toMatchObject({
      entitlements: ["module.foundation-test"],
      moduleAvailability: [{ moduleId: "foundation-test", state: "AVAILABLE" }]
    });

    const disabled = await request(api, {
      method: "PUT",
      path: `/platform/tenants/${IDs.tenantA}/entitlements/module.foundation-test`,
      actor: IDs.platformOwner,
      body: { enabled: false }
    });
    expect(disabled.status).toBe(200);
    const afterDisabled = await request(api, {
      path: "/context",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA
    });
    expect(afterDisabled.body).toMatchObject({
      moduleAvailability: [{ moduleId: "foundation-test", state: "NOT_ENTITLED" }]
    });

    const tenantEntitlements = await request(api, {
      path: "/tenant/entitlements",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA
    });
    expect(tenantEntitlements.status).toBe(200);
    expect(tenantEntitlements.body).toMatchObject({
      entitlements: [{ key: "module.foundation-test", enabled: false }]
    });
  });

  it("records the required audit actions atomically and exposes only read-only audit data", async () => {
    const { api, store } = fixture();
    const tenantRename = await request(api, {
      method: "PATCH",
      path: "/tenant",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA,
      body: { name: "Tenant A renamed" }
    });
    expect(tenantRename.status).toBe(200);
    const membershipRole = await request(api, {
      method: "PATCH",
      path: `/tenant/members/${IDs.tenantAMember}`,
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA,
      body: { roleKey: "TENANT_ADMIN" }
    });
    expect(membershipRole.status).toBe(200);
    const status = await request(api, {
      method: "PATCH",
      path: `/platform/tenants/${IDs.tenantA}`,
      actor: IDs.platformOwner,
      body: { status: "SUSPENDED" }
    });
    expect(status.status).toBe(200);
    expect(store.auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "tenant.profile.update",
        "tenant.membership.role.update",
        "platform.tenant.status.update"
      ])
    );

    const audit = await request(api, {
      path: "/platform/audit",
      actor: IDs.platformOwner,
      query: { tenantId: IDs.tenantA, limit: "50", offset: "0" }
    });
    expect(audit.status).toBe(200);
    expect(audit.body).toMatchObject({ events: expect.any(Array), limit: 50, offset: 0 });
    const tenantMember = await request(api, {
      path: "/platform/audit",
      actor: IDs.tenantAOwner
    });
    expect(tenantMember.status).toBe(403);
  });

  it("rolls a representative mutation back when its audit insert fails", async () => {
    const { api, store } = fixture();
    store.setAuditInsertFailure(true);
    const attempted = await request(api, {
      method: "PATCH",
      path: "/tenant",
      actor: IDs.tenantAOwner,
      tenantId: IDs.tenantA,
      body: { name: "This must not commit" }
    });
    expect(attempted.status).toBe(500);
    expect((await store.findTenant(IDs.tenantA))?.name).toBe("Tenant A");
    expect(store.auditEvents).toHaveLength(0);
  });

  it("serializes concurrent PlatformOwner role removals so one active owner remains", async () => {
    const { api, store } = fixture();
    store.seedUser({ id: IDs.unprivileged, platformRoleKey: "PLATFORM_OWNER" });
    const [first, second] = await Promise.all([
      request(api, {
        method: "PATCH",
        path: `/platform/users/${IDs.platformOwner}`,
        actor: IDs.platformOwner,
        body: { platformRoleKey: null }
      }),
      request(api, {
        method: "PATCH",
        path: `/platform/users/${IDs.unprivileged}`,
        actor: IDs.platformOwner,
        body: { platformRoleKey: null }
      })
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await store.countActivePlatformOwners()).toBe(1);
  });
});
