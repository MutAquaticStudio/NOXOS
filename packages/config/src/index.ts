import { z } from "zod";
import type { NoxEnvironment } from "@nox-os/contracts";

const environmentSchema = z.enum(["preview", "staging", "production", "development", "test"]);

const publicEnvironmentSchema = z.object({
  VITE_NOX_ENV: environmentSchema.optional(),
  VITE_NOX_SOURCE_SHA: z.string().min(1).max(128).optional(),
  VITE_TURNSTILE_SITE_KEY: z.string().min(1).optional()
});

const allowedPublicEnvironmentKeys = new Set([
  "VITE_NOX_ENV",
  "VITE_NOX_SOURCE_SHA",
  "VITE_TURNSTILE_SITE_KEY"
]);

export const APPLICATION_PUBLIC_ENVIRONMENT_PREFIXES = ["VITE_NOX_", "VITE_TURNSTILE_"] as const;

const providerPublicSystemMetadataPrefixes = ["VITE_VERCEL_"] as const;

export type ViteEnvironmentKeyClass =
  "APPLICATION_PUBLIC_CONFIG" | "PROVIDER_PUBLIC_SYSTEM_METADATA" | "SERVER_ONLY_OR_UNAPPROVED";

const serverIdentitySchema = z.object({
  NOX_ENV: environmentSchema.optional(),
  NOX_SOURCE_SHA: z.string().min(1).max(128).optional(),
  VERCEL_ENV: z.enum(["preview", "production", "development"]).optional(),
  VERCEL_TARGET_ENV: z.string().min(1).max(128).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).max(128).optional(),
  VERCEL_GIT_COMMIT_REF: z.string().min(1).max(256).optional(),
  NOX_STAGING_BRANCH: z.string().min(1).max(256).optional()
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

  if (parsed.NOX_ENV && parsed.VERCEL_TARGET_ENV && parsed.NOX_ENV !== parsed.VERCEL_TARGET_ENV) {
    throw new Error("Conflicting Vercel target deployment identity.");
  }
  if (parsed.NOX_ENV && parsed.VERCEL_ENV) {
    const customStagingPreview =
      parsed.VERCEL_ENV === "preview" &&
      parsed.NOX_ENV === "staging" &&
      parsed.VERCEL_TARGET_ENV === "staging";
    const approvedStagingBranchPreview =
      parsed.VERCEL_ENV === "preview" &&
      parsed.NOX_ENV === "staging" &&
      !parsed.VERCEL_TARGET_ENV &&
      Boolean(parsed.NOX_STAGING_BRANCH) &&
      parsed.VERCEL_GIT_COMMIT_REF === parsed.NOX_STAGING_BRANCH;
    const identitiesMatch =
      parsed.NOX_ENV === parsed.VERCEL_ENV || customStagingPreview || approvedStagingBranchPreview;
    if (!identitiesMatch) {
      throw new Error("Conflicting Vercel deployment identity.");
    }
  }

  const environment =
    parsed.NOX_ENV ??
    (parsed.VERCEL_ENV === "production" ? "production" : undefined) ??
    (parsed.VERCEL_ENV === "preview" ? "preview" : undefined) ??
    "development";

  return {
    environment,
    sourceSha: parsed.NOX_SOURCE_SHA ?? parsed.VERCEL_GIT_COMMIT_SHA ?? "local"
  };
}

export function classifyViteEnvironmentKey(key: string): ViteEnvironmentKeyClass {
  if (allowedPublicEnvironmentKeys.has(key)) {
    return "APPLICATION_PUBLIC_CONFIG";
  }

  if (providerPublicSystemMetadataPrefixes.some((prefix) => key.startsWith(prefix))) {
    return "PROVIDER_PUBLIC_SYSTEM_METADATA";
  }

  return "SERVER_ONLY_OR_UNAPPROVED";
}

export function assertNoPublicSecrets(raw: Record<string, string | undefined>): void {
  const forbidden = Object.keys(raw).filter(
    (key) =>
      key.startsWith("VITE_") && classifyViteEnvironmentKey(key) === "SERVER_ONLY_OR_UNAPPROVED"
  );

  if (forbidden.length > 0) {
    throw new Error(
      "Public Vite environment contains forbidden or unapproved keys: " + forbidden.join(", ")
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
