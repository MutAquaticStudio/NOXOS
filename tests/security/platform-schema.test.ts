import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260829025350_g2_platform_core_foundation.sql",
  "utf8"
);

describe("G2-A private Platform schema", () => {
  it("creates exactly the five approved Platform Core tables", () => {
    expect([...migration.matchAll(/create table platform\./g)]).toHaveLength(5);
    expect(migration).toMatch(/create table platform\.platform_users/);
    expect(migration).toMatch(/create table platform\.tenants/);
    expect(migration).toMatch(/create table platform\.tenant_memberships/);
    expect(migration).toMatch(/create table platform\.tenant_entitlements/);
    expect(migration).toMatch(/create table platform\.audit_events/);
    expect(migration).not.toMatch(
      /create table platform\.(roles|permissions|groups|teams|sessions|settings|plans|subscriptions)/
    );
  });

  it("keeps Platform private and makes audit append-only for the application role", () => {
    expect(migration).toMatch(/revoke all on schema platform from anon, authenticated/);
    expect(migration).toMatch(/grant usage on schema platform to nox_app_runtime/);
    expect(migration).toMatch(/grant select, insert on platform\.audit_events to nox_app_runtime/);
    expect(migration).not.toMatch(/grant[^\n]*update[^\n]*platform\.audit_events/i);
    expect(migration).not.toMatch(/grant[^\n]*delete[^\n]*platform\.audit_events/i);
    expect(migration).not.toMatch(/nox_workflow_runtime[^\n]*platform\./i);
  });
});
