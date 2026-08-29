import { describe, expect, it } from "vitest";
import { resolvePreviewBrowserContract } from "../../scripts/verify/preview-browser-contract.mjs";

describe("trusted Preview browser contract", () => {
  it("recognizes only the explicitly accepted legacy and authenticated contracts", () => {
    expect(
      resolvePreviewBrowserContract({
        status: 401,
        body: { error: { code: "AUTH_REQUIRED" } }
      })
    ).toBe("AUTHENTICATED_PLATFORM");
    expect(
      resolvePreviewBrowserContract({
        status: 404,
        body: { error: { code: "NOT_FOUND" } }
      })
    ).toBe("LEGACY_G1_SHELL");
  });

  it("fails closed for a malformed or unexpected protected-route response", () => {
    expect(() =>
      resolvePreviewBrowserContract({ status: 200, body: { user: { id: "unexpected" } } })
    ).toThrow(/neither the legacy G1 shell nor the authenticated Platform Core/);
    expect(() =>
      resolvePreviewBrowserContract({ status: 401, body: { error: { code: "FORBIDDEN" } } })
    ).toThrow(/neither the legacy G1 shell nor the authenticated Platform Core/);
  });
});
