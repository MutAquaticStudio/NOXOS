import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel protection-bypass clients", () => {
  it("does not ask Node fetch to set a bypass cookie it cannot retain", () => {
    const probe = readFileSync("scripts/verify/staging.mjs", "utf8");

    expect(probe).toContain('"x-vercel-protection-bypass": protectionBypass');
    expect(probe).not.toContain("x-vercel-set-bypass-cookie");
  });

  it("retains the bypass-cookie request for browser navigation", () => {
    const browserProbe = readFileSync("scripts/verify/staging-browser.mjs", "utf8");

    expect(browserProbe).toContain('"x-vercel-protection-bypass": protectionBypass');
    expect(browserProbe).toContain('"x-vercel-set-bypass-cookie": "true"');
  });
});
