import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    target: "es2024"
  },
  server: {
    port: Number(process.env.PORT ?? 5173)
  }
});
