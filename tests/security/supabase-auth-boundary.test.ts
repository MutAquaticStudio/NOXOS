import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SupabaseAccessTokenVerifier } from "@nox-os/auth";

const validUserId = "00000000-0000-4000-8000-000000000001";

describe("Supabase Auth boundary", () => {
  it("verifies bearer identity with Supabase Auth and never accepts caller-provided roles", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const verifier = new SupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
      request: async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) });
        return Response.json({ id: validUserId, email: "test@example.invalid" });
      }
    });
    await expect(verifier.verifyAccessToken("valid-access-token")).resolves.toEqual({
      kind: "AUTHENTICATED",
      identity: { userId: validUserId, email: "test@example.invalid" }
    });
    expect(calls[0]?.url).toBe("https://project.supabase.co/auth/v1/user");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer valid-access-token");
    expect(calls[0]?.headers.get("apikey")).toBe("sb_publishable_test");
  });

  it("fails closed for invalid Auth payloads and keeps browser code off platform tables", async () => {
    const verifier = new SupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
      request: async () => Response.json({ id: "not-a-uuid", app_metadata: { role: "owner" } })
    });
    await expect(verifier.verifyAccessToken("untrusted-token")).resolves.toEqual({
      kind: "AUTH_INVALID"
    });

    const browserSource = [
      readFileSync("apps/nox-os/src/auth-client.ts", "utf8"),
      readFileSync("apps/nox-os/src/app.tsx", "utf8"),
      readFileSync("apps/nox-os/src/platform-control.tsx", "utf8")
    ].join("\n");
    expect(browserSource).toMatch(/signInWithPassword|getSession|onAuthStateChange|signOut/);
    expect(browserSource).not.toMatch(/\.from\s*\(\s*["']platform["']/);
    expect(browserSource).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
