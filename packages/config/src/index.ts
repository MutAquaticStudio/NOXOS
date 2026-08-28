import { z } from "zod";
import type { NoxEnvironment } from "@nox-os/contracts";

const environmentSchema = z.enum(["preview", "staging", "production", "development", "test"]);

const publicEnvironmentSchema = z.object({
  VITE_NOX_ENV: environmentSchema.optional(),
  VITE_NOX_SOURCE_SHA: z.string().min(1).max(128).optional(),
  VITE_TURNSTILE_SITE_KEY: z.string().min(1).optional()
});

const serverIdentitySchema = z.object({
  NOX_ENV: environmentSchema.optional(),
  VERCEL_ENV: z.enum(["preview", "production", "development"]).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).max(128).optional()
});

export type PublicEnvironment = {
  environment: NoxEnvironment;
  sourceSha: string;
  turnstileSiteKey?: string;
};

export type ServerIdentity = {
  environment: NoxEnvironment;
  sourceSha: string;
};

export function publicEnvironment(raw: Record<string, string | undefined>): PublicEnvironment {
  const parsed = publicEnvironmentSchema.parse(raw);

  return {
    environment: parsed.VITE_NOX_ENV ?? "development",
    sourceSha: parsed.VITE_NOX_SOURCE_SHA ?? "local",
    turnstileSiteKey: parsed.VITE_TURNSTILE_SITE_KEY
  };
}

export function serverIdentity(raw: Record<string, string | undefined>): ServerIdentity {
  const parsed = serverIdentitySchema.parse(raw);
  const environment =
    parsed.NOX_ENV ??
    (parsed.VERCEL_ENV === "production" ? "production" : undefined) ??
    (parsed.VERCEL_ENV === "preview" ? "preview" : undefined) ??
    "development";

  return {
    environment,
    sourceSha: parsed.VERCEL_GIT_COMMIT_SHA ?? "local"
  };
}

export function assertNoPublicSecrets(raw: Record<string, string | undefined>): void {
  const forbidden = Object.keys(raw).filter((key) => {
    const upper = key.toUpperCase();
    return (
      key.startsWith("VITE_") &&
      (upper.includes("SECRET") ||
        upper.includes("DATABASE") ||
        upper.includes("SERVICE_ROLE") ||
        upper.includes("PRIVATE_KEY"))
    );
  });

  if (forbidden.length > 0) {
    throw new Error(
      "Public Vite environment contains forbidden sensitive keys: " + forbidden.join(", ")
    );
  }
}

export function requiredServerValue(raw: Record<string, string | undefined>, key: string): string {
  const value = raw[key];
  if (!value) {
    throw new Error("Missing required server-only environment variable: " + key);
  }
  return value;
}
