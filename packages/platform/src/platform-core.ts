import { z } from "zod";
import {
  membershipStatusSchema,
  platformRoleKeySchema,
  platformUserStatusSchema,
  tenantNameSchema,
  tenantRoleKeySchema,
  tenantSlugSchema,
  tenantStatusSchema,
  uuidSchema,
  type ApiRequest,
  type ApiResponse,
  type ApiRouteRegistrar,
  type AuthenticatedRequestContext,
  type ErrorCode,
  type ModuleDefinition,
  type PlatformPermission,
  type PlatformUserRecord,
  type TenantMembershipRecord,
  type TenantPermission,
  type TenantRequestContext
} from "@nox-os/contracts";
import { readBearerToken, type AccessTokenVerifier } from "@nox-os/auth";
import type {
  PlatformAuditEventInput,
  PlatformAuditQuery,
  PlatformStore,
  PlatformUserUpdate,
  TenantMembershipUpdate
} from "@nox-os/database";
import {
  LocalFeatureFlagResolver,
  moduleEntitlementKey,
  resolveDefinitionAvailability,
  resolveModulePermissions,
  type FeatureFlagResolver
} from "@nox-os/module-registry";
import {
  hasPermission,
  resolvePlatformPermissions,
  resolveTenantPermissions
} from "@nox-os/tenancy";

type CoreProblemCode = Exclude<
  ErrorCode,
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFIGURATION_ERROR"
  | "REQUEST_TIMEOUT"
  | "INTERNAL_ERROR"
>;

export class CoreProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: CoreProblemCode,
    message: string
  ) {
    super(message);
  }
}

const provisionUserSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().trim().min(1).max(120).nullable().optional()
});
const updatePlatformUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    status: platformUserStatusSchema.optional(),
    platformRoleKey: platformRoleKeySchema.nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one update is required.");
const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: tenantSlugSchema,
  initialOwnerUserId: uuidSchema
});
const updateTenantProfileSchema = z.object({ name: tenantNameSchema });
const updatePlatformTenantStatusSchema = z.object({ status: tenantStatusSchema });
const createMembershipSchema = z.object({ userId: uuidSchema, roleKey: tenantRoleKeySchema });
const updateMembershipSchema = z
  .object({ roleKey: tenantRoleKeySchema.optional(), status: membershipStatusSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one update is required.");
const entitlementUpdateSchema = z.object({ enabled: z.boolean() });
const auditQuerySchema = z.object({
  tenantId: uuidSchema.optional(),
  action: z.string().trim().min(1).max(160).optional(),
  actorUserId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

function parseBody<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    throw new CoreProblem(400, "VALIDATION_FAILED", "Request validation failed.");
  }
  return parsed.data;
}

function parseQuery<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const parsed = schema.safeParse(request.query ?? {});
  if (!parsed.success) {
    throw new CoreProblem(400, "VALIDATION_FAILED", "Request query is invalid.");
  }
  return parsed.data;
}

function routeParameter(request: ApiRequest, name: string): string {
  const value = request.params?.[name];
  if (!value || !uuidSchema.safeParse(value).success) {
    throw new CoreProblem(400, "VALIDATION_FAILED", "Request path parameter is invalid.");
  }
  return value;
}

function textRouteParameter(request: ApiRequest, name: string): string {
  const value = request.params?.[name];
  if (!value || value.includes("/") || value.length > 160) {
    throw new CoreProblem(400, "VALIDATION_FAILED", "Request path parameter is invalid.");
  }
  return value;
}

function envelope(code: ErrorCode, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

function userPayload(user: PlatformUserRecord) {
  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    platformRoleKey: user.platformRoleKey,
    // This is a projection of the server-side static RBAC resolution. It lets
    // the browser present Platform Control actions without treating the role
    // itself as a UI authorization shortcut.
    platformPermissions: resolvePlatformPermissions(user.platformRoleKey)
  };
}

function membershipPayload(membership: TenantMembershipRecord) {
  return {
    tenantId: membership.tenantId,
    userId: membership.userId,
    roleKey: membership.roleKey,
    status: membership.status
  };
}

function isEffectiveOwner(membership: TenantMembershipRecord, user: PlatformUserRecord): boolean {
  return (
    membership.status === "ACTIVE" &&
    membership.roleKey === "TENANT_OWNER" &&
    user.status === "ACTIVE"
  );
}

export type PlatformCoreOptions = {
  store: PlatformStore;
  accessTokenVerifier: AccessTokenVerifier;
  moduleDefinitions?: readonly ModuleDefinition[];
  featureFlags?: FeatureFlagResolver;
};

/** Supabase Auth proves identity. NØX resolves every current authorization decision. */
export class PlatformCoreService {
  private readonly modules: readonly ModuleDefinition[];
  private readonly featureFlags: FeatureFlagResolver;

  constructor(private readonly options: PlatformCoreOptions) {
    this.modules = options.moduleDefinitions ?? [];
    this.featureFlags = options.featureFlags ?? new LocalFeatureFlagResolver();
  }

  async authenticated(request: ApiRequest): Promise<AuthenticatedRequestContext> {
    const token = readBearerToken(request.headers);
    if (!token) {
      throw new CoreProblem(401, "AUTH_REQUIRED", "Authentication is required.");
    }
    const verification = await this.options.accessTokenVerifier.verifyAccessToken(token);
    if (verification.kind !== "AUTHENTICATED") {
      throw new CoreProblem(401, "AUTH_INVALID", "Authentication could not be verified.");
    }
    const user = await this.options.store.findPlatformUser(verification.identity.userId);
    if (!user) {
      throw new CoreProblem(
        403,
        "PLATFORM_USER_NOT_PROVISIONED",
        "The authenticated identity is not provisioned for NØX-OS."
      );
    }
    if (user.status !== "ACTIVE") {
      throw new CoreProblem(403, "PLATFORM_USER_DISABLED", "The PlatformUser is disabled.");
    }
    return {
      ...request.context,
      actor: {
        userId: user.id,
        platformRoleKey: user.platformRoleKey,
        platformPermissions: resolvePlatformPermissions(user.platformRoleKey)
      }
    };
  }

  async tenantContext(request: ApiRequest): Promise<TenantRequestContext> {
    const authenticated = await this.authenticated(request);
    const tenantId = request.headers["x-nox-tenant-id"];
    if (!tenantId) {
      throw new CoreProblem(400, "TENANT_CONTEXT_REQUIRED", "Tenant context is required.");
    }
    if (!uuidSchema.safeParse(tenantId).success) {
      throw new CoreProblem(400, "TENANT_CONTEXT_INVALID", "Tenant context is invalid.");
    }
    const tenant = await this.options.store.findTenant(tenantId);
    if (!tenant) {
      throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
    }
    if (tenant.status !== "ACTIVE") {
      throw new CoreProblem(403, "TENANT_SUSPENDED", "The tenant is suspended.");
    }
    const membership = await this.options.store.findTenantMembership(
      tenant.id,
      authenticated.actor.userId
    );
    if (!membership) {
      throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
    }
    if (membership.status !== "ACTIVE") {
      throw new CoreProblem(403, "MEMBERSHIP_DISABLED", "The tenant membership is disabled.");
    }
    const entitlements = (await this.options.store.listTenantEntitlements(tenant.id))
      .filter((entitlement) => entitlement.enabled)
      .map((entitlement) => entitlement.key);
    const modulePermissions = this.modules.flatMap((definition) =>
      resolveModulePermissions(definition.authorization, membership.roleKey)
    );
    return {
      ...authenticated,
      tenant: { tenantId: tenant.id, roleKey: membership.roleKey },
      authorization: {
        tenantPermissions: resolveTenantPermissions(membership.roleKey),
        modulePermissions
      },
      entitlements
    };
  }

  async bootstrapPlatformOwner(input: {
    userId: string;
    requestId: string;
    correlationId: string;
  }): Promise<PlatformUserRecord> {
    if (!uuidSchema.safeParse(input.userId).success) {
      throw new Error("Platform owner bootstrap requires an existing Supabase Auth UUID.");
    }
    return this.options.store.transaction(async (store) => {
      const existing = await store.findPlatformUser(input.userId);
      if (
        existing &&
        existing.status === "ACTIVE" &&
        existing.platformRoleKey === "PLATFORM_OWNER"
      ) {
        return existing;
      }
      const user = existing
        ? await store.updatePlatformUser(input.userId, {
            status: "ACTIVE",
            platformRoleKey: "PLATFORM_OWNER"
          })
        : await store.insertPlatformUser({
            id: input.userId,
            status: "ACTIVE",
            platformRoleKey: "PLATFORM_OWNER"
          });
      if (!user) {
        throw new Error("Platform owner bootstrap could not persist the PlatformUser.");
      }
      await store.insertAuditEvent({
        actorUserId: null,
        action: "platform.owner.bootstrap",
        resourceType: "platform_user",
        resourceId: user.id,
        requestId: input.requestId,
        correlationId: input.correlationId,
        metadata: { actor: "SYSTEM", trusted: true }
      });
      return user;
    });
  }

  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/me",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        const user = await this.requireUser(context.actor.userId);
        return { status: 200, body: { user: userPayload(user) } };
      })
    );

    registrar.get(
      "/me/tenants",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        const memberships = await this.options.store.listTenantMembershipsForUser(
          context.actor.userId
        );
        return {
          status: 200,
          body: {
            tenants: memberships
              .filter(
                (membership) =>
                  membership.status === "ACTIVE" && membership.tenant.status === "ACTIVE"
              )
              .map((membership) => ({
                ...membershipPayload(membership),
                tenant: {
                  id: membership.tenant.id,
                  name: membership.tenant.name,
                  slug: membership.tenant.slug,
                  status: membership.tenant.status
                }
              }))
          }
        };
      })
    );

    registrar.get(
      "/context",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        return {
          status: 200,
          body: {
            actor: context.actor,
            tenant: context.tenant,
            authorization: context.authorization,
            entitlements: context.entitlements,
            moduleAvailability: this.resolveModuleAvailability(context)
          }
        };
      })
    );

    registrar.get(
      "/tenant",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        this.requireTenant(context, "tenant.profile.read");
        const tenant = await this.options.store.findTenant(context.tenant.tenantId);
        return { status: 200, body: { tenant } };
      })
    );

    registrar.register(
      "PATCH",
      "/tenant",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        this.requireTenant(context, "tenant.profile.manage");
        const update = parseBody(updateTenantProfileSchema, request);
        const tenant = await this.options.store.transaction(async (store) => {
          const existing = await store.lockTenant(context.tenant.tenantId);
          if (!existing) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          if (existing.name === update.name) {
            return existing;
          }
          const updated = await store.updateTenant(existing.id, { name: update.name });
          if (!updated) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          await this.audit(store, context, {
            tenantId: updated.id,
            action: "tenant.profile.update",
            resourceType: "tenant",
            resourceId: updated.id
          });
          return updated;
        });
        return { status: 200, body: { tenant } };
      })
    );

    registrar.get(
      "/tenant/members",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        this.requireTenant(context, "tenant.membership.read");
        const members = await this.options.store.listTenantMemberships(context.tenant.tenantId);
        return { status: 200, body: { members: members.map(membershipPayload) } };
      })
    );

    registrar.register(
      "PATCH",
      "/tenant/members/:userId",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        const userId = routeParameter(request, "userId");
        const update = parseBody(updateMembershipSchema, request);
        await this.ensureTenantMemberMutationAllowed(context, userId, update);
        const membership = await this.updateMembershipWithSafety(
          context.tenant.tenantId,
          userId,
          update,
          context,
          "tenant"
        );
        return { status: 200, body: { membership: membershipPayload(membership) } };
      })
    );

    registrar.get(
      "/tenant/entitlements",
      this.handle(async (request) => {
        const context = await this.tenantContext(request);
        this.requireTenant(context, "tenant.entitlement.read");
        const entitlements = await this.options.store.listTenantEntitlements(
          context.tenant.tenantId
        );
        return {
          status: 200,
          body: {
            entitlements: entitlements.map((entitlement) => ({
              key: entitlement.key,
              enabled: entitlement.enabled
            }))
          }
        };
      })
    );

    registrar.get(
      "/platform/users",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.user.read");
        return {
          status: 200,
          body: { users: (await this.options.store.listPlatformUsers()).map(userPayload) }
        };
      })
    );

    registrar.register(
      "POST",
      "/platform/users",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.user.provision");
        const input = parseBody(provisionUserSchema, request);
        const user = await this.options.store.transaction(async (store) => {
          if (await store.findPlatformUser(input.userId)) {
            throw new CoreProblem(
              409,
              "PLATFORM_USER_ALREADY_PROVISIONED",
              "PlatformUser already exists."
            );
          }
          const created = await store.insertPlatformUser({
            id: input.userId,
            displayName: input.displayName,
            status: "ACTIVE"
          });
          await this.audit(store, context, {
            action: "platform.user.provision",
            resourceType: "platform_user",
            resourceId: created.id
          });
          return created;
        });
        return { status: 201, body: { user: userPayload(user) } };
      })
    );

    registrar.register(
      "PATCH",
      "/platform/users/:userId",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        const userId = routeParameter(request, "userId");
        const update = parseBody(updatePlatformUserSchema, request);
        if (update.status !== undefined) {
          this.requirePlatform(context, "platform.user.status.manage");
        }
        if (update.platformRoleKey !== undefined) {
          this.requirePlatform(context, "platform.owner.manage");
        }
        if (
          update.displayName !== undefined &&
          update.status === undefined &&
          update.platformRoleKey === undefined
        ) {
          this.requirePlatform(context, "platform.user.provision");
        }
        const user = await this.updatePlatformUserWithSafety(userId, update, context);
        return { status: 200, body: { user: userPayload(user) } };
      })
    );

    registrar.get(
      "/platform/tenants",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.tenant.read");
        return { status: 200, body: { tenants: await this.options.store.listTenants() } };
      })
    );

    registrar.get(
      "/platform/tenants/:tenantId",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.tenant.read");
        const tenant = await this.options.store.findTenant(routeParameter(request, "tenantId"));
        if (!tenant) {
          throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
        }
        return { status: 200, body: { tenant } };
      })
    );

    registrar.register(
      "POST",
      "/platform/tenants",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.tenant.create");
        const input = parseBody(createTenantSchema, request);
        const tenant = await this.options.store.transaction(async (store) => {
          if (await store.findTenantBySlug(input.slug)) {
            throw new CoreProblem(409, "TENANT_SLUG_CONFLICT", "Tenant slug already exists.");
          }
          const owner = await store.findPlatformUser(input.initialOwnerUserId);
          if (!owner || owner.status !== "ACTIVE") {
            throw new CoreProblem(
              404,
              "PLATFORM_USER_NOT_FOUND",
              "Initial tenant owner is not active."
            );
          }
          const created = await store.insertTenant({ name: input.name, slug: input.slug });
          await store.insertTenantMembership({
            tenantId: created.id,
            userId: owner.id,
            roleKey: "TENANT_OWNER",
            status: "ACTIVE"
          });
          await this.audit(store, context, {
            tenantId: created.id,
            action: "platform.tenant.create",
            resourceType: "tenant",
            resourceId: created.id,
            metadata: { initialOwnerUserId: owner.id }
          });
          return created;
        });
        return { status: 201, body: { tenant } };
      })
    );

    registrar.register(
      "PATCH",
      "/platform/tenants/:tenantId",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.tenant.status.manage");
        const tenantId = routeParameter(request, "tenantId");
        const update = parseBody(updatePlatformTenantStatusSchema, request);
        const tenant = await this.options.store.transaction(async (store) => {
          const existing = await store.lockTenant(tenantId);
          if (!existing) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          if (existing.status === update.status) {
            return existing;
          }
          const updated = await store.updateTenant(tenantId, { status: update.status });
          if (!updated) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          await this.audit(store, context, {
            tenantId,
            action: "platform.tenant.status.update",
            resourceType: "tenant",
            resourceId: tenantId
          });
          return updated;
        });
        return { status: 200, body: { tenant } };
      })
    );

    registrar.get(
      "/platform/tenants/:tenantId/members",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.membership.read");
        const members = await this.options.store.listTenantMemberships(
          routeParameter(request, "tenantId")
        );
        return { status: 200, body: { members: members.map(membershipPayload) } };
      })
    );

    registrar.register(
      "POST",
      "/platform/tenants/:tenantId/members",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        const tenantId = routeParameter(request, "tenantId");
        const input = parseBody(createMembershipSchema, request);
        this.requirePlatform(
          context,
          input.roleKey === "TENANT_OWNER"
            ? "platform.membership.owner.manage"
            : "platform.membership.manage"
        );
        const membership = await this.options.store.transaction(async (store) => {
          if (!(await store.lockTenant(tenantId))) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          if (await store.findTenantMembership(tenantId, input.userId)) {
            throw new CoreProblem(409, "MEMBERSHIP_ALREADY_EXISTS", "Membership already exists.");
          }
          const user = await store.findPlatformUser(input.userId);
          if (!user || user.status !== "ACTIVE") {
            throw new CoreProblem(404, "PLATFORM_USER_NOT_FOUND", "PlatformUser is not active.");
          }
          const created = await store.insertTenantMembership({
            tenantId,
            userId: input.userId,
            roleKey: input.roleKey,
            status: "ACTIVE"
          });
          await this.audit(store, context, {
            tenantId,
            action: "platform.membership.create",
            resourceType: "tenant_membership",
            resourceId: input.userId
          });
          return created;
        });
        return { status: 201, body: { membership: membershipPayload(membership) } };
      })
    );

    registrar.register(
      "PATCH",
      "/platform/tenants/:tenantId/members/:userId",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        const tenantId = routeParameter(request, "tenantId");
        const userId = routeParameter(request, "userId");
        const update = parseBody(updateMembershipSchema, request);
        const existing = await this.options.store.findTenantMembership(tenantId, userId);
        if (!existing) {
          throw new CoreProblem(404, "MEMBER_NOT_FOUND", "Membership was not found.");
        }
        this.requirePlatform(
          context,
          existing.roleKey === "TENANT_OWNER" || update.roleKey === "TENANT_OWNER"
            ? "platform.membership.owner.manage"
            : "platform.membership.manage"
        );
        const membership = await this.updateMembershipWithSafety(
          tenantId,
          userId,
          update,
          context,
          "platform"
        );
        return { status: 200, body: { membership: membershipPayload(membership) } };
      })
    );

    registrar.get(
      "/platform/tenants/:tenantId/entitlements",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.entitlement.read");
        const tenantId = routeParameter(request, "tenantId");
        if (!(await this.options.store.findTenant(tenantId))) {
          throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
        }
        const entitlements = await this.options.store.listTenantEntitlements(tenantId);
        return {
          status: 200,
          body: {
            entitlements: entitlements.map((entitlement) => ({
              key: entitlement.key,
              enabled: entitlement.enabled
            }))
          }
        };
      })
    );

    registrar.register(
      "PUT",
      "/platform/tenants/:tenantId/entitlements/:key",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.entitlement.manage");
        const tenantId = routeParameter(request, "tenantId");
        const key = textRouteParameter(request, "key");
        if (!this.isRegisteredEntitlement(key)) {
          throw new CoreProblem(
            400,
            "UNKNOWN_ENTITLEMENT_KEY",
            "Entitlement key is not registered."
          );
        }
        const input = parseBody(entitlementUpdateSchema, request);
        const result = await this.options.store.transaction(async (store) => {
          if (!(await store.lockTenant(tenantId))) {
            throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
          }
          const existing = await store.findTenantEntitlement(tenantId, key);
          if (existing && existing.enabled === input.enabled) {
            return { entitlement: existing, changed: false };
          }
          const entitlement = await store.upsertTenantEntitlement({
            tenantId,
            key,
            enabled: input.enabled
          });
          await this.audit(store, context, {
            tenantId,
            action: "platform.entitlement.update",
            resourceType: "tenant_entitlement",
            resourceId: key,
            metadata: { enabled: input.enabled }
          });
          return { entitlement, changed: true };
        });
        return {
          status: 200,
          body: {
            entitlement: { key: result.entitlement.key, enabled: result.entitlement.enabled },
            changed: result.changed
          }
        };
      })
    );

    registrar.get(
      "/platform/audit",
      this.handle(async (request) => {
        const context = await this.authenticated(request);
        this.requirePlatform(context, "platform.audit.read");
        const query = parseQuery(auditQuerySchema, request) as PlatformAuditQuery;
        const events = await this.options.store.listAuditEvents(query);
        return {
          status: 200,
          body: {
            events: events.map((event) => ({
              id: event.id,
              tenantId: event.tenantId,
              actorUserId: event.actorUserId,
              action: event.action,
              resourceType: event.resourceType,
              resourceId: event.resourceId,
              requestId: event.requestId,
              correlationId: event.correlationId,
              createdAt: event.createdAt
            })),
            limit: query.limit,
            offset: query.offset
          }
        };
      })
    );
  }

  private resolveModuleAvailability(context: TenantRequestContext) {
    const featureFlags = new Set(
      this.modules
        .map((definition) => definition.descriptor.featureFlag)
        .filter((flag): flag is string => this.featureFlags.isEnabled(flag))
    );
    const inputs = {
      featureFlags,
      entitlements: new Set(context.entitlements),
      permissions: new Set(context.authorization.modulePermissions)
    };
    return this.modules.map((definition) => resolveDefinitionAvailability(definition, inputs));
  }

  private isRegisteredEntitlement(key: string): boolean {
    return this.modules.some(
      (definition) => moduleEntitlementKey(definition.descriptor.id) === key
    );
  }

  private handle(handler: (request: ApiRequest) => Promise<ApiResponse>) {
    return async (request: ApiRequest): Promise<ApiResponse> => {
      try {
        return await handler(request);
      } catch (error) {
        if (error instanceof CoreProblem) {
          return {
            status: error.status,
            body: envelope(error.code, error.message, request.context.requestId)
          };
        }
        throw error;
      }
    };
  }

  private requirePlatform(
    context: AuthenticatedRequestContext,
    permission: PlatformPermission
  ): void {
    if (!hasPermission(context.actor.platformPermissions, permission)) {
      throw new CoreProblem(403, "PLATFORM_ACCESS_DENIED", "Platform access is not granted.");
    }
  }

  private requireTenant(context: TenantRequestContext, permission: TenantPermission): void {
    if (!hasPermission(context.authorization.tenantPermissions, permission)) {
      throw new CoreProblem(403, "PERMISSION_DENIED", "Permission is not granted.");
    }
  }

  private async requireUser(userId: string): Promise<PlatformUserRecord> {
    const user = await this.options.store.findPlatformUser(userId);
    if (!user) {
      throw new CoreProblem(403, "PLATFORM_USER_NOT_PROVISIONED", "PlatformUser was not found.");
    }
    return user;
  }

  private async ensureTenantMemberMutationAllowed(
    context: TenantRequestContext,
    userId: string,
    update: TenantMembershipUpdate
  ): Promise<void> {
    const existing = await this.options.store.findTenantMembership(context.tenant.tenantId, userId);
    if (!existing) {
      throw new CoreProblem(404, "MEMBER_NOT_FOUND", "Membership was not found.");
    }
    if (context.tenant.roleKey === "TENANT_OWNER") {
      this.requireTenant(context, "tenant.membership.manage");
      return;
    }
    if (context.tenant.roleKey === "TENANT_ADMIN") {
      this.requireTenant(context, "tenant.membership.manage");
      if (existing.roleKey === "TENANT_OWNER" || update.roleKey === "TENANT_OWNER") {
        throw new CoreProblem(
          403,
          "PERMISSION_DENIED",
          "Tenant administrators cannot manage owners."
        );
      }
      return;
    }
    throw new CoreProblem(403, "PERMISSION_DENIED", "Permission is not granted.");
  }

  private async updatePlatformUserWithSafety(
    userId: string,
    update: PlatformUserUpdate,
    context: AuthenticatedRequestContext
  ): Promise<PlatformUserRecord> {
    return this.options.store.transaction(async (store) => {
      await store.lockActivePlatformOwners();
      const existing = await store.findPlatformUser(userId);
      if (!existing) {
        throw new CoreProblem(404, "PLATFORM_USER_NOT_FOUND", "PlatformUser was not found.");
      }
      const statusChanged = update.status !== undefined && update.status !== existing.status;
      const roleChanged =
        update.platformRoleKey !== undefined && update.platformRoleKey !== existing.platformRoleKey;
      const displayNameChanged =
        update.displayName !== undefined && update.displayName !== existing.displayName;
      if (!statusChanged && !roleChanged && !displayNameChanged) {
        return existing;
      }
      const nextStatus = update.status ?? existing.status;
      const nextRole =
        update.platformRoleKey === undefined ? existing.platformRoleKey : update.platformRoleKey;
      const removesLastCandidate =
        existing.status === "ACTIVE" &&
        existing.platformRoleKey === "PLATFORM_OWNER" &&
        (nextStatus === "DISABLED" || nextRole === null);
      if (removesLastCandidate && (await store.countActivePlatformOwners()) <= 1) {
        throw new CoreProblem(
          409,
          "LAST_ACTIVE_PLATFORM_OWNER_REQUIRED",
          "At least one active PlatformOwner is required."
        );
      }
      if (nextStatus === "DISABLED" && existing.status === "ACTIVE") {
        const affectedTenantIds = await store.listTenantOwnerTenantIdsForUser(userId);
        await store.lockTenants(affectedTenantIds);
        for (const tenantId of affectedTenantIds) {
          if ((await store.countEffectiveActiveTenantOwners(tenantId)) <= 1) {
            throw new CoreProblem(
              409,
              "TENANT_OWNER_DEPENDENCY_EXISTS",
              "Disabling this PlatformUser would orphan an active tenant."
            );
          }
        }
      }
      const updated = await store.updatePlatformUser(userId, update);
      if (!updated) {
        throw new CoreProblem(404, "PLATFORM_USER_NOT_FOUND", "PlatformUser was not found.");
      }
      if (statusChanged) {
        await this.audit(store, context, {
          action: "platform.user.status.update",
          resourceType: "platform_user",
          resourceId: updated.id
        });
      }
      if (displayNameChanged) {
        await this.audit(store, context, {
          action: "platform.user.profile.update",
          resourceType: "platform_user",
          resourceId: updated.id
        });
      }
      if (roleChanged) {
        await this.audit(store, context, {
          action: "platform.user.role.update",
          resourceType: "platform_user",
          resourceId: updated.id
        });
      }
      return updated;
    });
  }

  private async updateMembershipWithSafety(
    tenantId: string,
    userId: string,
    update: TenantMembershipUpdate,
    context: AuthenticatedRequestContext | TenantRequestContext,
    auditScope: "platform" | "tenant"
  ): Promise<TenantMembershipRecord> {
    return this.options.store.transaction(async (store) => {
      if (!(await store.lockTenant(tenantId))) {
        throw new CoreProblem(403, "TENANT_ACCESS_DENIED", "Tenant access is not granted.");
      }
      const membership = await store.findTenantMembership(tenantId, userId);
      if (!membership) {
        throw new CoreProblem(404, "MEMBER_NOT_FOUND", "Membership was not found.");
      }
      const user = await store.findPlatformUser(userId);
      if (!user) {
        throw new CoreProblem(404, "PLATFORM_USER_NOT_FOUND", "PlatformUser was not found.");
      }
      const roleChanged = update.roleKey !== undefined && update.roleKey !== membership.roleKey;
      const statusChanged = update.status !== undefined && update.status !== membership.status;
      if (!roleChanged && !statusChanged) {
        return membership;
      }
      const next = {
        ...membership,
        roleKey: update.roleKey ?? membership.roleKey,
        status: update.status ?? membership.status
      };
      if (
        isEffectiveOwner(membership, user) &&
        !isEffectiveOwner(next, user) &&
        (await store.countEffectiveActiveTenantOwners(tenantId)) <= 1
      ) {
        throw new CoreProblem(
          409,
          "LAST_ACTIVE_TENANT_OWNER_REQUIRED",
          "At least one effective active TenantOwner is required."
        );
      }
      const updated = await store.updateTenantMembership(tenantId, userId, update);
      if (!updated) {
        throw new CoreProblem(404, "MEMBER_NOT_FOUND", "Membership was not found.");
      }
      if (roleChanged) {
        await this.audit(store, context, {
          tenantId,
          action: auditScope + ".membership.role.update",
          resourceType: "tenant_membership",
          resourceId: userId
        });
      }
      if (statusChanged) {
        await this.audit(store, context, {
          tenantId,
          action: auditScope + ".membership.status.update",
          resourceType: "tenant_membership",
          resourceId: userId
        });
      }
      return updated;
    });
  }

  private async audit(
    store: PlatformStore,
    context: AuthenticatedRequestContext | TenantRequestContext,
    event: Omit<PlatformAuditEventInput, "actorUserId" | "requestId" | "correlationId">
  ): Promise<void> {
    await store.insertAuditEvent({
      ...event,
      actorUserId: context.actor.userId,
      requestId: context.requestId,
      correlationId: context.correlationId
    });
  }
}

export function createPlatformCoreApi(options: PlatformCoreOptions): PlatformCoreService {
  return new PlatformCoreService(options);
}
