import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const domain = readFileSync("packages/material-intelligence/src/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260829094218_g3_material_intelligence_core.sql",
  "utf8"
);

describe("G3-A Material Intelligence boundaries", () => {
  it("uses the stable Material ID/snapshot handoff and does not create G4/G5 business persistence", () => {
    expect(domain).toContain("MATERIAL_SNAPSHOT_SCHEMA_VERSION");
    expect(domain).toContain("buildMaterialSnapshot");
    const tables = [...migration.matchAll(/create table material_intelligence\.([a-z_]+)/gi)].map(
      (match) => match[1]
    );
    expect(tables.join(" ")).not.toMatch(/formula|trial|sensory|inventory|procurement|production/i);
    expect(domain).not.toMatch(/@nox-os\/(inventory|scientific)/);
  });

  it("does not introduce generic material history, event sourcing, queues, or external search", () => {
    expect(migration).not.toMatch(
      /create table material_intelligence\.(material_(versions|history|snapshots|events)|audit)/i
    );
    expect(domain).not.toMatch(
      /(algolia|elasticsearch|typesense|meilisearch|redis|queue|event.?store)/i
    );
  });
});
