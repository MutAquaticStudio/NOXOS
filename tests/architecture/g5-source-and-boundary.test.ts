import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = JSON.parse(readFileSync("contracts/g5-sources.json", "utf8")) as {
  masterPrompt: {
    sha256: string;
    version: string;
    beginMarker: string;
    endMarker: string;
    endOfFile: boolean;
  };
  g4AcceptedBaselineSha: string;
};
const migration = readFileSync("supabase/migrations/20260831190719_g5_trial_sensory.sql", "utf8");
describe("Gate 5 source and bounded-context architecture", () => {
  it("binds implementation to the complete G5 source and frozen G4 baseline", () => {
    expect(sources.masterPrompt).toEqual({
      sha256: "a5affa7196f9b1b8ea3eaf07f76ac837180a31dd4458ffe1e91ab7a1203cbc5c",
      version: "1.2-COMPLETE",
      beginMarker: "G5_MASTER_PROMPT_BEGIN",
      endMarker: "G5_MASTER_PROMPT_END",
      endOfFile: true
    });
    expect(sources.g4AcceptedBaselineSha).toBe("0ee63471a47653bb77d419b224219f7ee393208f");
  });

  it("owns exactly four G5 tables and no forbidden material scoring or workflow tables", () => {
    const tables = [...migration.matchAll(/create\s+table\s+trial_sensory\.([a-z_]+)/gi)].map(
      (match) => match[1]
    );
    expect(tables).toEqual(["trials", "trial_lines", "sensory_evaluations", "sensory_deltas"]);
    expect(migration).not.toMatch(
      /create\s+table\s+trial_sensory\.(material_sensory_scores|sensory_predictions|revision_jobs|approval_records|formula_copies)/i
    );
    expect(migration).not.toMatch(/sensory_deltas[\s\S]{0,900}\bmaterial_id\b/i);
  });

  it("keeps dependency direction inward: G5 consumes G4 while G4 never imports G5", () => {
    const trialApplication = readFileSync("packages/trial-sensory/src/application.ts", "utf8");
    const designApi = readFileSync("packages/design-studio/src/api.ts", "utf8");
    expect(trialApplication).toContain('from "@nox-os/design-studio"');
    expect(designApi).not.toContain("@nox-os/trial-sensory");
    expect(designApi).toContain("FormulaApprovalEvidenceReader");
    expect(designApi).toContain("FormulaRevisionContextReader");
  });
});
