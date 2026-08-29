import { describe, expect, it } from "vitest";
import { verifyEnvironmentIsolation } from "../../scripts/verify/environment-isolation";

const stagingProject = "abcdefghijklmno12345";
const productionProject = "zyxwvutsrqponm54321";
const runtimeDatabaseUrl =
  "postgresql://nox_app_runtime.abcdefghijklmno12345:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const workflowDatabaseUrl =
  "postgresql://nox_workflow_runtime.abcdefghijklmno12345:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

describe("non-production environment isolation", () => {
  it("requires ordinary Preview to remain secretless", () => {
    expect(() =>
      verifyEnvironmentIsolation({
        NOX_EXPECTED_ENV: "preview",
        NOX_ISOLATION_MODE: "SECRETLESS_PREVIEW",
        NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
        NOX_PRODUCTION_DATABASE_RESOURCE: productionProject
      })
    ).not.toThrow();
    expect(() =>
      verifyEnvironmentIsolation({
        NOX_EXPECTED_ENV: "preview",
        NOX_ISOLATION_MODE: "SECRETLESS_PREVIEW",
        NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
        NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
        NOX_DIAGNOSTIC_PROBE_TOKEN: "must-not-reach-preview"
      })
    ).toThrow(/Secretless Preview verification received runtime credentials/);
  });

  it("binds connected Staging credentials to its Supabase project without Production secrets", () => {
    const base = {
      NOX_EXPECTED_ENV: "staging",
      NOX_ISOLATION_MODE: "CONNECTED_NON_PRODUCTION",
      NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
      NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
      NOX_CURRENT_STORAGE_RESOURCE: "nox-private",
      SUPABASE_URL: "https://abcdefghijklmno12345.supabase.co",
      SUPABASE_STORAGE_BUCKET: "nox-private",
      NOX_RUNTIME_DATABASE_URL: runtimeDatabaseUrl,
      NOX_WORKFLOW_DATABASE_URL: workflowDatabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key"
    };

    expect(() => verifyEnvironmentIsolation(base)).not.toThrow();
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        NOX_RUNTIME_DATABASE_URL:
          "postgresql://nox_app_runtime.zyxwvutsrqponm54321:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
      })
    ).toThrow(/does not bind its Supavisor identity/);
    const productionBoundRuntime =
      "postgresql://nox_app_runtime.zyxwvutsrqponm54321:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        NOX_RUNTIME_DATABASE_URL: productionBoundRuntime
      })
    ).toThrow(/does not bind its Supavisor identity/);
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        SUPABASE_URL: "https://zyxwvutsrqponm54321.supabase.co"
      })
    ).toThrow(/does not identify the expected non-production project/);
    expect(() =>
      verifyEnvironmentIsolation({ ...base, SUPABASE_STORAGE_BUCKET: "different-bucket" })
    ).toThrow(/bucket does not match/);
  });

  it("treats Storage identity as the project reference plus bucket ID", () => {
    expect(() =>
      verifyEnvironmentIsolation({
        NOX_EXPECTED_ENV: "staging",
        NOX_ISOLATION_MODE: "CONNECTED_NON_PRODUCTION",
        NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
        NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
        NOX_CURRENT_STORAGE_RESOURCE: "nox-os-private",
        SUPABASE_URL: "https://abcdefghijklmno12345.supabase.co",
        SUPABASE_STORAGE_BUCKET: "nox-os-private",
        NOX_RUNTIME_DATABASE_URL: runtimeDatabaseUrl,
        NOX_WORKFLOW_DATABASE_URL: workflowDatabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key"
      })
    ).not.toThrow();
  });
});
