import { useEffect, useState, type FormEvent } from "react";
import type { TenantRoleKey } from "@nox-os/contracts";

export type ApiClient = <T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; tenantId?: string }
) => Promise<T>;

type PlatformUser = {
  id: string;
  displayName: string | null;
  status: "ACTIVE" | "DISABLED";
  platformRoleKey: "PLATFORM_OWNER" | null;
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt?: string;
};

type Membership = {
  tenantId: string;
  userId: string;
  roleKey: TenantRoleKey;
  status: "ACTIVE" | "DISABLED";
};

type Entitlement = { key: string; enabled: boolean };
type AuditEvent = {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
};

type RegisteredModule = { id: string; displayName: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The requested change could not be completed.";
}

function DangerousButton({
  children,
  confirmation,
  onConfirm
}: {
  children: string;
  confirmation: string;
  onConfirm: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  return (
    <button
      type="button"
      className="nox-danger-action"
      disabled={working}
      onClick={() => {
        if (!window.confirm(confirmation)) return;
        setWorking(true);
        void onConfirm().finally(() => setWorking(false));
      }}
    >
      {working ? "Working…" : children}
    </button>
  );
}

export function PlatformUsersScreen({ api }: { api: ApiClient }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string>();

  const refresh = () =>
    api<{ users: PlatformUser[] }>("/platform/users")
      .then((payload) => setUsers(payload.users))
      .catch((reason) => setError(message(reason)));

  useEffect(() => {
    void refresh();
  }, []);

  const provision = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/platform/users", {
        method: "POST",
        body: { userId, displayName: displayName.trim() || null }
      });
      setUserId("");
      setDisplayName("");
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const patch = async (target: PlatformUser, body: unknown) => {
    setError(undefined);
    try {
      await api(`/platform/users/${target.id}`, { method: "PATCH", body });
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <section className="nox-control-plane" aria-labelledby="platform-users-title">
      <p className="nox-ai-context">Platform / Users</p>
      <h1 id="platform-users-title">Platform users</h1>
      <form className="nox-inline-form" onSubmit={provision} aria-label="Provision PlatformUser">
        <label>
          Existing Auth user ID
          <input value={userId} onChange={(event) => setUserId(event.target.value)} required />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <button type="submit">Provision PlatformUser</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Display name</th>
              <th>User ID</th>
              <th>Status</th>
              <th>Platform role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName ?? "—"}</td>
                <td>
                  <code>{user.id}</code>
                </td>
                <td>{user.status}</td>
                <td>{user.platformRoleKey ?? "—"}</td>
                <td className="nox-table-actions">
                  {user.status === "ACTIVE" ? (
                    <DangerousButton
                      confirmation="Disable this PlatformUser? Tenant-owner safeguards will be checked by the server."
                      onConfirm={() => patch(user, { status: "DISABLED" })}
                    >
                      Disable
                    </DangerousButton>
                  ) : (
                    <button type="button" onClick={() => void patch(user, { status: "ACTIVE" })}>
                      Activate
                    </button>
                  )}
                  {user.platformRoleKey === "PLATFORM_OWNER" ? (
                    <DangerousButton
                      confirmation="Remove PLATFORM_OWNER? The server will preserve the last active owner."
                      onConfirm={() => patch(user, { platformRoleKey: null })}
                    >
                      Remove PLATFORM_OWNER
                    </DangerousButton>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void patch(user, { platformRoleKey: "PLATFORM_OWNER" })}
                    >
                      Grant PLATFORM_OWNER
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TenantDetail({
  api,
  tenant,
  users,
  modules,
  onRefresh
}: {
  api: ApiClient;
  tenant: Tenant;
  users: readonly PlatformUser[];
  modules: readonly RegisteredModule[];
  onRefresh: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<TenantRoleKey>("TENANT_MEMBER");
  const [error, setError] = useState<string>();

  const refreshDetail = () =>
    Promise.all([
      api<{ members: Membership[] }>(`/platform/tenants/${tenant.id}/members`),
      api<{ entitlements: Entitlement[] }>(`/platform/tenants/${tenant.id}/entitlements`)
    ])
      .then(([memberPayload, entitlementPayload]) => {
        setMembers(memberPayload.members);
        setEntitlements(entitlementPayload.entitlements);
      })
      .catch((reason) => setError(message(reason)));

  useEffect(() => {
    void refreshDetail();
  }, [tenant.id]);

  const patchMembership = async (member: Membership, body: unknown, confirmation?: string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setError(undefined);
    try {
      await api(`/platform/tenants/${tenant.id}/members/${member.userId}`, {
        method: "PATCH",
        body
      });
      await refreshDetail();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!newMemberId) return;
    setError(undefined);
    try {
      await api(`/platform/tenants/${tenant.id}/members`, {
        method: "POST",
        body: { userId: newMemberId, roleKey: newMemberRole }
      });
      setNewMemberId("");
      setNewMemberRole("TENANT_MEMBER");
      await refreshDetail();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const setEntitlement = async (key: string, enabled: boolean) => {
    setError(undefined);
    try {
      await api(`/platform/tenants/${tenant.id}/entitlements/${key}`, {
        method: "PUT",
        body: { enabled }
      });
      await refreshDetail();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const suspend = async () => {
    try {
      await api(`/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: { status: tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }
      });
      await onRefresh();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const entitlementState = new Map(
    entitlements.map((entitlement) => [entitlement.key, entitlement.enabled])
  );
  return (
    <section className="nox-tenant-detail" aria-labelledby="platform-tenant-detail-title">
      <div className="nox-section-heading">
        <div>
          <p className="nox-ai-context">Platform / Tenant detail</p>
          <h2 id="platform-tenant-detail-title">{tenant.name}</h2>
        </div>
        {tenant.status === "ACTIVE" ? (
          <DangerousButton
            confirmation="Suspend this tenant? Workspace access will be denied."
            onConfirm={suspend}
          >
            Suspend tenant
          </DangerousButton>
        ) : (
          <button type="button" onClick={() => void suspend()}>
            Activate tenant
          </button>
        )}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <section aria-labelledby="tenant-general-title">
        <h3 id="tenant-general-title">General</h3>
        <dl className="nox-definition-list">
          <div>
            <dt>Name</dt>
            <dd>{tenant.name}</dd>
          </div>
          <div>
            <dt>Slug</dt>
            <dd>
              <code>{tenant.slug}</code>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{tenant.status}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="tenant-members-title">
        <h3 id="tenant-members-title">Members</h3>
        <form className="nox-inline-form" onSubmit={addMember}>
          <label>
            Existing PlatformUser
            <select
              value={newMemberId}
              onChange={(event) => setNewMemberId(event.target.value)}
              required
            >
              <option value="">Select user</option>
              {users
                .filter((user) => user.status === "ACTIVE")
                .map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName ?? user.id}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Role
            <select
              value={newMemberRole}
              onChange={(event) => setNewMemberRole(event.target.value as TenantRoleKey)}
            >
              <option value="TENANT_MEMBER">TENANT_MEMBER</option>
              <option value="TENANT_ADMIN">TENANT_ADMIN</option>
              <option value="TENANT_OWNER">TENANT_OWNER</option>
            </select>
          </label>
          <button type="submit">Add existing user</button>
        </form>
        <div className="nox-table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <code>{member.userId}</code>
                  </td>
                  <td>{member.roleKey}</td>
                  <td>{member.status}</td>
                  <td className="nox-table-actions">
                    <select
                      aria-label={`Role for ${member.userId}`}
                      value={member.roleKey}
                      onChange={(event) => {
                        const next = event.target.value as TenantRoleKey;
                        const confirmation =
                          member.roleKey === "TENANT_OWNER" && next !== "TENANT_OWNER"
                            ? "Demote this Tenant Owner? The server will preserve an effective owner."
                            : undefined;
                        void patchMembership(member, { roleKey: next }, confirmation);
                      }}
                    >
                      <option value="TENANT_MEMBER">TENANT_MEMBER</option>
                      <option value="TENANT_ADMIN">TENANT_ADMIN</option>
                      <option value="TENANT_OWNER">TENANT_OWNER</option>
                    </select>
                    {member.status === "ACTIVE" ? (
                      <DangerousButton
                        confirmation={
                          member.roleKey === "TENANT_OWNER"
                            ? "Disable this Tenant Owner? The server will preserve an effective owner."
                            : "Disable this membership?"
                        }
                        onConfirm={() => patchMembership(member, { status: "DISABLED" })}
                      >
                        Disable
                      </DangerousButton>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void patchMembership(member, { status: "ACTIVE" })}
                      >
                        Re-enable
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="tenant-entitlements-title">
        <h3 id="tenant-entitlements-title">Entitlements</h3>
        <div className="nox-table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Entitlement</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => {
                const key = `module.${module.id}`;
                const enabled = entitlementState.get(key) ?? false;
                return (
                  <tr key={module.id}>
                    <td>{module.displayName}</td>
                    <td>
                      <code>{key}</code>
                    </td>
                    <td>
                      <label className="nox-toggle-label">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => void setEntitlement(key, event.target.checked)}
                        />
                        <span>{enabled ? "Enabled" : "Disabled"}</span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export function PlatformTenantsScreen({
  api,
  modules
}: {
  api: ApiClient;
  modules: readonly RegisteredModule[];
}) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [initialOwnerUserId, setInitialOwnerUserId] = useState("");
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const [tenantPayload, userPayload] = await Promise.all([
        api<{ tenants: Tenant[] }>("/platform/tenants"),
        api<{ users: PlatformUser[] }>("/platform/users")
      ]);
      setTenants(tenantPayload.tenants);
      setUsers(userPayload.users);
    } catch (reason) {
      setError(message(reason));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const createTenant = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      const result = await api<{ tenant: Tenant }>("/platform/tenants", {
        method: "POST",
        body: { name, slug, initialOwnerUserId }
      });
      setName("");
      setSlug("");
      setInitialOwnerUserId("");
      setSelectedTenantId(result.tenant.id);
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const selected = tenants.find((tenant) => tenant.id === selectedTenantId);
  return (
    <section className="nox-control-plane" aria-labelledby="platform-tenants-title">
      <p className="nox-ai-context">Platform / Tenants</p>
      <h1 id="platform-tenants-title">Platform tenants</h1>
      <form className="nox-inline-form" onSubmit={createTenant} aria-label="Create tenant">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Slug
          <input value={slug} onChange={(event) => setSlug(event.target.value)} required />
        </label>
        <label>
          Initial owner
          <select
            value={initialOwnerUserId}
            onChange={(event) => setInitialOwnerUserId(event.target.value)}
            required
          >
            <option value="">Select active PlatformUser</option>
            {users
              .filter((user) => user.status === "ACTIVE")
              .map((user) => (
                <option value={user.id} key={user.id}>
                  {user.displayName ?? user.id}
                </option>
              ))}
          </select>
        </label>
        <button type="submit">Create tenant</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td>{tenant.name}</td>
                <td>
                  <code>{tenant.slug}</code>
                </td>
                <td>{tenant.status}</td>
                <td>{tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}</td>
                <td>
                  <button type="button" onClick={() => setSelectedTenantId(tenant.id)}>
                    Open detail
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <TenantDetail
          api={api}
          tenant={selected}
          users={users}
          modules={modules}
          onRefresh={refresh}
        />
      ) : null}
    </section>
  );
}

export function PlatformAuditScreen({ api }: { api: ApiClient }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<{ events: AuditEvent[] }>("/platform/audit?limit=50&offset=0")
      .then((payload) => setEvents(payload.events))
      .catch((reason) => setError(message(reason)));
  }, []);
  return (
    <section className="nox-control-plane" aria-labelledby="platform-audit-title">
      <p className="nox-ai-context">Platform / Audit</p>
      <h1 id="platform-audit-title">Platform audit</h1>
      {error ? <p role="alert">{error}</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Tenant</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Request ID</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.createdAt).toLocaleString()}</td>
                <td>
                  <code>{event.actorUserId ?? "SYSTEM"}</code>
                </td>
                <td>
                  <code>{event.tenantId ?? "—"}</code>
                </td>
                <td>
                  <code>{event.action}</code>
                </td>
                <td>
                  {event.resourceType}
                  {event.resourceId ? ` / ${event.resourceId}` : ""}
                </td>
                <td>
                  <code>{event.requestId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TenantSettingsScreen({
  api,
  tenantId,
  tenantRole
}: {
  api: ApiClient;
  tenantId?: string;
  tenantRole?: TenantRoleKey;
}) {
  const [tenant, setTenant] = useState<Tenant>();
  const [members, setMembers] = useState<Membership[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();

  const refresh = () => {
    if (!tenantId) return Promise.resolve();
    return Promise.all([
      api<{ tenant: Tenant }>("/tenant", { tenantId }),
      api<{ members: Membership[] }>("/tenant/members", { tenantId }),
      api<{ entitlements: Entitlement[] }>("/tenant/entitlements", { tenantId })
    ])
      .then(([tenantPayload, memberPayload, entitlementPayload]) => {
        setTenant(tenantPayload.tenant);
        setName(tenantPayload.tenant.name);
        setMembers(memberPayload.members);
        setEntitlements(entitlementPayload.entitlements);
      })
      .catch((reason) => setError(message(reason)));
  };

  useEffect(() => {
    setTenant(undefined);
    setMembers([]);
    setEntitlements([]);
    setError(undefined);
    void refresh();
  }, [tenantId]);

  if (!tenantId) {
    return (
      <section aria-labelledby="tenant-settings-title">
        <p className="nox-ai-context">Settings / Tenant</p>
        <h1 id="tenant-settings-title">Tenant settings</h1>
        <p>Select a tenant to view its settings.</p>
      </section>
    );
  }

  const canManage = tenantRole === "TENANT_OWNER" || tenantRole === "TENANT_ADMIN";
  const canManageOwners = tenantRole === "TENANT_OWNER";
  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/tenant", { method: "PATCH", body: { name }, tenantId });
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  };
  const patchMembership = async (member: Membership, body: unknown, confirmation?: string) => {
    if (confirmation && !window.confirm(confirmation)) return;
    setError(undefined);
    try {
      await api(`/tenant/members/${member.userId}`, { method: "PATCH", body, tenantId });
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <section className="nox-control-plane" aria-labelledby="tenant-settings-title">
      <p className="nox-ai-context">Settings / Tenant</p>
      <h1 id="tenant-settings-title">Tenant settings</h1>
      {error ? <p role="alert">{error}</p> : null}
      <section aria-labelledby="tenant-settings-general-title">
        <h2 id="tenant-settings-general-title">General</h2>
        <form className="nox-inline-form" onSubmit={saveName}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canManage}
              required
            />
          </label>
          <label>
            Slug
            <input value={tenant?.slug ?? ""} readOnly />
          </label>
          <label>
            Status
            <input value={tenant?.status ?? ""} readOnly />
          </label>
          {canManage ? <button type="submit">Save name</button> : null}
        </form>
      </section>
      <section aria-labelledby="tenant-settings-members-title">
        <h2 id="tenant-settings-members-title">Members</h2>
        <div className="nox-table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const ownerProtected = member.roleKey === "TENANT_OWNER";
                const mutable = canManage && (!ownerProtected || canManageOwners);
                return (
                  <tr key={member.userId}>
                    <td>
                      <code>{member.userId}</code>
                    </td>
                    <td>{member.roleKey}</td>
                    <td>{member.status}</td>
                    <td className="nox-table-actions">
                      {mutable ? (
                        <>
                          <select
                            aria-label={`Role for ${member.userId}`}
                            value={member.roleKey}
                            onChange={(event) => {
                              const next = event.target.value as TenantRoleKey;
                              const confirmation =
                                member.roleKey === "TENANT_OWNER" && next !== "TENANT_OWNER"
                                  ? "Demote this Tenant Owner? The server will preserve an effective owner."
                                  : undefined;
                              void patchMembership(member, { roleKey: next }, confirmation);
                            }}
                          >
                            <option value="TENANT_MEMBER">TENANT_MEMBER</option>
                            <option value="TENANT_ADMIN">TENANT_ADMIN</option>
                            {canManageOwners ? (
                              <option value="TENANT_OWNER">TENANT_OWNER</option>
                            ) : null}
                          </select>
                          {member.status === "ACTIVE" ? (
                            <DangerousButton
                              confirmation={
                                ownerProtected
                                  ? "Disable this Tenant Owner? The server will preserve an effective owner."
                                  : "Disable this membership?"
                              }
                              onConfirm={() => patchMembership(member, { status: "DISABLED" })}
                            >
                              Disable
                            </DangerousButton>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void patchMembership(member, { status: "ACTIVE" })}
                            >
                              Re-enable
                            </button>
                          )}
                        </>
                      ) : (
                        <span>Read-only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="tenant-settings-entitlements-title">
        <h2 id="tenant-settings-entitlements-title">Entitlements</h2>
        <ul className="nox-read-only-list">
          {entitlements.map((entitlement) => (
            <li key={entitlement.key}>
              <code>{entitlement.key}</code>: {entitlement.enabled ? "Enabled" : "Disabled"}
            </li>
          ))}
          {entitlements.length === 0 ? <li>No module entitlement is enabled.</li> : null}
        </ul>
      </section>
    </section>
  );
}
