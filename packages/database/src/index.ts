import postgres, { type Sql } from "postgres";

export type RuntimeDatabaseOptions = {
  connectionUrl: string;
  applicationName: string;
};

export type DatabaseConnectionPlan = {
  runtimeConnectionUrl: string;
  migrationConnectionUrl: string;
};

export function assertLowPrivilegeRuntimeConnection(connectionUrl: string): void {
  const username = new URL(connectionUrl).username;
  const forbidden = new Set(["postgres", "supabase_admin", "migration_admin"]);

  if (!username || forbidden.has(username)) {
    throw new Error(
      "Runtime database connection must use a dedicated low-privilege application role."
    );
  }
}

export function assertServerlessPoolerConnection(connectionUrl: string): void {
  const hostname = new URL(connectionUrl).hostname;
  if (!hostname.includes("pooler.")) {
    throw new Error("Runtime database connection must use the Supabase serverless pooler host.");
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

  return postgres(options.connectionUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 10,
    connection: {
      application_name: options.applicationName
    }
  });
}

export type DatabaseProbe = {
  healthy: boolean;
  detail?: string;
};

export async function probeDatabase(sql: Sql): Promise<DatabaseProbe> {
  try {
    await sql`select 1 as ok`;
    return { healthy: true };
  } catch {
    return { healthy: false, detail: "Database probe failed." };
  }
}
