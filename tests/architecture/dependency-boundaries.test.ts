import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

function source(directory: string): string {
  return fg
    .sync([directory + "/**/*.{ts,tsx}"], { onlyFiles: true })
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("dependency architecture", () => {
  it("keeps domain packages independent from UI and provider transports", () => {
    const domain = source("packages/material-intelligence/src");

    expect(domain).not.toMatch(/react|vercel|supabase|window|document/i);
  });

  it("keeps the UI independent from database adapters", () => {
    const ui = source("packages/ui/src");

    expect(ui).not.toContain("@nox-os/database");
    expect(ui).not.toContain("postgres");
  });

  it("keeps the platform independent from feature implementations", () => {
    const platform = source("packages/platform/src");

    expect(platform).not.toContain("@nox-os/material-intelligence");
    expect(platform).not.toContain("@nox-os/inventory");
    expect(platform).not.toContain("@nox-os/procurement");
  });

  it("does not place scientific or community capability on the ERP-critical path", () => {
    const criticalModules = new Set([
      "inventory",
      "procurement",
      "production",
      "compliance",
      "commercial"
    ]);

    for (const definition of moduleDefinitions) {
      if (criticalModules.has(definition.descriptor.id)) {
        expect(definition.descriptor.dependencies).not.toContain("scientific");
        expect(definition.descriptor.dependencies).not.toContain("community");
        expect(definition.descriptor.dependencies).not.toContain("analytics");
        expect(definition.descriptor.dependencies).not.toContain("integration");
      }
    }
  });

  it("prevents Material Intelligence from importing future Inventory implementation", () => {
    expect(source("packages/material-intelligence/src")).not.toContain("@nox-os/inventory");
  });
});
