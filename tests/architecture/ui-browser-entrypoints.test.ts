import { build } from "esbuild";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("UI browser entrypoints — real transitive import boundary", () => {
  it("startup does not eagerly load platform screens through shared API errors", async () => {
    const result = await build({
      entryPoints: ["apps/nox-os/src/app.tsx"],
      bundle: true,
      platform: "browser",
      format: "esm",
      splitting: true,
      outdir: "/tmp/nox-ui-v3-import-check",
      write: false,
      metafile: true,
      minify: true,
      logLevel: "silent"
    });
    const outputs = result.metafile!.outputs;
    const entry = Object.keys(outputs).find(
      (path) => outputs[path]!.entryPoint === "apps/nox-os/src/app.tsx"
    )!;
    const eager = new Set<string>();
    const visit = (path: string) => {
      if (eager.has(path)) return;
      eager.add(path);
      for (const dependency of outputs[path]!.imports) {
        if (dependency.external || dependency.kind === "dynamic-import") continue;
        const target = Object.keys(outputs).find(
          (candidate) => resolve(candidate) === resolve(dependency.path)
        );
        expect(target).toBeDefined();
        visit(target!);
      }
    };
    visit(entry);
    const inputs = [...eager].flatMap((path) => Object.keys(outputs[path]!.inputs));
    expect(inputs).not.toContain("apps/nox-os/src/platform-control.tsx");
    expect(inputs.filter((path) => /packages\/ui\/(src|dist)\//.test(path))).toEqual([]);
    // Public identity is validated by Vite at build time. Startup must not pay
    // for the server/build configuration validators a second time in the browser.
    expect(
      inputs.filter((path) => /(?:packages\/config\/|node_modules\/zod\/)/.test(path))
    ).toEqual([]);
    // Check the screen was deferred, not dropped from the application.
    expect(
      Object.values(outputs).some(
        (output) => "apps/nox-os/src/platform-control.tsx" in output.inputs
      )
    ).toBe(true);
  });
  for (const name of ["design-studio", "trial-sensory"]) {
    it(`${name} bundles without server crypto, domain commands or a polyfill`, async () => {
      const result = await build({
        entryPoints: [`packages/${name}/src/browser.ts`],
        bundle: true,
        platform: "browser",
        format: "esm",
        write: false,
        metafile: true,
        logLevel: "silent"
      });
      const inputs = Object.keys(result.metafile!.inputs);
      expect(inputs.some((path) => path.endsWith("packages/design-studio/src/mass.ts"))).toBe(true);
      expect(inputs).not.toContain("packages/material-intelligence/src/index.ts");
      expect(
        inputs.some((path) =>
          /packages\/design-studio\/src\/(api|freeze|formula|intent|accords|taxonomy)\.ts$/.test(
            path
          )
        )
      ).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.outputFiles[0]!.text).not.toContain("__vite-browser-external");
      const browserModule = await import(
        /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.text).toString("base64")}`
      );
      expect(browserModule.formatMassMg("120001")).toBe("120 g 1 mg");
      expect(browserModule.formatMassMg("1")).toBe("1 mg");
    });
  }
  it("the browser check rejects server crypto rather than replacing or externalizing it", async () => {
    await expect(
      build({
        stdin: { contents: 'export { createHash } from "node:crypto";' },
        bundle: true,
        platform: "browser",
        write: false,
        logLevel: "silent"
      })
    ).rejects.toThrow(/node:crypto/);
  });
});
