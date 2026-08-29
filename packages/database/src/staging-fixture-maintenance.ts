import postgres, { type Sql } from "postgres";

/**
 * This connection is intentionally unavailable to application runtime code.
 * It exists solely for ephemeral, non-production acceptance-fixture cleanup.
 */
export function createStagingFixtureMaintenanceDatabase(input: {
  runtimeConnectionUrl: string;
  projectRef: string;
  databasePassword: string;
}): Sql {
  const runtime = new URL(input.runtimeConnectionUrl);
  if (
    !runtime.hostname.endsWith(".pooler.supabase.com") ||
    runtime.port !== "6543" ||
    !/^[a-z0-9]{8,64}$/i.test(input.projectRef)
  ) {
    throw new Error(
      "Staging fixture maintenance requires a project-bound Supavisor transaction URL."
    );
  }
  const url = new URL(runtime);
  url.username = "postgres." + input.projectRef;
  url.password = input.databasePassword;
  return postgres(url.toString(), { prepare: false, max: 1, connect_timeout: 10 });
}
