import { assertNoPublicSecrets } from "@nox-os/config";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  assertNoPublicSecrets(loadEnv(mode, process.cwd(), "VITE_"));

  return {
    plugins: [react()],
    build: {
      sourcemap: true,
      target: "es2024"
    },
    server: {
      port: Number(process.env.PORT ?? 5173)
    }
  };
});
