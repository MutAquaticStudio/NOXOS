import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("packages/ui/src/styles.css", "utf8");
const tokens = readFileSync("packages/ui/src/tokens.css", "utf8");
const shell = readFileSync("packages/ui/src/index.tsx", "utf8");
const workspaceTabs = readFileSync("packages/ui/src/workspace-tabs.tsx", "utf8");
const app = readFileSync("apps/nox-os/src/app.tsx", "utf8");

describe("frozen UX/UI foundation", () => {
  it("implements the canonical dark/light tokens, density, and motion boundary", () => {
    for (const token of [
      "--nox-bg-canvas: #07080C",
      "--nox-bg-shell: #0A0C12",
      "--nox-action-primary: #8B7CFF",
      "--nox-action-primary-fg: #07080C",
      "--nox-bg-canvas: #F3F4F8",
      "--nox-action-primary: #6653E9",
      "data-density"
    ]) {
      expect(tokens.toLowerCase()).toContain(token.toLowerCase());
    }
    expect(css).toContain("prefers-reduced-motion");
  });

  it("contains all structural shell surfaces with accessible semantics", () => {
    for (const surface of [
      "nox-system-bar",
      "nox-app-rail",
      "nox-workspace-tabs",
      "nox-inspector",
      "nox-command-center",
      "nox-assist-content"
    ]) {
      expect(shell + workspaceTabs).toContain(surface);
    }
    expect(shell).toContain("<WorkspaceTabs");
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
    expect(shell).toContain("No assistant provider is connected");
  });
});
