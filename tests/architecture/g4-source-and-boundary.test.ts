import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const sources = JSON.parse(readFileSync("contracts/g4-sources.json", "utf8")) as {
  masterBlueprint: { sha256: string; version: string };
  masterPrompt: {
    sha256: string;
    version: string;
    beginMarker: string;
    endMarker: string;
    endOfFile: boolean;
  };
  closurePrompt: {
    sha256: string;
    version: string;
    beginMarker: string;
    endMarker: string;
    endOfFile: boolean;
  };
};
const ui = readFileSync("apps/nox-os/src/design-studio.tsx", "utf8");
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n");

describe("complete Gate 4 source and architecture boundary", () => {
  it("binds implementation to the complete approved source markers", () => {
    expect(sources.masterBlueprint.version).toBe("2.0-FINAL CANONICAL");
    expect(sources.masterBlueprint.sha256).toBe(
      "be765579803248e90b495e7d84e3d9c4f8b049fe44b5371a1fdb68123bfb3bae"
    );
    expect(sources.masterPrompt).toMatchObject({
      version: "2.2-COMPLETE",
      beginMarker: "G4_MASTER_PROMPT_BEGIN",
      endMarker: "G4_MASTER_PROMPT_END",
      endOfFile: true
    });
    expect(sources.masterPrompt.sha256).toBe(
      "a1679b5d7ea291df2b529c10577c25ce9a686f7db83e566a4587ca494a034013"
    );
    expect(sources.closurePrompt).toMatchObject({
      version: "2.3-COMPLETE",
      sha256: "8c47afef52f2bec629a1d7ae382362766c491f8a34d0c84dbc204c49d50fec26",
      beginMarker: "G4_CANONICAL_CLOSURE_PROMPT_BEGIN",
      endMarker: "G4_CANONICAL_CLOSURE_PROMPT_END",
      endOfFile: true
    });
  });

  it("introduces no forbidden speculative G4 persistence tables", () => {
    for (const name of [
      "accords",
      "accord_versions",
      "accord_lines",
      "formula_accords",
      "formula_candidates",
      "source_signals",
      "intent_reviews",
      "generation_attempts",
      "model_registry",
      "feature_registry",
      "media_assets",
      "formula_diffs",
      "mass_units"
    ]) {
      expect(migrations).not.toMatch(
        new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+[^;]*\\b${name}\\b`, "i")
      );
    }
  });

  it("keeps ChemicalEntity and scientific credentials out of the tenant UI", () => {
    expect(ui).not.toMatch(
      /canonicalSmiles|canonical_smiles|InChIKey|chemicalEntityId|chemical_entity_id/
    );
    expect(ui).not.toMatch(/NOX_OE_INTERNAL_TOKEN|DATABASE_URL|SERVICE_ROLE/);
  });

  it("provides keyboard-semantic workflow and warning foundations", () => {
    expect(ui).toContain("What do you want to create?");
    expect(ui).toContain("HUMAN REVIEW REQUIRED");
    expect(ui).toContain('role="alert"');
    expect(ui).toContain('role="status"');
    expect(ui).toContain("Develop This Accord");
    expect(createHash("sha256").update(ui).digest("hex")).toHaveLength(64);
  });
});
