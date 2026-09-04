import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contracts = readFileSync("packages/lab-services/src/contracts.ts", "utf8");
const persistence = readFileSync("packages/lab-services/src/persistence.ts", "utf8");
const apiRoute = readFileSync("apps/nox-os/api/v1/[...route].ts", "utf8");

describe("Gate 11 cross-gate handoff", () => {
  it("exposes dependency-neutral G12 and G13 sources with stable identities", () => {
    expect(persistence).toContain("export interface LabServiceOrderSource");
    expect(persistence).toContain("export interface CustomerDirectorySource");
    expect(contracts).toContain("serviceOrderId: string");
    expect(contracts).toContain("customerId: string");
    expect(contracts).toContain("pinnedContact");
  });

  it("does not depend on or instantiate G4/G10 truth", () => {
    expect(persistence).not.toMatch(/@nox-os\/(?:design-studio|quality-control|production)/);
    expect(apiRoute).toContain("new PostgresLabServicesStore(runtimeDatabase)");
    expect(apiRoute).not.toMatch(/LabServicesApplication\([^)]*BatchReleaseSource/);
  });

  it("contains no pricing, invoice, payment, fulfillment, or project model", () => {
    expect(contracts).not.toMatch(
      /\b(?:price|quote|invoice|payment|shipment|fulfillment|projectId|briefId)\b/i
    );
  });
});
