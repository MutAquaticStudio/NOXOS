import { APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES, publicBuildEnvironment } from "@nox-os/config";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const rawEnvironment = { ...process.env, ...loadEnv(mode, process.cwd(), "VITE_") };
  const clientEnvironment = publicBuildEnvironment(rawEnvironment);
  const clientDefinitions: Record<string, string> = {
    "import.meta.env.VITE_NOX_ENV": JSON.stringify(clientEnvironment.environment),
    "import.meta.env.VITE_NOX_SOURCE_SHA": JSON.stringify(clientEnvironment.sourceSha),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(clientEnvironment.supabaseUrl ?? ""),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      clientEnvironment.supabasePublishableKey ?? ""
    )
  };

  return {
    plugins: [react()],
    // Vercel's VITE_VERCEL_* metadata may exist during a build, but only the
    // application-owned, explicitly validated namespace may enter client code.
    // Supabase values use exact compile-time definitions rather than a broad
    // VITE_SUPABASE_* prefix, so a server-only key can never enter the bundle.
    envPrefix: [...APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES],
    define: clientDefinitions,
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
