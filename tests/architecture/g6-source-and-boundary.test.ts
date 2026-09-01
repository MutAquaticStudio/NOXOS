import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const sources = JSON.parse(readFileSync("contracts/g6-sources.json", "utf8")) as {
  masterPrompt: {
    sha256: string;
    version: string;
    beginMarker: string;
    endMarker: string;
    endOfFile: boolean;
  };
  g5AcceptedBaselineSha: string;
};
const migration = readFileSync(
  "supabase/migrations/20260901121537_g6_release_readiness.sql",
  "utf8"
);
const packageSource = fg
  .sync("packages/release-readiness/src/**/*.{ts,tsx}")
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("Gate 6 source and bounded-context architecture", () => {
  it("binds implementation to the complete G6 source and accepted G5 baseline", () => {
    expect(sources).toEqual({
      masterPrompt: {
        sha256: "3a9992733f5dad0ac987de87959e1249ebd7da96c3b6ca3b7cd208b08dec93dc",
        version: "1.0-COMPLETE",
        beginMarker: "G6_MASTER_PROMPT_BEGIN",
        endMarker: "G6_MASTER_PROMPT_END",
        endOfFile: true
      },
      g5AcceptedBaselineSha: "a97befac4415662e906c775338d681741daddcfe"
    });
  });

  it("owns exactly two G6 domain tables without rewriting G3, G4, or G5 tables", () => {
    const tables = [...migration.matchAll(/create\s+table\s+release_readiness\.([a-z_]+)/gi)].map(
      (match) => match[1]
    );
    expect(tables).toEqual(["assessments", "checks"]);
    expect(migration).not.toMatch(
      /(?:alter|create|drop)\s+table\s+(?:material_intelligence|design_studio|trial_sensory)\./i
    );
    expect(migration).not.toMatch(
      /from\s+release_readiness\.assessments[\s\S]{0,240}\bfor\s+(?:update|share)\b/i
    );
  });

  it("keeps G6 policy provider-neutral and prevents upstream package dependency reversal", () => {
    expect(packageSource).not.toMatch(/from\s+["'](?:react|postgres|@vercel\/|@supabase\/)/i);
    for (const directory of ["material-intelligence", "design-studio", "trial-sensory"]) {
      const upstream = fg
        .sync(`packages/${directory}/src/**/*.{ts,tsx}`)
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      expect(upstream).not.toContain("@nox-os/release-readiness");
    }
  });

  it("does not expose ChemicalEntity or accept browser-owned evidence authority", () => {
    expect(packageSource).not.toMatch(/canonicalSmiles|isomericSmiles|InChIKey|molecularFormula/i);
    const api = readFileSync("packages/release-readiness/src/api.ts", "utf8");
    expect(api).toContain("releaseProfileSchema.parse(request.body)");
    expect(api).not.toMatch(/request\.body.*(?:checks|evidenceSnapshot|formulaLines)/s);
  });
});
