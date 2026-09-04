import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260904102903_g11_lab_service_orders_customer_tracking.sql",
  "utf8"
);
const contactCancellationMigration = readFileSync(
  "supabase/migrations/20260904114000_g11_allow_cancel_after_contact_archive.sql",
  "utf8"
);
const store = readFileSync("packages/database/src/lab-services-store.ts", "utf8");
const api = readFileSync("packages/lab-services/src/api.ts", "utf8");

describe("Gate 11 persistence and authority boundaries", () => {
  it("creates exactly five private G11 tables and no downstream truth", () => {
    expect(
      [...migration.matchAll(/create table lab_services\.([a-z_]+)/g)].map((item) => item[1])
    ).toEqual([
      "customers",
      "customer_contacts",
      "service_orders",
      "service_order_lines",
      "customer_interactions"
    ]);
    expect(migration).not.toMatch(
      /create table lab_services\.(?:projects|tasks|milestones|quotes|commercial_orders|sales_orders|invoices|payments|shipments|service_pricing|opportunities|formula_links|trial_links|batch_links)/i
    );
    expect(migration).toContain("force row level security");
    expect(migration).toContain(
      "revoke all on all tables in schema lab_services from public, anon, authenticated"
    );
  });

  it("enforces confirmed scope, contact integrity, append-only interactions, and active-primary uniqueness", () => {
    expect(migration).toContain("customer_contacts_one_active_primary");
    expect(migration).toContain("LAB_SERVICE_ORDER_SCOPE_IMMUTABLE");
    expect(migration).toContain("LAB_SERVICE_ORDER_LINES_REQUIRED");
    expect(migration).toContain("LAB_INTERACTION_ORDER_MISMATCH");
    expect(migration).toContain("customer_interactions_guard");
    expect(migration).toContain("before insert or update on lab_services.customer_contacts");
    expect(store).toContain('owner.status === "ARCHIVED"');
    expect(migration).not.toContain(
      "grant select, insert, update on lab_services.customer_interactions"
    );
  });

  it("keeps archived contact history pinned while allowing an existing order to terminate", () => {
    expect(contactCancellationMigration).toContain(
      "require_active_contact :=\n      new.customer_contact_id is distinct from old.customer_contact_id"
    );
    expect(contactCancellationMigration).toContain(
      "or (old.status = 'DRAFT' and new.status = 'CONFIRMED')"
    );
    expect(contactCancellationMigration).toContain(
      "if require_active_contact and contact_status <> 'ACTIVE'"
    );
    expect(contactCancellationMigration).not.toMatch(
      /new\.status = 'CANCELLED'[\s\S]{0,120}require_active_contact\s*:=\s*true/i
    );
  });

  it("keeps tenant/actor/status server-authoritative and mutates no G3-G10 store", () => {
    expect(api).not.toMatch(/actorUserId:\s*request\.body/);
    expect(api).not.toMatch(/tenantId:\s*request\.body/);
    expect(api).not.toMatch(/status:\s*request\.body/);
    expect(store).not.toMatch(
      /update\s+(?:material_intelligence|design_studio|trial_sensory|release_readiness|inventory|procurement|production|quality_control)\./i
    );
    expect(store).not.toContain("BatchReleaseSource");
  });
});
