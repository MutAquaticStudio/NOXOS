import type {
  ActorContext,
  PlatformPermission,
  PlatformRoleKey,
  TenantContext,
  TenantPermission,
  TenantRoleKey
} from "@nox-os/contracts";

export const PLATFORM_PERMISSIONS = [
  "platform.user.read",
  "platform.user.provision",
  "platform.user.status.manage",
  "platform.owner.manage",
  "platform.tenant.read",
  "platform.tenant.create",
  "platform.tenant.status.manage",
  "platform.membership.read",
  "platform.membership.manage",
  "platform.membership.owner.manage",
  "platform.entitlement.read",
  "platform.entitlement.manage",
  "platform.audit.read"
] as const satisfies readonly PlatformPermission[];

export const TENANT_PERMISSIONS = [
  "tenant.profile.read",
  "tenant.profile.manage",
  "tenant.membership.read",
  "tenant.membership.manage",
  "tenant.membership.owner.manage",
  "tenant.entitlement.read"
] as const satisfies readonly TenantPermission[];

const platformPermissionSet = new Set<string>(PLATFORM_PERMISSIONS);
const tenantPermissionSet = new Set<string>(TENANT_PERMISSIONS);

const tenantRolePermissions: Readonly<Record<TenantRoleKey, readonly TenantPermission[]>> = {
  TENANT_OWNER: [
    "tenant.profile.read",
    "tenant.profile.manage",
    "tenant.membership.read",
    "tenant.membership.manage",
    "tenant.membership.owner.manage",
    "tenant.entitlement.read"
  ],
  TENANT_ADMIN: [
    "tenant.profile.read",
    "tenant.membership.read",
    "tenant.membership.manage",
    "tenant.entitlement.read"
  ],
  TENANT_MEMBER: ["tenant.profile.read", "tenant.membership.read", "tenant.entitlement.read"]
};

export class PermissionDeniedError extends Error {
  constructor(permission: string) {
    super("Permission is not granted: " + permission);
  }
}

function isPlatformRole(value: string | null | undefined): value is PlatformRoleKey {
  return value === "PLATFORM_OWNER";
}

function isTenantRole(value: string | null | undefined): value is TenantRoleKey {
  return value === "TENANT_OWNER" || value === "TENANT_ADMIN" || value === "TENANT_MEMBER";
}

export function resolvePlatformPermissions(
  role: string | null | undefined
): readonly PlatformPermission[] {
  return isPlatformRole(role) ? PLATFORM_PERMISSIONS : [];
}

export function resolveTenantPermissions(
  role: string | null | undefined
): readonly TenantPermission[] {
  return isTenantRole(role) ? tenantRolePermissions[role] : [];
}

export function hasPermission(permissions: readonly string[], permission: string): boolean {
  const knownPermission =
    platformPermissionSet.has(permission) || tenantPermissionSet.has(permission);
  return knownPermission && permissions.includes(permission);
}

export function requirePermission(permissions: readonly string[], permission: string): void {
  if (!hasPermission(permissions, permission)) {
    throw new PermissionDeniedError(permission);
  }
}

export interface TenantResolver {
  resolve(actor: ActorContext | undefined): Promise<TenantContext | undefined>;
}

export interface AuthorizationPort {
  canAccess(
    actor: ActorContext | undefined,
    tenant: TenantContext | undefined,
    permission: string
  ): Promise<boolean>;
}

export const denyByDefaultAuthorization: AuthorizationPort = {
  async canAccess(): Promise<boolean> {
    return false;
  }
};
