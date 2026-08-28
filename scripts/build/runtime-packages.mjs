import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";
import fg from "fast-glob";

const entryPoints = fg.sync(["packages/*/src/index.ts", "packages/*/src/index.tsx"], {
  onlyFiles: true
});

if (entryPoints.length === 0) {
  throw new Error("No workspace package entry points were found.");
}

await Promise.all(
  entryPoints.map(async (entryPoint) => {
    const outputFile = entryPoint.replace(/\/src\/index\.tsx?$/, "/dist/index.js");
    await mkdir(dirname(outputFile), { recursive: true });
    await build({
      entryPoints: [entryPoint],
      outfile: outputFile,
      bundle: false,
      format: "esm",
      jsx: "automatic",
      logLevel: "warning",
      platform: "neutral",
      sourcemap: true,
      target: "es2024",
      tsconfig: "tsconfig.json"
    });
  })
);

console.log(`RUNTIME_PACKAGE_BUILD=PASS packages=${entryPoints.length}`);
