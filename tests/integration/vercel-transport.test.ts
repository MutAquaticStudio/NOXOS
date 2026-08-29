import { describe, expect, it } from "vitest";
import { normalizedHeaders, normalizedQuery, routePath } from "../../apps/nox-os/api/_transport";

describe("Vercel API transport", () => {
  it("uses catch-all query metadata when Vercel provides it", () => {
    expect(routePath({ query: { route: ["module", "foundation"] }, url: "/ignored" })).toBe(
      "/module/foundation"
    );
    expect(routePath({ query: { route: "health" }, url: "/ignored" })).toBe("/health");
  });

  it("falls back to the real /api/v1 request URL when rewrite metadata is absent", () => {
    expect(routePath({ query: {}, url: "/api/v1/health" })).toBe("/health");
    expect(routePath({ query: {}, url: "/api/v1/version?probe=true" })).toBe("/version");
    expect(routePath({ query: {}, url: "/api/v1" })).toBe("/");
    expect(routePath({ query: {}, url: "/unrelated" })).toBe("/");
  });

  it("normalizes Node request headers without trusting client authorization metadata", () => {
    expect(
      normalizedHeaders({
        headers: {
          "X-Correlation-ID": "corr_test",
          "x-forwarded-for": ["198.51.100.1", "198.51.100.2"]
        }
      })
    ).toEqual({
      "x-correlation-id": "corr_test",
      "x-forwarded-for": "198.51.100.1,198.51.100.2"
    });
  });

  it("keeps scalar query filters and rejects repeated values at the transport boundary", () => {
    expect(
      normalizedQuery({
        query: { tenantId: "tenant", action: "platform.tenant.create", limit: ["50", "100"] }
      })
    ).toEqual({ tenantId: "tenant", action: "platform.tenant.create", limit: undefined });
  });
});
