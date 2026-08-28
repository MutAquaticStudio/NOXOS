import { describe, expect, it } from "vitest";
import { assertNoPublicSecrets } from "@nox-os/config";
import { assertSeparateMigrationConnection } from "@nox-os/database";
import {
  noAccessAdmission,
  requireCurrentWorkflowAuthority,
  verifyTurnstile
} from "@nox-os/platform";
import { SupabasePrivateFileStore } from "@nox-os/storage";

describe("security boundaries", () => {
  it("rejects server-only information in the public Vite environment", () => {
    expect(() =>
      assertNoPublicSecrets({
        VITE_NOX_ENV: "preview",
        VITE_NOX_RUNTIME_DATABASE_URL: "should-never-be-public"
      })
    ).toThrow(/forbidden sensitive keys/i);
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
