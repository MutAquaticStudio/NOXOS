import type { ModuleAvailability, TenantRoleKey } from "@nox-os/contracts";

// Validate only the fields consumed by the Shell. These are response projections,
// not another RBAC resolver, entitlement policy or canonical database model.
export type TenantChoice = { tenantId: string; name: string; slug: string; roleKey: TenantRoleKey };
export type PlatformIdentity = {
  id: string;
  platformRoleKey: "PLATFORM_OWNER" | null;
  platformPermissions: string[];
};
export type TenantContextPayload = {
  tenant: { tenantId: string; roleKey: TenantRoleKey };
  authorization: { tenantPermissions: string[]; modulePermissions: string[] };
  moduleAvailability: ModuleAvailability[];
};

function invalid(): never {
  throw new Error("Invalid context response.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : invalid();
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0))
    return invalid();
  return [...value];
}
function role(value: unknown): TenantRoleKey {
  if (value === "TENANT_OWNER" || value === "TENANT_ADMIN" || value === "TENANT_MEMBER")
    return value;
  return invalid();
}

export function readTenantChoices(raw: unknown): TenantChoice[] {
  const items = object(raw).tenants;
  if (!Array.isArray(items)) return invalid();
  const seen = new Set<string>();
  return items.map((item) => {
    const membership = object(item),
      tenant = object(membership.tenant);
    const tenantId = text(tenant.id);
    if (seen.has(tenantId)) return invalid();
    seen.add(tenantId);
    return {
      tenantId,
      name: text(tenant.name),
      slug: text(tenant.slug),
      roleKey: role(membership.roleKey)
    };
  });
}

export function readPlatformIdentity(raw: unknown, expectedUserId: string): PlatformIdentity {
  const user = object(object(raw).user);
  if (
    user.id !== expectedUserId ||
    user.status !== "ACTIVE" ||
    (user.platformRoleKey !== null && user.platformRoleKey !== "PLATFORM_OWNER")
  )
    return invalid();
  return {
    id: expectedUserId,
    platformRoleKey: user.platformRoleKey,
    platformPermissions: strings(user.platformPermissions)
  };
}

export function readTenantContext(raw: unknown, expectedTenantId: string): TenantContextPayload {
  const payload = object(raw),
    tenant = object(payload.tenant),
    authorization = object(payload.authorization);
  if (tenant.tenantId !== expectedTenantId || !Array.isArray(payload.moduleAvailability))
    return invalid();
  const seen = new Set<string>();
  const moduleAvailability = payload.moduleAvailability.map((item) => {
    const entry = object(item),
      moduleId = text(entry.moduleId);
    if (
      seen.has(moduleId) ||
      typeof entry.visible !== "boolean" ||
      typeof entry.enabled !== "boolean" ||
      typeof entry.state !== "string" ||
      !["AVAILABLE", "NOT_ENTITLED", "NO_PERMISSION", "DISABLED", "BETA_RESTRICTED"].includes(
        entry.state
      ) ||
      (entry.reason !== undefined && typeof entry.reason !== "string")
    )
      return invalid();
    seen.add(moduleId);
    return {
      moduleId,
      state: entry.state as ModuleAvailability["state"],
      visible: entry.visible,
      enabled: entry.enabled,
      ...(entry.reason === undefined ? {} : { reason: entry.reason })
    };
  });
  return {
    tenant: { tenantId: expectedTenantId, roleKey: role(tenant.roleKey) },
    authorization: {
      tenantPermissions: strings(authorization.tenantPermissions),
      modulePermissions: strings(authorization.modulePermissions)
    },
    moduleAvailability
  };
}
