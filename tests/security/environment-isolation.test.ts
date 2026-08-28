import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEnvironmentIsolation } from "../../scripts/verify/environment-isolation";

const stagingProject = "abcdefghijklmno12345";
const productionProject = "zyxwvutsrqponm54321";
const runtimeDatabaseUrl =
  "postgresql://app_runtime.abcdefghijklmno12345:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("non-production environment isolation", () => {
  it("requires ordinary Preview to remain secretless", () => {
    expect(() =>
      verifyEnvironmentIsolation({
        NOX_EXPECTED_ENV: "preview",
        NOX_ISOLATION_MODE: "SECRETLESS_PREVIEW",
        NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
        NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
        NOX_CURRENT_STORAGE_RESOURCE: "preview-private",
        NOX_PRODUCTION_STORAGE_RESOURCE: "production-private"
      })
    ).not.toThrow();
    expect(() =>
      verifyEnvironmentIsolation({
        NOX_EXPECTED_ENV: "preview",
        NOX_ISOLATION_MODE: "SECRETLESS_PREVIEW",
        NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
        NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
        NOX_CURRENT_STORAGE_RESOURCE: "preview-private",
        NOX_PRODUCTION_STORAGE_RESOURCE: "production-private",
        NOX_DIAGNOSTIC_PROBE_TOKEN: "must-not-reach-preview"
      })
    ).toThrow(/Secretless Preview verification received runtime credentials/);
  });

  it("binds connected Staging credentials to its Supabase project and non-production fingerprint", () => {
    const base = {
      NOX_EXPECTED_ENV: "staging",
      NOX_ISOLATION_MODE: "CONNECTED_NON_PRODUCTION",
      NOX_CURRENT_DATABASE_RESOURCE: stagingProject,
      NOX_PRODUCTION_DATABASE_RESOURCE: productionProject,
      NOX_CURRENT_STORAGE_RESOURCE: "staging-private",
      NOX_PRODUCTION_STORAGE_RESOURCE: "production-private",
      SUPABASE_URL: "https://abcdefghijklmno12345.supabase.co",
      SUPABASE_STORAGE_BUCKET: "staging-private",
      NOX_RUNTIME_DATABASE_URL: runtimeDatabaseUrl,
      NOX_CURRENT_RUNTIME_DATABASE_URL_SHA256: fingerprint(runtimeDatabaseUrl),
      NOX_PRODUCTION_RUNTIME_DATABASE_URL_SHA256: fingerprint("different-production-runtime-url"),
      SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key",
      NOX_CURRENT_SUPABASE_SERVICE_ROLE_KEY_SHA256: fingerprint("staging-service-role-key"),
      NOX_PRODUCTION_SUPABASE_SERVICE_ROLE_KEY_SHA256: fingerprint("production-service-role-key")
    };

    expect(() => verifyEnvironmentIsolation(base)).not.toThrow();
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        NOX_RUNTIME_DATABASE_URL:
          "postgresql://app_runtime.zyxwvutsrqponm54321:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
      })
    ).toThrow(/does not match the protected non-production fingerprint/);
    const productionBoundRuntime =
      "postgresql://app_runtime.zyxwvutsrqponm54321:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        NOX_RUNTIME_DATABASE_URL: productionBoundRuntime,
        NOX_CURRENT_RUNTIME_DATABASE_URL_SHA256: fingerprint(productionBoundRuntime)
      })
    ).toThrow(/does not bind its host or pooler identity/);
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        SUPABASE_URL: "https://zyxwvutsrqponm54321.supabase.co"
      })
    ).toThrow(/does not identify the expected non-production project/);
    expect(() =>
      verifyEnvironmentIsolation({
        ...base,
        SUPABASE_SERVICE_ROLE_KEY: "production-service-role-key"
      })
    ).toThrow(/service-role credential does not match the protected non-production fingerprint/);
  });
});
