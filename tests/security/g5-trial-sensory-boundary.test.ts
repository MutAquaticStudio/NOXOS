import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260831190719_g5_trial_sensory.sql", "utf8");
const hardeningMigration = readFileSync(
  "supabase/migrations/20260831203000_g5_trial_sensory_hardening.sql",
  "utf8"
);
const contracts = readFileSync("packages/trial-sensory/src/contracts.ts", "utf8");
const api = readFileSync("packages/trial-sensory/src/api.ts", "utf8");
const designApi = readFileSync("packages/design-studio/src/api.ts", "utf8");
const designStore = readFileSync("packages/database/src/design-studio-store.ts", "utf8");
const ui = readFileSync("apps/nox-os/src/trial-sensory.tsx", "utf8");

describe("Gate 5 security boundary", () => {
  it("keeps G5 data private, force-RLS, and limited to server runtime DML", () => {
    expect(migration).toContain("revoke all on schema trial_sensory from anon, authenticated");
    expect(migration.match(/force row level security/g)).toHaveLength(4);
    expect(migration).toContain("to nox_app_runtime");
    expect(migration).not.toMatch(/grant[^;]+to\s+(anon|authenticated)/i);
    expect(migration).not.toMatch(/grant[^;]+truncate/i);
    expect(hardeningMigration).toContain("trial_status is distinct from 'PREPARED'");
  });

  it("tenant-scopes reads and derives actor and tenant authority from G2 context", () => {
    expect(api).toContain("context.tenant.tenantId");
    expect(api).toContain("context.actor.userId");
    expect(api).not.toContain("request.body.tenantId");
    expect(api).not.toContain("evaluatedByUserId");
  });

  it("stores only whole-composition taxonomy deltas and exposes no server secrets in UI", () => {
    expect(contracts).not.toMatch(/type SensoryDelta[\s\S]{0,700}\bmaterialId\b/);
    expect(ui).not.toMatch(
      /SERVICE_ROLE|DATABASE_URL|SUPABASE_ACCESS_TOKEN|NOX_RUNTIME_DATABASE_URL/
    );
    expect(ui).toMatch(/no Material score is\s+stored/);
  });

  it("makes evidence-free Formula approval and arbitrary revision freeze fail closed", () => {
    expect(designApi).toContain("APPROVAL_EVIDENCE_REQUIRED");
    expect(designApi).toContain("APPROVAL_EVIDENCE_INVALID");
    expect(designApi).toContain(
      "revisionContext.parentFormulaVersionId !== parentFormulaVersionId"
    );
    expect(designApi).toContain("parentFormulaVersionId,");
    expect(designApi).toContain("sourceEvaluationId: input.sourceEvaluationId");
    expect(designApi).toContain("requireTrialSensoryRevisionAccess(context)");
    expect(designStore).toContain("if (input.parentFormulaVersionId)");
    expect(designStore).not.toContain("where ${input.parentFormulaVersionId ?? null} is not null");
  });

  it("preserves ambient evidence in UI state and locks cancelled Trial drafts", () => {
    expect(ui).toContain("setTemperatureC(payload.evaluation.context.temperatureC ?? null)");
    expect(ui).toContain("setHumidityPct(payload.evaluation.context.humidityPct ?? null)");
    expect(ui).toContain("temperatureC,");
    expect(ui).toContain("humidityPct,");
    expect(ui).toContain('trial.status === "PREPARED"');
    expect(ui).toContain("Draft evidence is locked because the Trial is not PREPARED.");
  });
});
