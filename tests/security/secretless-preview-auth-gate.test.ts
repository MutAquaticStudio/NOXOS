import { describe, expect, it } from "vitest";
import type { ApiRequest } from "@nox-os/contracts";
import {
  isPlatformCoreRoute,
  secretlessPreviewAuthResponse
} from "../../apps/nox-os/api/preview-auth-gate";

function request(path: string, authorization?: string): ApiRequest {
  return {
    method: "GET",
    path,
    headers: { authorization },
    context: {
      requestId: "req_preview",
      correlationId: "corr_preview",
      environment: "preview",
      sourceSha: "preview-sha"
    }
  };
}

describe("secretless Preview Platform Core guard", () => {
  it("recognizes the complete G2 Platform Core API surface without guarding foundation health", () => {
    expect(isPlatformCoreRoute("/me")).toBe(true);
    expect(isPlatformCoreRoute("/tenant/entitlements")).toBe(true);
    expect(isPlatformCoreRoute("/platform/tenants/tenant-1/members/user-1")).toBe(true);
    expect(
      isPlatformCoreRoute("/platform/tenants/tenant-1/entitlements/module.foundation-test")
    ).toBe(true);
    expect(isPlatformCoreRoute("/platform/audit")).toBe(true);
    expect(isPlatformCoreRoute("/health")).toBe(false);
    expect(isPlatformCoreRoute("/version")).toBe(false);
  });

  it("fails closed before data access when Preview has no platform runtime configuration", () => {
    const required = secretlessPreviewAuthResponse(request("/me"), {
      environment: "preview",
      platformCoreConfigured: false
    });
    expect(required).toMatchObject({ status: 401, body: { error: { code: "AUTH_REQUIRED" } } });

    const invalid = secretlessPreviewAuthResponse(request("/me", "Bearer supplied-token"), {
      environment: "preview",
      platformCoreConfigured: false
    });
    expect(invalid).toMatchObject({ status: 401, body: { error: { code: "AUTH_INVALID" } } });
  });

  it("does not replace the configured runtime or a non-Preview environment", () => {
    expect(
      secretlessPreviewAuthResponse(request("/me"), {
        environment: "staging",
        platformCoreConfigured: false
      })
    ).toBeUndefined();
    expect(
      secretlessPreviewAuthResponse(request("/me"), {
        environment: "preview",
        platformCoreConfigured: true
      })
    ).toBeUndefined();
  });
});
