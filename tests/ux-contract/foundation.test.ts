import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("packages/ui/src/styles.css", "utf8");
const shell = readFileSync("packages/ui/src/index.tsx", "utf8");
const app = readFileSync("apps/nox-os/src/app.tsx", "utf8");

describe("frozen UX/UI foundation", () => {
  it("implements the canonical dark/light tokens, density, and motion boundary", () => {
    for (const token of [
      "--canvas: #07080a",
      "--shell: #0a0c0f",
      "--accent: #8075ff",
      "--canvas: #f5f6f7",
      "--accent: #655be8",
      "data-density",
      "prefers-reduced-motion"
    ]) {
      expect(css).toContain(token);
    }
  });

  it("contains all structural shell surfaces with accessible semantics", () => {
    for (const surface of [
      "nox-system-bar",
      "nox-app-rail",
      "nox-workspace-tabs",
      "nox-inspector",
      "nox-command-center",
      "nox-assist"
    ]) {
      expect(shell).toContain(surface);
    }
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain("aria-label");
    expect(shell).toContain("useShortcut");
  });

  it("projects navigation from the registry and avoids a second ReactBits system", () => {
    expect(app).toContain("projectAppRail");
    expect(shell).toContain("ReactBitsAdapter");
    expect(shell).not.toMatch(/from ["']reactbits/i);
  });

  it("keeps AI proposals confirmable and non-mutating in the foundation", () => {
    expect(shell).toContain("Suggestions remain previewable");
    expect(shell).toContain("confirmation and audit");
    expect(shell).toContain("Business mutation is not implemented in Gate 1.");
  });
});
