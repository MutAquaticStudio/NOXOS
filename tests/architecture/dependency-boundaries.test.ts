import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

function sourceFiles(directory: string): string[] {
  return fg.sync([directory + "/**/*.{ts,tsx}"], { onlyFiles: true });
}

function importsFrom(directory: string): string[] {
  return sourceFiles(directory).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const specifiers: string[] = [];
    const importPattern =
      /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      specifiers.push(match[1]);
    }
    return specifiers;
  });
}

function transitiveDependencies(moduleId: string, visited = new Set<string>()): Set<string> {
  if (visited.has(moduleId)) {
    return visited;
  }
  visited.add(moduleId);
  const definition = moduleDefinitions.find((candidate) => candidate.descriptor.id === moduleId);
  for (const dependency of definition?.descriptor.dependencies ?? []) {
    transitiveDependencies(dependency, visited);
  }
  return visited;
}

describe("dependency architecture", () => {
  it("keeps domain packages independent from UI and provider transports", () => {
    const domainImports = importsFrom("packages/material-intelligence/src");

    expect(domainImports.join("\n")).not.toMatch(/react|vercel|supabase|postgres/i);
  });

  it("keeps the UI independent from database adapters", () => {
    const uiImports = importsFrom("packages/ui/src");

    expect(uiImports).not.toContain("@nox-os/database");
    expect(uiImports).not.toContain("postgres");
  });

  it("keeps the platform independent from feature implementations", () => {
    const platformImports = importsFrom("packages/platform/src");

    expect(platformImports).not.toContain("@nox-os/material-intelligence");
    expect(platformImports).not.toContain("@nox-os/inventory");
    expect(platformImports).not.toContain("@nox-os/procurement");
  });

  it("does not place AI, science, analytics, integration, or Community on an ERP critical path", () => {
    const criticalModules = ["inventory", "procurement", "production", "compliance", "commercial"];
    const forbidden = new Set([
      "scientific",
      "sensory-intelligence",
      "analytics",
      "integration",
      "community",
      "ai"
    ]);

    for (const moduleId of criticalModules) {
      const dependencies = transitiveDependencies(moduleId);
      for (const forbiddenId of forbidden) {
        expect(dependencies).not.toContain(forbiddenId);
      }
    }
  });

  it("prevents Material Intelligence from importing future Inventory implementation", () => {
    expect(importsFrom("packages/material-intelligence/src")).not.toContain("@nox-os/inventory");
  });
});
