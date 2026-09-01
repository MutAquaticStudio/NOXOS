import postgres, { type Sql } from "postgres";

export * from "./platform-store.js";
export * from "./material-store.js";
export * from "./design-studio-store.js";
export * from "./trial-sensory-store.js";
export * from "./release-readiness-store.js";
export * from "./staging-fixture-maintenance.js";

export type RuntimeDatabaseOptions = {
  connectionUrl: string;
  applicationName: string;
  expectedRole: RuntimeDatabaseRole;
};

export type RuntimeDatabaseRole = "nox_app_runtime" | "nox_workflow_runtime";

export type DatabaseConnectionPlan = {
  runtimeConnectionUrl: string;
  migrationConnectionUrl: string;
};

/**
 * Serverless connection policy. Individual future business commands must add
 * bounded query behavior before they are introduced in G2.
 */
export const runtimeDatabaseTimeoutPolicy = {
  connectTimeoutSeconds: 5,
  idleConnectionTimeoutSeconds: 10,
  maxConnectionLifetimeSeconds: 60
} as const;

export function assertLowPrivilegeRuntimeConnection(connectionUrl: string): void {
  const username = runtimeRoleFromConnectionUrl(connectionUrl);
  const forbidden = new Set(["postgres", "supabase_admin", "migration_admin"]);

  if (!username || forbidden.has(username)) {
    throw new Error(
      "Runtime database connection must use a dedicated low-privilege application role."
    );
  }
}

export function runtimeRoleFromConnectionUrl(connectionUrl: string): string {
  const url = new URL(connectionUrl);
  const username = decodeURIComponent(url.username);
  if (!username) {
    return "";
  }

  // Supavisor transaction-pooler identities are encoded as <role>.<project-ref>.
  // Authorization belongs to the role portion, not the provider routing suffix.
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    const separator = username.lastIndexOf(".");
    return separator > 0 ? username.slice(0, separator) : username;
  }

  return username;
}

export function assertExpectedRuntimeRole(
  connectionUrl: string,
  expectedRole: RuntimeDatabaseRole
): void {
  if (runtimeRoleFromConnectionUrl(connectionUrl) !== expectedRole) {
    throw new Error("Runtime database connection does not use the expected limited role.");
  }
}

export function assertServerlessPoolerConnection(connectionUrl: string): void {
  const url = new URL(connectionUrl);
  if (!url.hostname.endsWith(".pooler.supabase.com") || url.port !== "6543") {
    throw new Error(
      "Runtime database connection must use the Supabase transaction pooler on port 6543."
    );
  }
}

export function assertSeparateMigrationConnection(plan: DatabaseConnectionPlan): void {
  if (plan.runtimeConnectionUrl === plan.migrationConnectionUrl) {
    throw new Error("Runtime and migration database connections must be separate.");
  }
  assertLowPrivilegeRuntimeConnection(plan.runtimeConnectionUrl);
}

export function createRuntimeDatabase(options: RuntimeDatabaseOptions): Sql {
  assertLowPrivilegeRuntimeConnection(options.connectionUrl);
  assertServerlessPoolerConnection(options.connectionUrl);
  assertExpectedRuntimeRole(options.connectionUrl, options.expectedRole);

  return postgres(options.connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: runtimeDatabaseTimeoutPolicy.connectTimeoutSeconds,
    idle_timeout: runtimeDatabaseTimeoutPolicy.idleConnectionTimeoutSeconds,
    max_lifetime: runtimeDatabaseTimeoutPolicy.maxConnectionLifetimeSeconds,
    connection: {
      application_name: options.applicationName
    }
  });
}

export type DatabaseProbe = {
  healthy: boolean;
  detail?: string;
  role?: string;
  privileges?: {
    superuser: boolean;
    createRole: boolean;
    createDatabase: boolean;
    replication: boolean;
    bypassRls: boolean;
    ownsDatabase: boolean;
  };
};

type RuntimeRoleEvidence = {
  role_name: string;
  is_superuser: boolean;
  can_create_role: boolean;
  can_create_database: boolean;
  can_replicate: boolean;
  can_bypass_rls: boolean;
  owns_database: boolean;
};

export async function probeDatabase(
  sql: Sql,
  expectedRole: RuntimeDatabaseRole
): Promise<DatabaseProbe> {
  try {
    const rows = await sql<RuntimeRoleEvidence[]>`
      select
        current_user::text as role_name,
        role.rolsuper as is_superuser,
        role.rolcreaterole as can_create_role,
        role.rolcreatedb as can_create_database,
        role.rolreplication as can_replicate,
        role.rolbypassrls as can_bypass_rls,
        database.datdba = role.oid as owns_database
      from pg_catalog.pg_roles as role
      join pg_catalog.pg_database as database
        on database.datname = current_database()
      where role.rolname = current_user
    `;
    const evidence = rows[0];
    if (
      !evidence ||
      evidence.role_name !== expectedRole ||
      evidence.is_superuser ||
      evidence.can_create_role ||
      evidence.can_create_database ||
      evidence.can_replicate ||
      evidence.can_bypass_rls ||
      evidence.owns_database
    ) {
      return { healthy: false, detail: "Database runtime role boundary verification failed." };
    }

    return {
      healthy: true,
      role: evidence.role_name,
      privileges: {
        superuser: evidence.is_superuser,
        createRole: evidence.can_create_role,
        createDatabase: evidence.can_create_database,
        replication: evidence.can_replicate,
        bypassRls: evidence.can_bypass_rls,
        ownsDatabase: evidence.owns_database
      }
    };
  } catch {
    return { healthy: false, detail: "Database probe failed." };
  }
}

export type WorkflowProbeCompletion = {
  workflowId: string;
  correlationId: string;
  idempotencyKey: string;
  deliveryCount: number;
};

export type WorkflowProbeRecord = WorkflowProbeCompletion & {
  state: "COMPLETED";
  completedAt: Date;
};

export async function recordWorkflowProbeCompletion(
  sql: Sql,
  completion: WorkflowProbeCompletion
): Promise<void> {
  await sql`
    insert into nox_foundation.workflow_probe_runs (
      workflow_id,
      correlation_id,
      idempotency_key,
      state,
      delivery_count,
      completed_at
    ) values (
      ${completion.workflowId},
      ${completion.correlationId},
      ${completion.idempotencyKey},
      'COMPLETED',
      ${completion.deliveryCount},
      now()
    )
    on conflict (workflow_id) do update set
      correlation_id = excluded.correlation_id,
      idempotency_key = excluded.idempotency_key,
      state = excluded.state,
      delivery_count = greatest(
        nox_foundation.workflow_probe_runs.delivery_count,
        excluded.delivery_count
      ),
      completed_at = excluded.completed_at
  `;
}

type WorkflowProbeRow = {
  workflow_id: string;
  correlation_id: string;
  idempotency_key: string;
  state: string;
  delivery_count: number;
  completed_at: Date;
};

export async function readWorkflowProbeRecord(
  sql: Sql,
  workflowId: string
): Promise<WorkflowProbeRecord | undefined> {
  const rows = await sql<WorkflowProbeRow[]>`
    select
      workflow_id,
      correlation_id,
      idempotency_key,
      state,
      delivery_count,
      completed_at
    from nox_foundation.workflow_probe_runs
    where workflow_id = ${workflowId}
  `;
  const row = rows[0];
  if (!row || row.state !== "COMPLETED") {
    return undefined;
  }
  return {
    workflowId: row.workflow_id,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    state: "COMPLETED",
    deliveryCount: row.delivery_count,
    completedAt: row.completed_at
  };
}
