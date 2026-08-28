import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const requiredConfiguration = {
  GITHUB_VAR__SUPABASE_STAGING_PROJECT_REF: "uyfddpmbszjkhdkqvncz",
  GITHUB_VAR__SUPABASE_PRODUCTION_PROJECT_REF: "soioshmcdwxhlgrjzkoc",
  GITHUB_VAR__SUPABASE_STAGING_URL: "https://uyfddpmbszjkhdkqvncz.supabase.co",
  GITHUB_VAR__SUPABASE_STAGING_STORAGE_BUCKET: "nox-os-private",
  GITHUB_VAR__VERCEL_ORG_ID: "team_nox",
  GITHUB_VAR__VERCEL_PROJECT_ID: "prj_FPN9pBNMfvE7pQC9scA9j9HwzQpx",
  GITHUB_VAR__CF_ZONE_ID: "zone-id",
  GITHUB_VAR__CF_ACCOUNT_ID: "account-id",
  GITHUB_VAR__NOX_PUBLIC_APP_HOSTNAME: "app.example.com",
  GITHUB_VAR__VERCEL_PUBLIC_CNAME_TARGET: "cname.vercel-dns.com",
  GITHUB_VAR__CF_PRIVILEGED_PROXY_APPROVED: "true",
  GITHUB_VAR__NOX_OPS_HOSTNAME: "ops.example.com",
  GITHUB_VAR__CF_PRIVILEGED_CNAME_TARGET: "ops.vercel.app",
  GITHUB_VAR__CF_ACCESS_IDENTITY_GROUP_ID: "group-id",
  GITHUB_VAR__VITE_TURNSTILE_SITE_KEY: "site-key",
  GITHUB_SECRET__FROZEN_G0_ARCHITECTURE_GZIP_BASE64: "encrypted-g0",
  GITHUB_SECRET__FROZEN_UXUI_GUIDELINE_GZIP_BASE64: "encrypted-ux",
  GITHUB_SECRET__NOX_RUNTIME_DATABASE_URL: "runtime-url",
  GITHUB_SECRET__NOX_WORKFLOW_DATABASE_URL: "workflow-url",
  GITHUB_SECRET__SUPABASE_SERVICE_ROLE_KEY: "service-role",
  GITHUB_SECRET__SUPABASE_ACCESS_TOKEN: "access-token",
  GITHUB_SECRET__SUPABASE_DB_PASSWORD: "db-password",
  GITHUB_SECRET__VERCEL_TOKEN: "vercel-token",
  GITHUB_SECRET__VERCEL_AUTOMATION_BYPASS_SECRET: "bypass",
  GITHUB_SECRET__NOX_DIAGNOSTIC_PROBE_TOKEN: "diagnostic",
  GITHUB_SECRET__CF_API_TOKEN: "cloudflare-token",
  GITHUB_SECRET__TURNSTILE_SECRET_KEY: "turnstile-secret"
} as const;

function run(overrides: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ["scripts/verify/staging-configuration.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...requiredConfiguration, ...overrides }
  });
}

describe("protected Staging configuration contract", () => {
  it("requires no Production credential or Production bucket value", () => {
    const output = run();
    expect(output).toContain("MISSING_GITHUB_ENV_VARS=NONE");
    expect(output).toContain("MISSING_GITHUB_ENV_SECRETS=NONE");
    expect(output).toContain("PROTECTED_STAGING_CONFIGURATION=PASS");
  });

  it("fails closed when Staging and Production project references collide", () => {
    expect(() =>
      run({
        GITHUB_VAR__SUPABASE_PRODUCTION_PROJECT_REF:
          requiredConfiguration.GITHUB_VAR__SUPABASE_STAGING_PROJECT_REF
      })
    ).toThrow();
  });

  it("fails closed when either project reference drifts from its canonical resource", () => {
    expect(() => run({ GITHUB_VAR__SUPABASE_STAGING_PROJECT_REF: "aaaaaaaaaaaaaaaaaaaa" })).toThrow(
      /unexpected Supabase project/
    );
    expect(() =>
      run({ GITHUB_VAR__SUPABASE_PRODUCTION_PROJECT_REF: "bbbbbbbbbbbbbbbbbbbb" })
    ).toThrow(/canonical isolation reference/);
  });
});
