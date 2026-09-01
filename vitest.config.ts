import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nox-os/auth": source("./packages/auth/src/index.ts"),
      "@nox-os/config": source("./packages/config/src/index.ts"),
      "@nox-os/contracts": source("./packages/contracts/src/index.ts"),
      "@nox-os/database": source("./packages/database/src/index.ts"),
      "@nox-os/design-studio": source("./packages/design-studio/src/index.ts"),
      "@nox-os/design-studio/browser": source("./packages/design-studio/src/browser.ts"),
      "@nox-os/inventory": source("./packages/inventory/src/index.ts"),
      "@nox-os/inventory/browser": source("./packages/inventory/src/browser.ts"),
      "@nox-os/material-intelligence": source("./packages/material-intelligence/src/index.ts"),
      "@nox-os/module-registry": source("./packages/module-registry/src/index.ts"),
      "@nox-os/observability": source("./packages/observability/src/index.ts"),
      "@nox-os/platform": source("./packages/platform/src/index.ts"),
      "@nox-os/release-readiness": source("./packages/release-readiness/src/index.ts"),
      "@nox-os/release-readiness/browser": source("./packages/release-readiness/src/browser.ts"),
      "@nox-os/scientific": source("./packages/scientific/src/index.ts"),
      "@nox-os/shared": source("./packages/shared/src/index.ts"),
      "@nox-os/storage": source("./packages/storage/src/index.ts"),
      "@nox-os/tenancy": source("./packages/tenancy/src/index.ts"),
      "@nox-os/trial-sensory": source("./packages/trial-sensory/src/index.ts"),
      "@nox-os/trial-sensory/browser": source("./packages/trial-sensory/src/browser.ts"),
      "@nox-os/ui": source("./packages/ui/src/index.tsx")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"]
    }
  }
});
