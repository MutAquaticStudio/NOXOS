import { describe, expect, it } from "vitest";
import {
  APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES,
  assertNoPublicSecrets,
  classifyViteEnvironmentKey,
  serverIdentity
} from "@nox-os/config";
import {
  assertExpectedRuntimeRole,
  assertLowPrivilegeRuntimeConnection,
  assertSeparateMigrationConnection,
  assertServerlessPoolerConnection,
  runtimeRoleFromConnectionUrl,
  runtimeDatabaseTimeoutPolicy
} from "@nox-os/database";
import { redactDetails } from "@nox-os/observability";
import {
  noAccessAdmission,
  DEFAULT_API_TIMEOUT_MS,
  requireCurrentWorkflowAuthority,
  verifyTurnstile
} from "@nox-os/platform";
import { SupabasePrivateFileStore } from "@nox-os/storage";

describe("security boundaries", () => {
  it("sets a bounded serverless API and database connection policy", () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBe(8_000);
    expect(runtimeDatabaseTimeoutPolicy).toEqual({
      connectTimeoutSeconds: 5,
      idleConnectionTimeoutSeconds: 10,
      maxConnectionLifetimeSeconds: 60
    });
  });

  it("rejects server-only information in the public Vite environment", () => {
    expect(() =>
      assertNoPublicSecrets({
        VITE_NOX_ENV: "preview",
        VITE_NOX_RUNTIME_DATABASE_URL: "should-never-be-public"
      })
    ).toThrow(/forbidden or unapproved keys/i);
  });

  it("separates application public config from provider metadata and server-only values", () => {
    expect(APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES).toEqual(["VITE_NOX_", "VITE_TURNSTILE_"]);
    expect(classifyViteEnvironmentKey("VITE_NOX_ENV")).toBe("APPLICATION_PUBLIC_CONFIG");
    expect(classifyViteEnvironmentKey("VITE_NOX_SOURCE_SHA")).toBe("APPLICATION_PUBLIC_CONFIG");
    expect(classifyViteEnvironmentKey("VITE_TURNSTILE_SITE_KEY")).toBe("APPLICATION_PUBLIC_CONFIG");
    expect(classifyViteEnvironmentKey("VITE_VERCEL_ENV")).toBe("PROVIDER_PUBLIC_SYSTEM_METADATA");
    expect(classifyViteEnvironmentKey("VITE_VERCEL_GIT_COMMIT_SHA")).toBe(
      "PROVIDER_PUBLIC_SYSTEM_METADATA"
    );
    expect(classifyViteEnvironmentKey("VITE_DATABASE_URL")).toBe("SERVER_ONLY_OR_UNAPPROVED");
    expect(classifyViteEnvironmentKey("VITE_SUPABASE_SERVICE_ROLE_KEY")).toBe(
      "SERVER_ONLY_OR_UNAPPROVED"
    );
    expect(classifyViteEnvironmentKey("VITE_CF_API_TOKEN")).toBe("SERVER_ONLY_OR_UNAPPROVED");

    expect(() =>
      assertNoPublicSecrets({
        VITE_NOX_ENV: "preview",
        VITE_NOX_SOURCE_SHA: "sha",
        VITE_TURNSTILE_SITE_KEY: "public-site-key",
        VITE_VERCEL_ENV: "preview",
        VITE_VERCEL_GIT_COMMIT_SHA: "provider-sha"
      })
    ).not.toThrow();
  });

  it("requires a separate low-privilege connection for serverless runtime traffic", () => {
    expect(() =>
      assertSeparateMigrationConnection({
        runtimeConnectionUrl: "postgres://app_runtime:password@pooler.example:6543/postgres",
        migrationConnectionUrl: "postgres://migration_admin:password@db.example:5432/postgres"
      })
    ).not.toThrow();
    expect(() =>
      assertSeparateMigrationConnection({
        runtimeConnectionUrl: "postgres://postgres:password@pooler.example:6543/postgres",
        migrationConnectionUrl: "postgres://postgres:password@pooler.example:6543/postgres"
      })
    ).toThrow();
    expect(() =>
      assertServerlessPoolerConnection(
        "postgres://app_runtime:password@pooler.example:6543/postgres"
      )
    ).not.toThrow();
    expect(() =>
      assertServerlessPoolerConnection("postgres://app_runtime:password@db.example:5432/postgres")
    ).toThrow(/serverless pooler/);
    expect(
      runtimeRoleFromConnectionUrl(
        "postgres://nox_app_runtime.projectref:password@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"
      )
    ).toBe("nox_app_runtime");
    expect(() =>
      assertExpectedRuntimeRole(
        "postgres://nox_app_runtime.projectref:password@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
        "nox_app_runtime"
      )
    ).not.toThrow();
    expect(() =>
      assertLowPrivilegeRuntimeConnection(
        "postgres://postgres.projectref:password@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"
      )
    ).toThrow(/low-privilege/);
  });

  it("rejects an environment identity that conflicts with Vercel deployment metadata", () => {
    expect(() =>
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "production"
      })
    ).toThrow(/Conflicting Vercel deployment identity/);
    expect(() =>
      serverIdentity({
        NOX_ENV: "production",
        VERCEL_ENV: "preview"
      })
    ).toThrow(/Conflicting Vercel deployment identity/);
    expect(() =>
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "preview"
      })
    ).toThrow(/Conflicting Vercel deployment identity/);
    expect(() =>
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview"
      })
    ).toThrow(/Conflicting Vercel target deployment identity/);
    expect(
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "staging"
      })
    ).toMatchObject({ environment: "staging" });
    expect(
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "preview",
        NOX_STAGING_BRANCH: "release/staging",
        VERCEL_GIT_COMMIT_REF: "release/staging"
      })
    ).toMatchObject({ environment: "staging" });
    expect(() =>
      serverIdentity({
        NOX_ENV: "staging",
        VERCEL_ENV: "preview",
        NOX_STAGING_BRANCH: "release/staging",
        VERCEL_GIT_COMMIT_REF: "feature/untrusted"
      })
    ).toThrow(/Conflicting Vercel deployment identity/);
  });

  it("redacts nested secret-shaped observability details before they reach a log sink", () => {
    expect(
      redactDetails({
        request: {
          authorization: "Bearer server-secret",
          nested: [{ cloudflare_api_token: "server-token" }]
        }
      })
    ).toEqual({
      request: {
        authorization: "[REDACTED]",
        nested: [{ cloudflare_api_token: "[REDACTED]" }]
      }
    });
  });

  it("validates Turnstile server-side against hostname and action", async () => {
    const request: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          hostname: "app.example.invalid",
          action: "foundation-probe"
        })
      );

    await expect(
      verifyTurnstile(
        {
          secret: "server-secret",
          token: "token",
          expectedHostname: "app.example.invalid",
          expectedAction: "foundation-probe"
        },
        request
      )
    ).resolves.toEqual({ valid: true });
  });

  it("does not treat object path as storage authorization", async () => {
    const storage = new SupabasePrivateFileStore({
      url: "https://example.supabase.co",
      serviceRoleKey: "server-only",
      bucket: "nox-private"
    });
    const reference = {
      id: "file_1",
      scope: "TENANT" as const,
      tenantId: "tenant-a",
      checksum: "abc",
      mimeType: "text/plain",
      purpose: "diagnostic",
      classification: "internal",
      storagePath: "tenant/tenant-a/file_1"
    };

    await expect(
      storage.stat(reference, {
        actor: { id: "actor-b", type: "USER" },
        tenant: { id: "tenant-b" },
        allowedPurposes: ["diagnostic"]
      })
    ).rejects.toThrow(/Tenant scope is not authorized/);

    await expect(
      storage.createDownloadGrant(
        {
          ...reference,
          storagePath: "tenant/tenant-b/secret"
        },
        {
          actor: { id: "actor-a", type: "USER" },
          tenant: { id: "tenant-a" },
          allowedPurposes: ["diagnostic"]
        }
      )
    ).rejects.toThrow(/Storage path does not match/);
  });

  it("requires a concrete tenant identity before deriving a tenant storage path", async () => {
    const storage = new SupabasePrivateFileStore({
      url: "https://example.supabase.co",
      serviceRoleKey: "server-only",
      bucket: "nox-private"
    });

    await expect(
      storage.put(
        {
          scope: "TENANT",
          checksum: "abc",
          mimeType: "text/plain",
          purpose: "diagnostic",
          classification: "internal"
        },
        new Uint8Array([1]),
        {
          actor: { id: "actor-a", type: "USER" },
          allowedPurposes: ["diagnostic"]
        }
      )
    ).rejects.toThrow(/explicit tenant identity/);

    await expect(
      storage.put(
        {
          scope: "GLOBAL",
          tenantId: "tenant-a",
          checksum: "abc",
          mimeType: "text/plain",
          purpose: "diagnostic",
          classification: "internal"
        },
        new Uint8Array([1]),
        {
          actor: { id: "actor-a", type: "USER" },
          allowedPurposes: ["diagnostic"]
        }
      )
    ).rejects.toThrow(/cannot contain a tenant identity/);
  });

  it("requires workflow authority to be revalidated before consequential work", async () => {
    await expect(
      requireCurrentWorkflowAuthority(
        {
          workflowId: "workflow_1",
          scope: { type: "TENANT", tenantId: "tenant-a" },
          actor: { type: "USER", id: "actor-a" },
          correlationId: "corr_1",
          idempotencyKey: "idempotency_1"
        },
        {
          async revalidate() {
            return false;
          }
        }
      )
    ).rejects.toThrow(/revalidated/);
    await expect(noAccessAdmission.admits({})).resolves.toBe(false);
  });
});
