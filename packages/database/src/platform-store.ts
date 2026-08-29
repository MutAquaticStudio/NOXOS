import type { Sql, TransactionSql } from "postgres";
import type {
  MembershipStatus,
  PlatformRoleKey,
  PlatformUserRecord,
  PlatformUserStatus,
  TenantMembershipRecord,
  TenantRecord,
  TenantRoleKey,
  TenantStatus
} from "@nox-os/contracts";

type SqlExecutor = Sql | TransactionSql;

export type TenantMembershipWithTenant = TenantMembershipRecord & {
  tenant: TenantRecord;
};

export type PlatformJsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: PlatformJsonValue }
  | readonly PlatformJsonValue[];

export type PlatformAuditEventInput = {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId: string;
  correlationId: string;
  metadata?: Record<string, PlatformJsonValue>;
};

export type TenantEntitlementRecord = {
  tenantId: string;
  key: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformAuditEventRecord = PlatformAuditEventInput & {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  resourceId: string | null;
  metadata: Record<string, PlatformJsonValue>;
  createdAt: Date;
};

export type PlatformAuditQuery = {
  tenantId?: string;
  action?: string;
  actorUserId?: string;
  limit: number;
  offset: number;
};

export type PlatformUserUpdate = {
  displayName?: string | null;
  status?: PlatformUserStatus;
  platformRoleKey?: PlatformRoleKey | null;
};

export type TenantUpdate = {
  name?: string;
  status?: TenantStatus;
};

export type TenantMembershipUpdate = {
  roleKey?: TenantRoleKey;
  status?: MembershipStatus;
};

/**
 * Every operation that can alter an ownership invariant is invoked through
 * transaction(). Callers acquire the owner locks before counting or changing
 * a role, so a concurrent request cannot observe an unprotected owner set.
 */
export interface PlatformStore {
  transaction<T>(operation: (store: PlatformStore) => Promise<T>): Promise<T>;
  findPlatformUser(userId: string): Promise<PlatformUserRecord | undefined>;
  listPlatformUsers(): Promise<PlatformUserRecord[]>;
  insertPlatformUser(input: {
    id: string;
    displayName?: string | null;
    status?: PlatformUserStatus;
    platformRoleKey?: PlatformRoleKey | null;
  }): Promise<PlatformUserRecord>;
  updatePlatformUser(
    userId: string,
    update: PlatformUserUpdate
  ): Promise<PlatformUserRecord | undefined>;
  lockActivePlatformOwners(): Promise<void>;
  countActivePlatformOwners(): Promise<number>;
  listTenantOwnerTenantIdsForUser(userId: string): Promise<string[]>;
  lockTenants(tenantIds: readonly string[]): Promise<void>;
  findTenant(tenantId: string): Promise<TenantRecord | undefined>;
  findTenantBySlug(slug: string): Promise<TenantRecord | undefined>;
  listTenants(): Promise<TenantRecord[]>;
  insertTenant(input: { name: string; slug: string; status?: TenantStatus }): Promise<TenantRecord>;
  updateTenant(tenantId: string, update: TenantUpdate): Promise<TenantRecord | undefined>;
  listTenantMembershipsForUser(userId: string): Promise<TenantMembershipWithTenant[]>;
  listTenantMemberships(tenantId: string): Promise<TenantMembershipRecord[]>;
  findTenantMembership(
    tenantId: string,
    userId: string
  ): Promise<TenantMembershipRecord | undefined>;
  insertTenantMembership(input: {
    tenantId: string;
    userId: string;
    roleKey: TenantRoleKey;
    status?: MembershipStatus;
  }): Promise<TenantMembershipRecord>;
  updateTenantMembership(
    tenantId: string,
    userId: string,
    update: TenantMembershipUpdate
  ): Promise<TenantMembershipRecord | undefined>;
  lockTenant(tenantId: string): Promise<TenantRecord | undefined>;
  countEffectiveActiveTenantOwners(tenantId: string): Promise<number>;
  listTenantEntitlements(tenantId: string): Promise<TenantEntitlementRecord[]>;
  findTenantEntitlement(
    tenantId: string,
    key: string
  ): Promise<TenantEntitlementRecord | undefined>;
  upsertTenantEntitlement(input: {
    tenantId: string;
    key: string;
    enabled: boolean;
  }): Promise<TenantEntitlementRecord>;
  insertAuditEvent(input: PlatformAuditEventInput): Promise<void>;
  listAuditEvents(query: PlatformAuditQuery): Promise<PlatformAuditEventRecord[]>;
}

type PlatformUserRow = {
  id: string;
  display_name: string | null;
  status: PlatformUserStatus;
  platform_role_key: PlatformRoleKey | null;
  created_at: Date;
  updated_at: Date;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
};

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  role_key: TenantRoleKey;
  status: MembershipStatus;
  created_at: Date;
  updated_at: Date;
};

type MembershipWithTenantRow = MembershipRow & {
  tenant_name: string;
  tenant_slug: string;
  tenant_status: TenantStatus;
  tenant_created_at: Date;
  tenant_updated_at: Date;
};

type TenantEntitlementRow = {
  tenant_id: string;
  key: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

type AuditEventRow = {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  request_id: string;
  correlation_id: string;
  metadata: Record<string, PlatformJsonValue>;
  created_at: Date;
};

function toPlatformUser(row: PlatformUserRow): PlatformUserRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    platformRoleKey: row.platform_role_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTenant(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMembership(row: MembershipRow): TenantMembershipRecord {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    roleKey: row.role_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTenantEntitlement(row: TenantEntitlementRow): TenantEntitlementRecord {
  return {
    tenantId: row.tenant_id,
    key: row.key,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAuditEvent(row: AuditEventRow): PlatformAuditEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}

class PostgresPlatformStore implements PlatformStore {
  constructor(private readonly sql: SqlExecutor) {}

  async transaction<T>(operation: (store: PlatformStore) => Promise<T>): Promise<T> {
    if ("begin" in this.sql) {
      return (await this.sql.begin(async (transaction) =>
        operation(new PostgresPlatformStore(transaction))
      )) as T;
    }
    return operation(this);
  }

  async findPlatformUser(userId: string): Promise<PlatformUserRecord | undefined> {
    const rows = await this.sql<PlatformUserRow[]>`
      select id, display_name, status, platform_role_key, created_at, updated_at
      from platform.platform_users
      where id = ${userId}
    `;
    return rows[0] ? toPlatformUser(rows[0]) : undefined;
  }

  async listPlatformUsers(): Promise<PlatformUserRecord[]> {
    const rows = await this.sql<PlatformUserRow[]>`
      select id, display_name, status, platform_role_key, created_at, updated_at
      from platform.platform_users
      order by created_at, id
    `;
    return rows.map(toPlatformUser);
  }

  async insertPlatformUser(input: {
    id: string;
    displayName?: string | null;
    status?: PlatformUserStatus;
    platformRoleKey?: PlatformRoleKey | null;
  }): Promise<PlatformUserRecord> {
    const rows = await this.sql<PlatformUserRow[]>`
      insert into platform.platform_users (id, display_name, status, platform_role_key)
      values (
        ${input.id},
        ${input.displayName ?? null},
        ${input.status ?? "ACTIVE"},
        ${input.platformRoleKey ?? null}
      )
      returning id, display_name, status, platform_role_key, created_at, updated_at
    `;
    return toPlatformUser(rows[0]);
  }

  async updatePlatformUser(
    userId: string,
    update: PlatformUserUpdate
  ): Promise<PlatformUserRecord | undefined> {
    const rows = await this.sql<PlatformUserRow[]>`
      update platform.platform_users
      set
        display_name = case when ${update.displayName === undefined} then display_name else ${update.displayName ?? null} end,
        status = case when ${update.status === undefined} then status else ${update.status ?? null} end,
        platform_role_key = case
          when ${update.platformRoleKey === undefined} then platform_role_key
          else ${update.platformRoleKey ?? null}
        end,
        updated_at = now()
      where id = ${userId}
      returning id, display_name, status, platform_role_key, created_at, updated_at
    `;
    return rows[0] ? toPlatformUser(rows[0]) : undefined;
  }

  async lockActivePlatformOwners(): Promise<void> {
    await this.sql`
      select id
      from platform.platform_users
      where status = 'ACTIVE' and platform_role_key = 'PLATFORM_OWNER'
      order by id
      for update
    `;
  }

  async countActivePlatformOwners(): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`
      select count(*)::int as count
      from platform.platform_users
      where status = 'ACTIVE' and platform_role_key = 'PLATFORM_OWNER'
    `;
    return rows[0]?.count ?? 0;
  }

  async listTenantOwnerTenantIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`
      select tenant.id
      from platform.tenants as tenant
      join platform.tenant_memberships as membership
        on membership.tenant_id = tenant.id
      where membership.user_id = ${userId}
        and membership.status = 'ACTIVE'
        and membership.role_key = 'TENANT_OWNER'
      order by tenant.id
      for update of tenant
    `;
    return rows.map((row) => row.id);
  }

  async lockTenants(tenantIds: readonly string[]): Promise<void> {
    if (tenantIds.length === 0) {
      return;
    }
    await this.sql`
      select id
      from platform.tenants
      where id = any(${this.sql.array([...tenantIds])})
      order by id
      for update
    `;
  }

  async findTenant(tenantId: string): Promise<TenantRecord | undefined> {
    const rows = await this.sql<TenantRow[]>`
      select id, name, slug, status, created_at, updated_at
      from platform.tenants
      where id = ${tenantId}
    `;
    return rows[0] ? toTenant(rows[0]) : undefined;
  }

  async findTenantBySlug(slug: string): Promise<TenantRecord | undefined> {
    const rows = await this.sql<TenantRow[]>`
      select id, name, slug, status, created_at, updated_at
      from platform.tenants
      where slug = ${slug}
    `;
    return rows[0] ? toTenant(rows[0]) : undefined;
  }

  async listTenants(): Promise<TenantRecord[]> {
    const rows = await this.sql<TenantRow[]>`
      select id, name, slug, status, created_at, updated_at
      from platform.tenants
      order by created_at, id
    `;
    return rows.map(toTenant);
  }

  async insertTenant(input: {
    name: string;
    slug: string;
    status?: TenantStatus;
  }): Promise<TenantRecord> {
    const rows = await this.sql<TenantRow[]>`
      insert into platform.tenants (name, slug, status)
      values (${input.name}, ${input.slug}, ${input.status ?? "ACTIVE"})
      returning id, name, slug, status, created_at, updated_at
    `;
    return toTenant(rows[0]);
  }

  async updateTenant(tenantId: string, update: TenantUpdate): Promise<TenantRecord | undefined> {
    const rows = await this.sql<TenantRow[]>`
      update platform.tenants
      set
        name = case when ${update.name === undefined} then name else ${update.name ?? null} end,
        status = case when ${update.status === undefined} then status else ${update.status ?? null} end,
        updated_at = now()
      where id = ${tenantId}
      returning id, name, slug, status, created_at, updated_at
    `;
    return rows[0] ? toTenant(rows[0]) : undefined;
  }

  async listTenantMembershipsForUser(userId: string): Promise<TenantMembershipWithTenant[]> {
    const rows = await this.sql<MembershipWithTenantRow[]>`
      select
        membership.tenant_id,
        membership.user_id,
        membership.role_key,
        membership.status,
        membership.created_at,
        membership.updated_at,
        tenant.name as tenant_name,
        tenant.slug as tenant_slug,
        tenant.status as tenant_status,
        tenant.created_at as tenant_created_at,
        tenant.updated_at as tenant_updated_at
      from platform.tenant_memberships as membership
      join platform.tenants as tenant on tenant.id = membership.tenant_id
      where membership.user_id = ${userId}
      order by tenant.name, tenant.id
    `;
    return rows.map((row) => ({
      ...toMembership(row),
      tenant: {
        id: row.tenant_id,
        name: row.tenant_name,
        slug: row.tenant_slug,
        status: row.tenant_status,
        createdAt: row.tenant_created_at,
        updatedAt: row.tenant_updated_at
      }
    }));
  }

  async listTenantMemberships(tenantId: string): Promise<TenantMembershipRecord[]> {
    const rows = await this.sql<MembershipRow[]>`
      select tenant_id, user_id, role_key, status, created_at, updated_at
      from platform.tenant_memberships
      where tenant_id = ${tenantId}
      order by created_at, user_id
    `;
    return rows.map(toMembership);
  }

  async findTenantMembership(
    tenantId: string,
    userId: string
  ): Promise<TenantMembershipRecord | undefined> {
    const rows = await this.sql<MembershipRow[]>`
      select tenant_id, user_id, role_key, status, created_at, updated_at
      from platform.tenant_memberships
      where tenant_id = ${tenantId} and user_id = ${userId}
    `;
    return rows[0] ? toMembership(rows[0]) : undefined;
  }

  async insertTenantMembership(input: {
    tenantId: string;
    userId: string;
    roleKey: TenantRoleKey;
    status?: MembershipStatus;
  }): Promise<TenantMembershipRecord> {
    const rows = await this.sql<MembershipRow[]>`
      insert into platform.tenant_memberships (tenant_id, user_id, role_key, status)
      values (${input.tenantId}, ${input.userId}, ${input.roleKey}, ${input.status ?? "ACTIVE"})
      returning tenant_id, user_id, role_key, status, created_at, updated_at
    `;
    return toMembership(rows[0]);
  }

  async updateTenantMembership(
    tenantId: string,
    userId: string,
    update: TenantMembershipUpdate
  ): Promise<TenantMembershipRecord | undefined> {
    const rows = await this.sql<MembershipRow[]>`
      update platform.tenant_memberships
      set
        role_key = case when ${update.roleKey === undefined} then role_key else ${update.roleKey ?? null} end,
        status = case when ${update.status === undefined} then status else ${update.status ?? null} end,
        updated_at = now()
      where tenant_id = ${tenantId} and user_id = ${userId}
      returning tenant_id, user_id, role_key, status, created_at, updated_at
    `;
    return rows[0] ? toMembership(rows[0]) : undefined;
  }

  async lockTenant(tenantId: string): Promise<TenantRecord | undefined> {
    const rows = await this.sql<TenantRow[]>`
      select id, name, slug, status, created_at, updated_at
      from platform.tenants
      where id = ${tenantId}
      for update
    `;
    return rows[0] ? toTenant(rows[0]) : undefined;
  }

  async countEffectiveActiveTenantOwners(tenantId: string): Promise<number> {
    const rows = await this.sql<{ count: number }[]>`
      select count(*)::int as count
      from platform.tenant_memberships as membership
      join platform.platform_users as user_record on user_record.id = membership.user_id
      where membership.tenant_id = ${tenantId}
        and membership.status = 'ACTIVE'
        and membership.role_key = 'TENANT_OWNER'
        and user_record.status = 'ACTIVE'
    `;
    return rows[0]?.count ?? 0;
  }

  async listTenantEntitlements(tenantId: string): Promise<TenantEntitlementRecord[]> {
    const rows = await this.sql<TenantEntitlementRow[]>`
      select tenant_id, key, enabled, created_at, updated_at
      from platform.tenant_entitlements
      where tenant_id = ${tenantId}
      order by key
    `;
    return rows.map(toTenantEntitlement);
  }

  async findTenantEntitlement(
    tenantId: string,
    key: string
  ): Promise<TenantEntitlementRecord | undefined> {
    const rows = await this.sql<TenantEntitlementRow[]>`
      select tenant_id, key, enabled, created_at, updated_at
      from platform.tenant_entitlements
      where tenant_id = ${tenantId} and key = ${key}
    `;
    return rows[0] ? toTenantEntitlement(rows[0]) : undefined;
  }

  async upsertTenantEntitlement(input: {
    tenantId: string;
    key: string;
    enabled: boolean;
  }): Promise<TenantEntitlementRecord> {
    const rows = await this.sql<TenantEntitlementRow[]>`
      insert into platform.tenant_entitlements (tenant_id, key, enabled)
      values (${input.tenantId}, ${input.key}, ${input.enabled})
      on conflict (tenant_id, key) do update
      set enabled = excluded.enabled, updated_at = now()
      returning tenant_id, key, enabled, created_at, updated_at
    `;
    return toTenantEntitlement(rows[0]);
  }

  async insertAuditEvent(input: PlatformAuditEventInput): Promise<void> {
    await this.sql`
      insert into platform.audit_events (
        tenant_id, actor_user_id, action, resource_type, resource_id,
        request_id, correlation_id, metadata
      ) values (
        ${input.tenantId ?? null},
        ${input.actorUserId ?? null},
        ${input.action},
        ${input.resourceType},
        ${input.resourceId ?? null},
        ${input.requestId},
        ${input.correlationId},
        ${this.sql.json(input.metadata ?? {})}
      )
    `;
  }

  async listAuditEvents(query: PlatformAuditQuery): Promise<PlatformAuditEventRecord[]> {
    const rows = await this.sql<AuditEventRow[]>`
      select
        id, tenant_id, actor_user_id, action, resource_type, resource_id,
        request_id, correlation_id, metadata, created_at
      from platform.audit_events
      where (${query.tenantId ?? null}::uuid is null or tenant_id = ${query.tenantId ?? null})
        and (${query.action ?? null}::text is null or action = ${query.action ?? null})
        and (${query.actorUserId ?? null}::uuid is null or actor_user_id = ${query.actorUserId ?? null})
      order by created_at desc, id desc
      limit ${query.limit}
      offset ${query.offset}
    `;
    return rows.map(toAuditEvent);
  }
}

export function createPostgresPlatformStore(sql: Sql): PlatformStore {
  return new PostgresPlatformStore(sql);
}
