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
import type {
  PlatformAuditEventRecord,
  PlatformAuditEventInput,
  PlatformAuditQuery,
  PlatformStore,
  PlatformUserUpdate,
  TenantEntitlementRecord,
  TenantMembershipUpdate,
  TenantMembershipWithTenant
} from "@nox-os/database";

type State = {
  users: Map<string, PlatformUserRecord>;
  tenants: Map<string, TenantRecord>;
  memberships: Map<string, TenantMembershipRecord>;
  entitlements: Map<string, TenantEntitlementRecord>;
  audits: PlatformAuditEventRecord[];
  nextTenant: number;
  nextAudit: number;
};

function membershipKey(tenantId: string, userId: string): string {
  return tenantId + ":" + userId;
}

function entitlementKey(tenantId: string, key: string): string {
  return tenantId + ":" + key;
}

function cloneState(state: State): State {
  return {
    users: new Map([...state.users].map(([id, value]) => [id, { ...value }])),
    tenants: new Map([...state.tenants].map(([id, value]) => [id, { ...value }])),
    memberships: new Map([...state.memberships].map(([id, value]) => [id, { ...value }])),
    entitlements: new Map([...state.entitlements].map(([id, value]) => [id, { ...value }])),
    audits: state.audits.map((audit) => ({
      ...audit,
      metadata: { ...audit.metadata }
    })),
    nextTenant: state.nextTenant,
    nextAudit: state.nextAudit
  };
}

export class InMemoryPlatformStore implements PlatformStore {
  private state: State = {
    users: new Map(),
    tenants: new Map(),
    memberships: new Map(),
    entitlements: new Map(),
    audits: [],
    nextTenant: 1,
    nextAudit: 1
  };
  private transactionTail: Promise<void> = Promise.resolve();
  private failAuditInsert = false;

  seedUser(input: {
    id: string;
    status?: PlatformUserStatus;
    platformRoleKey?: PlatformRoleKey | null;
    displayName?: string | null;
  }): void {
    const now = new Date();
    this.state.users.set(input.id, {
      id: input.id,
      displayName: input.displayName ?? null,
      status: input.status ?? "ACTIVE",
      platformRoleKey: input.platformRoleKey ?? null,
      createdAt: now,
      updatedAt: now
    });
  }

  seedTenant(input: { id: string; name: string; slug: string; status?: TenantStatus }): void {
    const now = new Date();
    this.state.tenants.set(input.id, {
      ...input,
      status: input.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now
    });
  }

  seedMembership(input: {
    tenantId: string;
    userId: string;
    roleKey: TenantRoleKey;
    status?: MembershipStatus;
  }): void {
    const now = new Date();
    this.state.memberships.set(membershipKey(input.tenantId, input.userId), {
      ...input,
      status: input.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now
    });
  }

  get auditEvents(): readonly PlatformAuditEventRecord[] {
    return this.state.audits;
  }

  setAuditInsertFailure(enabled: boolean): void {
    this.failAuditInsert = enabled;
  }

  async transaction<T>(operation: (store: PlatformStore) => Promise<T>): Promise<T> {
    let release!: () => void;
    const turn = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await turn;
    const snapshot = new InMemoryPlatformStore();
    snapshot.state = cloneState(this.state);
    snapshot.failAuditInsert = this.failAuditInsert;
    try {
      const value = await operation(snapshot);
      this.state = snapshot.state;
      return value;
    } finally {
      release();
    }
  }

  async findPlatformUser(userId: string) {
    return this.state.users.get(userId);
  }
  async listPlatformUsers() {
    return [...this.state.users.values()];
  }
  async insertPlatformUser(input: {
    id: string;
    displayName?: string | null;
    status?: PlatformUserStatus;
    platformRoleKey?: PlatformRoleKey | null;
  }) {
    const now = new Date();
    const user: PlatformUserRecord = {
      id: input.id,
      displayName: input.displayName ?? null,
      status: input.status ?? "ACTIVE",
      platformRoleKey: input.platformRoleKey ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.state.users.set(user.id, user);
    return user;
  }
  async updatePlatformUser(userId: string, update: PlatformUserUpdate) {
    const existing = this.state.users.get(userId);
    if (!existing) return undefined;
    const value = { ...existing, ...update, updatedAt: new Date() };
    this.state.users.set(userId, value);
    return value;
  }
  async lockActivePlatformOwners() {}
  async countActivePlatformOwners() {
    return [...this.state.users.values()].filter(
      (user) => user.status === "ACTIVE" && user.platformRoleKey === "PLATFORM_OWNER"
    ).length;
  }
  async listTenantOwnerTenantIdsForUser(userId: string) {
    return [...this.state.memberships.values()]
      .filter(
        (membership) =>
          membership.userId === userId &&
          membership.status === "ACTIVE" &&
          membership.roleKey === "TENANT_OWNER"
      )
      .map((membership) => membership.tenantId)
      .sort();
  }
  async lockTenants(_tenantIds: readonly string[]) {}
  async findTenant(tenantId: string) {
    return this.state.tenants.get(tenantId);
  }
  async findTenantBySlug(slug: string) {
    return [...this.state.tenants.values()].find((tenant) => tenant.slug === slug);
  }
  async listTenants() {
    return [...this.state.tenants.values()];
  }
  async insertTenant(input: { name: string; slug: string; status?: TenantStatus }) {
    const now = new Date();
    const id = `00000000-0000-4000-8000-${String(this.state.nextTenant++).padStart(12, "0")}`;
    const tenant: TenantRecord = {
      id,
      name: input.name,
      slug: input.slug,
      status: input.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now
    };
    this.state.tenants.set(id, tenant);
    return tenant;
  }
  async updateTenant(tenantId: string, update: { name?: string; status?: TenantStatus }) {
    const existing = this.state.tenants.get(tenantId);
    if (!existing) return undefined;
    const value = { ...existing, ...update, updatedAt: new Date() };
    this.state.tenants.set(tenantId, value);
    return value;
  }
  async listTenantMembershipsForUser(userId: string): Promise<TenantMembershipWithTenant[]> {
    return [...this.state.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .flatMap((membership) => {
        const tenant = this.state.tenants.get(membership.tenantId);
        return tenant ? [{ ...membership, tenant }] : [];
      });
  }
  async listTenantMemberships(tenantId: string) {
    return [...this.state.memberships.values()].filter(
      (membership) => membership.tenantId === tenantId
    );
  }
  async findTenantMembership(tenantId: string, userId: string) {
    return this.state.memberships.get(membershipKey(tenantId, userId));
  }
  async insertTenantMembership(input: {
    tenantId: string;
    userId: string;
    roleKey: TenantRoleKey;
    status?: MembershipStatus;
  }) {
    const now = new Date();
    const membership: TenantMembershipRecord = {
      tenantId: input.tenantId,
      userId: input.userId,
      roleKey: input.roleKey,
      status: input.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now
    };
    this.state.memberships.set(membershipKey(input.tenantId, input.userId), membership);
    return membership;
  }
  async updateTenantMembership(tenantId: string, userId: string, update: TenantMembershipUpdate) {
    const existing = this.state.memberships.get(membershipKey(tenantId, userId));
    if (!existing) return undefined;
    const value = { ...existing, ...update, updatedAt: new Date() };
    this.state.memberships.set(membershipKey(tenantId, userId), value);
    return value;
  }
  async lockTenant(tenantId: string) {
    return this.state.tenants.get(tenantId);
  }
  async countEffectiveActiveTenantOwners(tenantId: string) {
    return [...this.state.memberships.values()].filter((membership) => {
      const user = this.state.users.get(membership.userId);
      return (
        membership.tenantId === tenantId &&
        membership.status === "ACTIVE" &&
        membership.roleKey === "TENANT_OWNER" &&
        user?.status === "ACTIVE"
      );
    }).length;
  }
  async listTenantEntitlements(tenantId: string) {
    return [...this.state.entitlements.values()]
      .filter((entitlement) => entitlement.tenantId === tenantId)
      .sort((left, right) => left.key.localeCompare(right.key));
  }
  async findTenantEntitlement(tenantId: string, key: string) {
    return this.state.entitlements.get(entitlementKey(tenantId, key));
  }
  async upsertTenantEntitlement(input: { tenantId: string; key: string; enabled: boolean }) {
    const existing = await this.findTenantEntitlement(input.tenantId, input.key);
    const now = new Date();
    const value: TenantEntitlementRecord = existing
      ? { ...existing, enabled: input.enabled, updatedAt: now }
      : {
          tenantId: input.tenantId,
          key: input.key,
          enabled: input.enabled,
          createdAt: now,
          updatedAt: now
        };
    this.state.entitlements.set(entitlementKey(input.tenantId, input.key), value);
    return value;
  }
  async insertAuditEvent(input: PlatformAuditEventInput) {
    if (this.failAuditInsert) {
      throw new Error("Controlled audit insert failure");
    }
    this.state.audits.push({
      id: `audit-${this.state.nextAudit++}`,
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      requestId: input.requestId,
      correlationId: input.correlationId,
      metadata: input.metadata ?? {},
      createdAt: new Date()
    });
  }
  async listAuditEvents(query: PlatformAuditQuery) {
    return this.state.audits
      .filter((event) => !query.tenantId || event.tenantId === query.tenantId)
      .filter((event) => !query.action || event.action === query.action)
      .filter((event) => !query.actorUserId || event.actorUserId === query.actorUserId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(query.offset, query.offset + query.limit);
  }
}
