import { describe, expect, it } from "vitest";
import {
  readPlatformIdentity,
  readTenantChoices,
  readTenantContext
} from "../../apps/nox-os/src/context-response";

const membership = {
  roleKey: "TENANT_MEMBER",
  tenant: { id: "tenant-a", name: "Tenant A", slug: "tenant-a" }
};
const identity = {
  user: {
    id: "user-a",
    status: "ACTIVE",
    platformRoleKey: "PLATFORM_OWNER",
    platformPermissions: ["platform.tenant.read"]
  }
};
const context = {
  tenant: { tenantId: "tenant-a", roleKey: "TENANT_MEMBER" },
  authorization: { tenantPermissions: ["tenant.profile.read"], modulePermissions: [] },
  moduleAvailability: [
    { moduleId: "material-intelligence", state: "NOT_ENTITLED", visible: false, enabled: false }
  ]
};

describe("Shell consumes bound, structurally valid server context", () => {
  it("distinguishes verified empty choices from missing, malformed or duplicate memberships", () => {
    expect(readTenantChoices({ tenants: [] })).toEqual([]);
    expect(readTenantChoices({ tenants: [membership] })).toEqual([
      { tenantId: "tenant-a", name: "Tenant A", slug: "tenant-a", roleKey: "TENANT_MEMBER" }
    ]);
    for (const raw of [
      null,
      {},
      { tenants: {} },
      { tenants: [membership, membership] },
      { tenants: [{ ...membership, roleKey: "PLATFORM_OWNER" }] }
    ])
      expect(() => readTenantChoices(raw)).toThrow();
  });
  it("accepts only the authenticated active identity, never grants from another user's DTO", () => {
    expect(readPlatformIdentity(identity, "user-a").platformPermissions).toEqual([
      "platform.tenant.read"
    ]);
    for (const user of [
      { ...identity.user, id: "user-b" },
      { ...identity.user, status: "DISABLED" },
      { ...identity.user, platformRoleKey: "ADMIN" },
      { ...identity.user, platformPermissions: null }
    ])
      expect(() => readPlatformIdentity({ user }, "user-a")).toThrow();
  });
  it("checks exact tenant binding and preserves server decisions rather than deriving grants from role", () => {
    expect(readTenantContext(context, "tenant-a")).toEqual(context);
    expect(() => readTenantContext(context, "tenant-b")).toThrow();
    for (const raw of [
      {},
      { ...context, authorization: {} },
      { ...context, tenant: { ...context.tenant, roleKey: "ADMIN" } },
      {
        ...context,
        moduleAvailability: [context.moduleAvailability[0], context.moduleAvailability[0]]
      },
      { ...context, moduleAvailability: [{ ...context.moduleAvailability[0], state: "UNKNOWN" }] },
      {
        ...context,
        moduleAvailability: [{ ...context.moduleAvailability[0], state: ["AVAILABLE"] }]
      },
      { ...context, moduleAvailability: [{ ...context.moduleAvailability[0], visible: "true" }] }
    ])
      expect(() => readTenantContext(raw, "tenant-a")).toThrow();
  });
});
