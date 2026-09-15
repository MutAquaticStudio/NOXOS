import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TenantRoleKey } from "@nox-os/contracts";
import {
  NoxDialog,
  useUnsavedChanges,
  NoxReadFeedback as ReadFeedback,
  type NoxReadState as ReadState
} from "@nox-os/ui";

import type { ApiClient } from "./api-client";
export type { ApiClient } from "./api-client";

type PlatformUser = {
  revision: string;
  id: string;
  displayName: string | null;
  status: "ACTIVE" | "DISABLED";
  platformRoleKey: "PLATFORM_OWNER" | null;
};

type Tenant = {
  revision: string;
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt?: string;
};

type Membership = {
  revision: string;
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

function PlatformConfirmation({
  title,
  target,
  state,
  revision,
  permission,
  confirmation,
  onConfirm,
  onClose
}: {
  title: string;
  target: string;
  state: string;
  revision?: string;
  permission: string;
  confirmation: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [opened] = useState(() => JSON.stringify([target, state, permission, revision]));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const sending = useRef(false);
  const stale = opened !== JSON.stringify([target, state, permission, revision]);
  const close = () => {
    if (!sending.current) onClose();
  };
  return (
    <NoxDialog title={title} onClose={close}>
      <dl className="nox-definition-list">
        <div>
          <dt>Target</dt>
          <dd>{target}</dd>
        </div>
        <div>
          <dt>Current state</dt>
          <dd>{state}</dd>
        </div>
        <div>
          <dt>Required permission</dt>
          <dd>{permission}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{revision ?? "Unavailable — reload current data"}</dd>
        </div>
      </dl>
      <p>{confirmation}</p>
      <p>The server remains authoritative for permissions, owner safeguards and audit.</p>
      {stale ? (
        <p role="alert">The displayed target changed. Close and review its current state.</p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <p>
            Close and reload current data before another attempt. Do not assume a failed response
            means nothing changed.
          </p>
        </div>
      ) : null}
      <div className="nox-table-actions">
        <button type="button" disabled={working} onClick={close}>
          Back without changes
        </button>
        <button
          type="button"
          className="nox-danger-action"
          disabled={working || stale || !revision || Boolean(error)}
          onClick={async () => {
            if (sending.current || stale || !revision || error) return;
            sending.current = true;
            setWorking(true);
            try {
              await onConfirm();
              onClose();
            } catch (reason) {
              setError(message(reason));
            } finally {
              sending.current = false;
              setWorking(false);
            }
          }}
        >
          {working ? "Submitting…" : `Confirm ${title}`}
        </button>
      </div>
    </NoxDialog>
  );
}

function DangerousButton({
  children,
  disabled = false,
  ...props
}: {
  children: string;
  disabled?: boolean;
  target: string;
  state: string;
  revision?: string;
  permission: string;
  confirmation: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="nox-danger-action"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? (
        <PlatformConfirmation {...props} title={children} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function MembershipRoleSelector({
  member,
  tenantId,
  canManageOwners,
  permission,
  onChange,
  disabled = false
}: {
  member: Membership;
  tenantId: string;
  canManageOwners: boolean;
  permission: string;
  onChange: (role: TenantRoleKey) => Promise<void>;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<TenantRoleKey>();
  const [working, setWorking] = useState(false);
  const sending = useRef(false);
  const change = async (role: TenantRoleKey) => {
    if (sending.current || disabled) return;
    sending.current = true;
    setWorking(true);
    try {
      await onChange(role);
    } finally {
      sending.current = false;
      setWorking(false);
    }
  };
  return (
    <>
      <select
        aria-label={`Role for ${member.userId}`}
        value={member.roleKey}
        disabled={working || disabled || !member.revision}
        onChange={(event) => {
          const next = event.target.value as TenantRoleKey;
          if (next === member.roleKey) return;
          if (member.roleKey === "TENANT_OWNER") setPending(next);
          else void change(next).catch(() => {}); // Parent renders the API error.
        }}
      >
        <option value="TENANT_MEMBER">TENANT_MEMBER</option>
        <option value="TENANT_ADMIN">TENANT_ADMIN</option>
        {canManageOwners ? <option value="TENANT_OWNER">TENANT_OWNER</option> : null}
      </select>
      {pending ? (
        <PlatformConfirmation
          title="Demote Tenant Owner"
          target={`${member.userId} · Tenant ${tenantId}`}
          state={`${member.roleKey} · ${member.status}`}
          revision={member.revision}
          permission={permission}
          confirmation={`Change this membership to ${pending}? The server will preserve an effective owner.`}
          onConfirm={() => change(pending)}
          onClose={() => setPending(undefined)}
        />
      ) : null}
    </>
  );
}

export function PlatformUsersScreen({ api }: { api: ApiClient }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const provisioningRef = useRef(false);
  useUnsavedChanges(Boolean(userId || displayName || provisioning));
  const [error, setError] = useState<string>();
  const [readState, setReadState] = useState<ReadState>("LOADING");

  const refresh = () => {
    setReadState("LOADING");
    setError(undefined);
    return api<{ users: PlatformUser[] }>("/platform/users")
      .then((payload) => {
        if (!Array.isArray(payload.users)) throw new Error("Invalid Platform users response.");
        setUsers(payload.users);
        setReadState("READY");
      })
      .catch((reason) => {
        setReadState("ERROR");
        setError(message(reason));
        throw reason;
      });
  };

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);

  const provision = async (event: FormEvent) => {
    event.preventDefault();
    if (readState !== "READY" || provisioningRef.current) return;
    provisioningRef.current = true;
    setProvisioning(true);
    setError(undefined);
    try {
      await api("/platform/users", {
        method: "POST",
        body: { userId, displayName: displayName.trim() || null }
      });
      setUserId("");
      setDisplayName("");
      await refresh().catch(() => {
        throw new Error(
          "PlatformUser provisioned, but the registry could not be reloaded. Reload current data before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
    } finally {
      provisioningRef.current = false;
      setProvisioning(false);
    }
  };

  const patch = async (target: PlatformUser, body: unknown) => {
    if (readState !== "READY")
      throw new Error("Reload current Platform users before changing them.");
    setError(undefined);
    try {
      if (!target.revision)
        throw new Error("Revision unavailable. Reload current data before saving.");
      await api(`/platform/users/${target.id}`, {
        method: "PATCH",
        body: { ...(body as object), expectedRevision: target.revision }
      });
      await refresh().catch(() => {
        throw new Error(
          "Change saved, but current users could not be reloaded. Reload this page before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
      throw reason;
    }
  };

  return (
    <section className="nox-control-plane" aria-labelledby="platform-users-title">
      <p className="nox-ai-context">Platform / Users</p>
      <h1 id="platform-users-title">Platform users</h1>
      <ReadFeedback
        state={readState}
        subject="Platform users"
        retry={refresh}
        disabled={provisioning}
        empty={!users.length ? "No Platform users found." : undefined}
      />
      <form className="nox-inline-form" onSubmit={provision} aria-label="Provision PlatformUser">
        <label>
          Existing Auth user ID
          <input
            disabled={provisioning}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          />
        </label>
        <label>
          Display name
          <input
            disabled={provisioning}
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={readState !== "READY" || provisioning}>
          {provisioning ? "Provisioning…" : "Provision PlatformUser"}
        </button>
        {userId || displayName ? (
          <button
            type="button"
            disabled={provisioning}
            onClick={() => {
              setUserId("");
              setDisplayName("");
            }}
          >
            Discard user draft
          </button>
        ) : null}
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
                      disabled={readState !== "READY"}
                      target={`${user.displayName ?? "PlatformUser"} · ${user.id}`}
                      revision={user.revision}
                      state={`${user.status} · ${user.platformRoleKey ?? "No platform role"}`}
                      permission="platform.user.status.manage"
                      confirmation="Disable this PlatformUser? Tenant-owner safeguards will be checked by the server."
                      onConfirm={() => patch(user, { status: "DISABLED" })}
                    >
                      Disable
                    </DangerousButton>
                  ) : (
                    <button
                      type="button"
                      disabled={readState !== "READY"}
                      onClick={() => void patch(user, { status: "ACTIVE" }).catch(() => {})}
                    >
                      Activate
                    </button>
                  )}
                  {user.platformRoleKey === "PLATFORM_OWNER" ? (
                    <DangerousButton
                      disabled={readState !== "READY"}
                      target={`${user.displayName ?? "PlatformUser"} · ${user.id}`}
                      revision={user.revision}
                      state={`${user.status} · ${user.platformRoleKey}`}
                      permission="platform.owner.manage"
                      confirmation="Remove PLATFORM_OWNER? The server will preserve the last active owner."
                      onConfirm={() => patch(user, { platformRoleKey: null })}
                    >
                      Remove PLATFORM_OWNER
                    </DangerousButton>
                  ) : (
                    <button
                      type="button"
                      disabled={readState !== "READY"}
                      onClick={() =>
                        void patch(user, { platformRoleKey: "PLATFORM_OWNER" }).catch(() => {})
                      }
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
  onRefresh,
  parentReadReady,
  onDraftChange
}: {
  api: ApiClient;
  tenant: Tenant;
  users: readonly PlatformUser[];
  modules: readonly RegisteredModule[];
  onRefresh: () => Promise<void>;
  parentReadReady: boolean;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<TenantRoleKey>("TENANT_MEMBER");
  const [addingMember, setAddingMember] = useState(false);
  const addingMemberRef = useRef(false);
  const memberDraft = Boolean(newMemberId || newMemberRole !== "TENANT_MEMBER" || addingMember);
  useUnsavedChanges(memberDraft);
  useEffect(() => {
    onDraftChange(memberDraft);
    return () => onDraftChange(false);
  }, [memberDraft, onDraftChange]);
  const [error, setError] = useState<string>();
  const [readState, setReadState] = useState<ReadState>("LOADING");
  const canMutate = parentReadReady && readState === "READY";

  const refreshDetail = () => {
    setReadState("LOADING");
    setError(undefined);
    return Promise.all([
      api<{ members: Membership[] }>(`/platform/tenants/${tenant.id}/members`),
      api<{ entitlements: Entitlement[] }>(`/platform/tenants/${tenant.id}/entitlements`)
    ])
      .then(([memberPayload, entitlementPayload]) => {
        if (
          !Array.isArray(memberPayload.members) ||
          !Array.isArray(entitlementPayload.entitlements)
        )
          throw new Error("Invalid Tenant detail response.");
        setMembers(memberPayload.members);
        setEntitlements(entitlementPayload.entitlements);
        setReadState("READY");
      })
      .catch((reason) => {
        setReadState("ERROR");
        setError(message(reason));
        throw reason;
      });
  };

  useEffect(() => {
    void refreshDetail().catch(() => {});
  }, [tenant.id]);

  const patchMembership = async (member: Membership, body: unknown) => {
    if (!canMutate) throw new Error("Reload current Tenant detail before changing memberships.");
    setError(undefined);
    try {
      if (!member.revision)
        throw new Error("Revision unavailable. Reload current data before saving.");
      await api(`/platform/tenants/${tenant.id}/members/${member.userId}`, {
        method: "PATCH",
        body: { ...(body as object), expectedRevision: member.revision }
      });
      await refreshDetail().catch(() => {
        throw new Error(
          "Change saved, but current memberships could not be reloaded. Reload this page before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
      throw reason;
    }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!newMemberId || !canMutate || addingMemberRef.current) return;
    addingMemberRef.current = true;
    setAddingMember(true);
    setError(undefined);
    try {
      await api(`/platform/tenants/${tenant.id}/members`, {
        method: "POST",
        body: { userId: newMemberId, roleKey: newMemberRole }
      });
      setNewMemberId("");
      setNewMemberRole("TENANT_MEMBER");
      await refreshDetail().catch(() => {
        throw new Error(
          "Membership added, but members could not be reloaded. Reload current data before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
    } finally {
      addingMemberRef.current = false;
      setAddingMember(false);
    }
  };

  const setEntitlement = async (key: string, enabled: boolean) => {
    if (!canMutate) return;
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
    if (!canMutate) throw new Error("Reload current Tenant detail before changing status.");
    try {
      if (!tenant.revision)
        throw new Error("Revision unavailable. Reload current data before saving.");
      await api(`/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: {
          status: tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
          expectedRevision: tenant.revision
        }
      });
      await onRefresh().catch(() => {
        throw new Error(
          "Change saved, but current tenants could not be reloaded. Reload this page before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
      throw reason;
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
            disabled={!canMutate}
            target={`${tenant.name} · ${tenant.id}`}
            revision={tenant.revision}
            state={tenant.status}
            permission="platform.tenant.status.manage"
            confirmation="Suspend this tenant? Workspace access will be denied."
            onConfirm={suspend}
          >
            Suspend tenant
          </DangerousButton>
        ) : (
          <button
            type="button"
            disabled={!canMutate}
            onClick={() => void suspend().catch(() => {})}
          >
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
        <ReadFeedback
          state={readState}
          subject="Tenant detail"
          retry={refreshDetail}
          disabled={addingMember || !parentReadReady}
          empty={!members.length ? "No memberships found." : undefined}
        />
        <form className="nox-inline-form" onSubmit={addMember}>
          <label>
            Existing PlatformUser
            <select
              value={newMemberId}
              disabled={!canMutate || addingMember}
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
              disabled={!canMutate || addingMember}
              onChange={(event) => setNewMemberRole(event.target.value as TenantRoleKey)}
            >
              <option value="TENANT_MEMBER">TENANT_MEMBER</option>
              <option value="TENANT_ADMIN">TENANT_ADMIN</option>
              <option value="TENANT_OWNER">TENANT_OWNER</option>
            </select>
          </label>
          <button type="submit" disabled={!canMutate || addingMember}>
            {addingMember ? "Adding membership…" : "Add existing user"}
          </button>
          {memberDraft ? (
            <button
              type="button"
              disabled={addingMember}
              onClick={() => {
                setNewMemberId("");
                setNewMemberRole("TENANT_MEMBER");
              }}
            >
              Discard member draft
            </button>
          ) : null}
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
                    <MembershipRoleSelector
                      disabled={!canMutate}
                      member={member}
                      tenantId={tenant.id}
                      canManageOwners
                      permission="platform.membership.owner.manage"
                      onChange={(roleKey) => patchMembership(member, { roleKey })}
                    />
                    {member.status === "ACTIVE" ? (
                      <DangerousButton
                        disabled={!canMutate}
                        target={`${member.userId} · Tenant ${tenant.id}`}
                        revision={member.revision}
                        state={`${member.roleKey} · ${member.status}`}
                        permission={
                          member.roleKey === "TENANT_OWNER"
                            ? "platform.membership.owner.manage"
                            : "platform.membership.manage"
                        }
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
                        disabled={!canMutate}
                        onClick={() =>
                          void patchMembership(member, { status: "ACTIVE" }).catch(() => {})
                        }
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
                          disabled={!canMutate}
                          checked={enabled}
                          onChange={(event) => void setEntitlement(key, event.target.checked)}
                        />
                        <span>
                          {readState !== "READY"
                            ? "Not verified"
                            : enabled
                              ? "Enabled"
                              : "Disabled"}
                        </span>
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
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [memberDraftOpen, setMemberDraftOpen] = useState(false);
  useUnsavedChanges(Boolean(name || slug || initialOwnerUserId || creating));
  const [error, setError] = useState<string>();
  const [readState, setReadState] = useState<ReadState>("LOADING");

  const refresh = async () => {
    setReadState("LOADING");
    setError(undefined);
    try {
      const [tenantPayload, userPayload] = await Promise.all([
        api<{ tenants: Tenant[] }>("/platform/tenants"),
        api<{ users: PlatformUser[] }>("/platform/users")
      ]);
      if (!Array.isArray(tenantPayload.tenants) || !Array.isArray(userPayload.users))
        throw new Error("Invalid Platform tenants response.");
      setTenants(tenantPayload.tenants);
      setUsers(userPayload.users);
      setReadState("READY");
    } catch (reason) {
      setReadState("ERROR");
      setError(message(reason));
      throw reason;
    }
  };

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);

  const createTenant = async (event: FormEvent) => {
    event.preventDefault();
    if (readState !== "READY" || creatingRef.current || memberDraftOpen) return;
    creatingRef.current = true;
    setCreating(true);
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
      await refresh().catch(() => {
        throw new Error(
          "Tenant created, but the registry could not be reloaded. Reload current data before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const selected = tenants.find((tenant) => tenant.id === selectedTenantId);
  return (
    <section className="nox-control-plane" aria-labelledby="platform-tenants-title">
      <p className="nox-ai-context">Platform / Tenants</p>
      <h1 id="platform-tenants-title">Platform tenants</h1>
      <ReadFeedback
        state={readState}
        subject="Platform tenants"
        retry={refresh}
        disabled={creating || memberDraftOpen}
        empty={!tenants.length ? "No tenants found." : undefined}
      />
      <form className="nox-inline-form" onSubmit={createTenant} aria-label="Create tenant">
        <label>
          Name
          <input
            disabled={creating}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Slug
          <input
            disabled={creating}
            maxLength={80}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
          />
        </label>
        <label>
          Initial owner
          <select
            value={initialOwnerUserId}
            disabled={creating || readState !== "READY"}
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
        <button type="submit" disabled={readState !== "READY" || creating || memberDraftOpen}>
          {creating ? "Creating tenant…" : "Create tenant"}
        </button>
        {name || slug || initialOwnerUserId ? (
          <button
            type="button"
            disabled={creating}
            onClick={() => {
              setName("");
              setSlug("");
              setInitialOwnerUserId("");
            }}
          >
            Discard tenant draft
          </button>
        ) : null}
      </form>
      {memberDraftOpen ? (
        <p>Save or discard the member draft before opening or creating another tenant.</p>
      ) : null}
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
                  <button
                    type="button"
                    disabled={readState !== "READY" || creating || memberDraftOpen}
                    onClick={() => setSelectedTenantId(tenant.id)}
                  >
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
          key={selected.id}
          api={api}
          tenant={selected}
          users={users}
          modules={modules}
          onRefresh={refresh}
          parentReadReady={readState === "READY" && !creating}
          onDraftChange={setMemberDraftOpen}
        />
      ) : null}
    </section>
  );
}

export function PlatformAuditScreen({ api }: { api: ApiClient }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string>();
  const [readState, setReadState] = useState<ReadState>("LOADING");
  const refresh = async () => {
    setReadState("LOADING");
    setError(undefined);
    try {
      const payload = await api<{ events: AuditEvent[] }>("/platform/audit?limit=50&offset=0");
      if (!Array.isArray(payload.events)) throw new Error("Invalid Platform audit response.");
      setEvents(payload.events);
      setReadState("READY");
    } catch (reason) {
      setReadState("ERROR");
      setError(message(reason));
      throw reason;
    }
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  return (
    <section className="nox-control-plane" aria-labelledby="platform-audit-title">
      <p className="nox-ai-context">Platform / Audit</p>
      <h1 id="platform-audit-title">Platform audit</h1>
      <ReadFeedback
        state={readState}
        subject="Platform audit"
        retry={refresh}
        empty={!events.length ? "No audit events found." : undefined}
      />
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
  tenantPermissions
}: {
  api: ApiClient;
  tenantId?: string;
  tenantPermissions: readonly string[];
}) {
  const [tenant, setTenant] = useState<Tenant>();
  const [members, setMembers] = useState<Membership[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [name, setName] = useState("");
  const [nameRevision, setNameRevision] = useState<string>();
  const [nameError, setNameError] = useState<string>();
  const [nameSaved, setNameSaved] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const editingName = useRef(false);
  const sendingName = useRef(false);
  const refreshGeneration = useRef(0);
  const [error, setError] = useState<string>();
  const [readState, setReadState] = useState<ReadState>("LOADING");
  const nameStale = Boolean(tenant && nameRevision && tenant.revision !== nameRevision);
  const nameDirty = Boolean(tenant && (name !== tenant.name || nameStale));
  useUnsavedChanges(nameDirty || savingName);

  const refresh = () => {
    if (!tenantId || sendingName.current) return Promise.resolve();
    const generation = ++refreshGeneration.current;
    setReadState("LOADING");
    setError(undefined);
    return Promise.all([
      api<{ tenant: Tenant }>("/tenant", { tenantId }),
      api<{ members: Membership[] }>("/tenant/members", { tenantId }),
      api<{ entitlements: Entitlement[] }>("/tenant/entitlements", { tenantId })
    ])
      .then(([tenantPayload, memberPayload, entitlementPayload]) => {
        if (generation !== refreshGeneration.current) return;
        if (
          tenantPayload.tenant?.id !== tenantId ||
          !Array.isArray(memberPayload.members) ||
          !Array.isArray(entitlementPayload.entitlements)
        )
          throw new Error("Invalid tenant settings response.");
        setTenant(tenantPayload.tenant);
        // A membership refresh must never replace an active name draft or rebase
        // its write precondition onto an unseen revision.
        if (!editingName.current && !sendingName.current) {
          setName(tenantPayload.tenant.name);
          setNameRevision(tenantPayload.tenant.revision);
        }
        setMembers(memberPayload.members);
        setEntitlements(entitlementPayload.entitlements);
        setReadState("READY");
      })
      .catch((reason) => {
        if (generation !== refreshGeneration.current) return;
        setReadState("ERROR");
        setError(message(reason));
        throw reason;
      });
  };

  useEffect(() => {
    editingName.current = false;
    setName("");
    setNameRevision(undefined);
    setNameError(undefined);
    setNameSaved(false);
    setTenant(undefined);
    setMembers([]);
    setEntitlements([]);
    setError(undefined);
    void refresh().catch(() => {});
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

  const canManage = tenantPermissions.includes("tenant.membership.manage");
  const canManageOwners = tenantPermissions.includes("tenant.membership.owner.manage");
  const canManageProfile = tenantPermissions.includes("tenant.profile.manage");
  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingName.current || !canManageProfile || !nameDirty || readState !== "READY") return;
    setNameError(undefined);
    setNameSaved(false);
    if (nameStale || !nameRevision) {
      setNameError(
        "Tenant changed or its revision is unavailable. Review current data before saving."
      );
      return;
    }
    sendingName.current = true;
    ++refreshGeneration.current;
    setSavingName(true);
    try {
      const result = await api<{ tenant: Tenant }>("/tenant", {
        method: "PATCH",
        body: { name, expectedRevision: nameRevision },
        tenantId
      });
      if (!result.tenant?.revision || result.tenant.id !== tenantId)
        throw new Error(
          "Save response could not be verified. Keep this draft and reload current data before another change."
        );
      setTenant(result.tenant);
      ++refreshGeneration.current;
      setName(result.tenant.name);
      setNameRevision(result.tenant.revision);
      editingName.current = false;
      setNameSaved(true);
    } catch (reason) {
      setNameError(message(reason));
    } finally {
      sendingName.current = false;
      setSavingName(false);
    }
  };
  const patchMembership = async (member: Membership, body: unknown) => {
    setError(undefined);
    try {
      if (!member.revision)
        throw new Error("Revision unavailable. Reload current data before saving.");
      await api(`/tenant/members/${member.userId}`, {
        method: "PATCH",
        body: { ...(body as object), expectedRevision: member.revision },
        tenantId
      });
      await refresh().catch(() => {
        throw new Error(
          "Change saved, but current memberships could not be reloaded. Reload this page before another change."
        );
      });
    } catch (reason) {
      setError(message(reason));
      throw reason;
    }
  };

  return (
    <section className="nox-control-plane" aria-labelledby="tenant-settings-title">
      <p className="nox-ai-context">Settings / Tenant</p>
      <h1 id="tenant-settings-title">Tenant settings</h1>
      {error ? <p role="alert">{error}</p> : null}
      <ReadFeedback
        state={readState}
        subject="Tenant settings"
        retry={refresh}
        disabled={savingName}
      />
      <section aria-labelledby="tenant-settings-general-title">
        <h2 id="tenant-settings-general-title">General</h2>
        <form
          className="nox-inline-form"
          onSubmit={saveName}
          aria-label="Tenant name"
          aria-busy={savingName}
        >
          <label>
            Name
            <input
              value={name}
              onChange={(event) => {
                editingName.current = true;
                setName(event.target.value);
                setNameSaved(false);
                setNameError(undefined);
              }}
              disabled={!canManageProfile || savingName || !tenant || readState !== "READY"}
              maxLength={120}
              aria-invalid={Boolean(nameError || nameStale)}
              aria-describedby={
                nameError
                  ? "tenant-name-error"
                  : nameStale
                    ? "tenant-name-conflict"
                    : "tenant-name-help"
              }
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
          {canManageProfile ? (
            <button
              type="submit"
              disabled={
                savingName || !nameDirty || nameStale || !nameRevision || readState !== "READY"
              }
            >
              {savingName ? "Saving name…" : "Save name"}
            </button>
          ) : null}
        </form>
        <p id="tenant-name-help">
          Up to 120 characters. Changes are saved only when you choose Save name.
        </p>
        {nameError ? (
          <p id="tenant-name-error" role="alert">
            {nameError}
          </p>
        ) : null}
        {nameStale ? (
          <p id="tenant-name-conflict" role="alert">
            Tenant changed while this draft was open. Your draft is preserved; the loaded name is “
            {tenant?.name}”. Discard it explicitly before starting from the loaded revision.
          </p>
        ) : null}
        {nameDirty && tenant ? (
          <button
            type="button"
            disabled={savingName}
            onClick={() => {
              setName(tenant.name);
              setNameRevision(tenant.revision);
              setNameError(undefined);
              setNameSaved(false);
              editingName.current = false;
            }}
          >
            Discard draft and use loaded name
          </button>
        ) : null}
        {nameSaved ? <p role="status">Tenant name saved.</p> : null}
      </section>
      <section aria-labelledby="tenant-settings-members-title">
        <h2 id="tenant-settings-members-title">Members</h2>
        {readState === "READY" && !members.length ? <p>No memberships found.</p> : null}
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
                const mutable =
                  readState === "READY" && canManage && (!ownerProtected || canManageOwners);
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
                          <MembershipRoleSelector
                            member={member}
                            tenantId={tenantId}
                            canManageOwners={canManageOwners}
                            permission="tenant.membership.owner.manage"
                            onChange={(roleKey) => patchMembership(member, { roleKey })}
                          />
                          {member.status === "ACTIVE" ? (
                            <DangerousButton
                              target={`${member.userId} · Tenant ${tenantId}`}
                              revision={member.revision}
                              state={`${member.roleKey} · ${member.status}`}
                              permission={
                                ownerProtected
                                  ? "tenant.membership.owner.manage"
                                  : "tenant.membership.manage"
                              }
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
                              onClick={() =>
                                void patchMembership(member, { status: "ACTIVE" }).catch(() => {})
                              }
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
          {readState === "READY" && entitlements.length === 0 ? (
            <li>No module entitlement is enabled.</li>
          ) : null}
        </ul>
      </section>
    </section>
  );
}
