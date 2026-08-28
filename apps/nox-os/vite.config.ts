import { APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES, assertNoPublicSecrets } from "@nox-os/config";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  assertNoPublicSecrets(loadEnv(mode, process.cwd(), "VITE_"));

  return {
    plugins: [react()],
    // Vercel's VITE_VERCEL_* metadata may exist during a build, but only
    // application-owned, explicitly validated namespaces may enter client code.
    envPrefix: [...APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES],
    build: {
      chunkSizeWarningLimit: 350,
      sourcemap: true,
      target: "es2024"
    },
    server: {
      port: Number(process.env.PORT ?? 5173)
    }
  };
});
