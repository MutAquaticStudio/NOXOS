import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Vite public-environment boundary", () => {
  it("fails closed before bundling a server-like VITE variable", () => {
    const result = spawnSync("pnpm", ["--filter", "@nox-os/web", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VITE_NOX_RUNTIME_DATABASE_URL: "unsafe-test-value"
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/forbidden or unapproved keys/i);
  });

  it("rejects arbitrary VITE-prefixed provider credentials before bundling", () => {
    const result = spawnSync("pnpm", ["--filter", "@nox-os/web", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VITE_CLOUDFLARE_API_TOKEN: "unsafe-test-value"
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/VITE_CLOUDFLARE_API_TOKEN/);
  });
});
