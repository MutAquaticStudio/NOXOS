import { describe, expect, it } from "vitest";
import {
  PLATFORM_PERMISSIONS,
  PermissionDeniedError,
  hasPermission,
  requirePermission,
  resolvePlatformPermissions,
  resolveTenantPermissions,
  TENANT_PERMISSIONS
} from "@nox-os/tenancy";

describe("static G2-A RBAC", () => {
  it("grants every and only canonical Platform permission to PLATFORM_OWNER", () => {
    expect(resolvePlatformPermissions("PLATFORM_OWNER")).toEqual(PLATFORM_PERMISSIONS);
    expect(resolvePlatformPermissions("TENANT_OWNER")).toEqual([]);
    expect(resolvePlatformPermissions(undefined)).toEqual([]);
  });

  it("resolves the three tenant roles without wildcard fallback", () => {
    expect(resolveTenantPermissions("TENANT_OWNER")).toEqual(TENANT_PERMISSIONS);
    expect(resolveTenantPermissions("TENANT_ADMIN")).toEqual([
      "tenant.profile.read",
      "tenant.membership.read",
      "tenant.membership.manage",
      "tenant.entitlement.read"
    ]);
    expect(resolveTenantPermissions("TENANT_MEMBER")).toEqual([
      "tenant.profile.read",
      "tenant.membership.read",
      "tenant.entitlement.read"
    ]);
    expect(resolveTenantPermissions("unknown")).toEqual([]);
  });

  it("fails closed for unknown permissions", () => {
    expect(hasPermission(PLATFORM_PERMISSIONS, "platform.tenant.create")).toBe(true);
    expect(hasPermission(PLATFORM_PERMISSIONS, "platform.*")).toBe(false);
    expect(hasPermission(PLATFORM_PERMISSIONS, "tenant.profile.read")).toBe(false);
    expect(() => requirePermission([], "platform.tenant.create")).toThrow(PermissionDeniedError);
  });
});
