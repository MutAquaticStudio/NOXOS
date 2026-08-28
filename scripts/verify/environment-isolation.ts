import { fileURLToPath } from "node:url";
import {
  assertExpectedRuntimeRole,
  assertServerlessPoolerConnection,
  type RuntimeDatabaseRole
} from "@nox-os/database";

type IsolationMode = "SECRETLESS_PREVIEW" | "CONNECTED_NON_PRODUCTION";

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required to verify non-production resource isolation.");
  }
  return value;
}

function requiredProjectReference(raw: Record<string, string | undefined>, name: string): string {
  const value = required(raw, name);
  if (!/^[a-z0-9]{8,64}$/i.test(value)) {
    throw new Error(name + " must be a Supabase project reference.");
  }
  return value;
}

function assertNoRuntimeCredentials(raw: Record<string, string | undefined>): void {
  const forbidden = [
    "NOX_RUNTIME_DATABASE_URL",
    "NOX_WORKFLOW_DATABASE_URL",
    "NOX_MIGRATION_DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_STORAGE_BUCKET",
    "NOX_WORKFLOW_PROBE_URL",
    "NOX_WORKFLOW_PROBE_TOKEN",
    "NOX_DIAGNOSTIC_PROBE_TOKEN",
    "TURNSTILE_SECRET_KEY",
    "CF_API_TOKEN",
    "VERCEL_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    "FROZEN_G0_ARCHITECTURE_GZIP_BASE64",
    "FROZEN_UXUI_GUIDELINE_GZIP_BASE64"
  ].filter((name) => raw[name]);

  if (forbidden.length > 0) {
    throw new Error(
      "Secretless Preview verification received runtime credentials: " + forbidden.join(", ")
    );
  }
}

function assertSupabaseEndpoint(urlValue: string, projectRef: string): void {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("SUPABASE_URL must be an HTTPS Supabase project endpoint.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname !== projectRef + ".supabase.co"
  ) {
    throw new Error("SUPABASE_URL does not identify the expected non-production project.");
  }
}

function assertRuntimeDatabaseIdentity(
  connectionUrl: string,
  projectRef: string,
  expectedRole: RuntimeDatabaseRole
): void {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new Error("NOX_RUNTIME_DATABASE_URL must be a Postgres connection URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("NOX_RUNTIME_DATABASE_URL must use a Postgres protocol.");
  }

  const isSharedPooler = url.hostname.endsWith(".pooler.supabase.com");
  const poolerUserIdentifiesProject = decodeURIComponent(url.username).endsWith("." + projectRef);

  if (!isSharedPooler || !poolerUserIdentifiesProject) {
    throw new Error(
      "Runtime database URL does not bind its Supavisor identity to the expected non-production project."
    );
  }
  assertServerlessPoolerConnection(connectionUrl);
  assertExpectedRuntimeRole(connectionUrl, expectedRole);
}

function assertConnectedResourceIdentity(raw: Record<string, string | undefined>): void {
  const currentProjectRef = requiredProjectReference(raw, "NOX_CURRENT_DATABASE_RESOURCE");
  const supabaseUrl = required(raw, "SUPABASE_URL");
  const runtimeDatabaseUrl = required(raw, "NOX_RUNTIME_DATABASE_URL");
  const workflowDatabaseUrl = required(raw, "NOX_WORKFLOW_DATABASE_URL");
  required(raw, "SUPABASE_SERVICE_ROLE_KEY");
  const currentStorage = required(raw, "NOX_CURRENT_STORAGE_RESOURCE");
  const configuredStorage = required(raw, "SUPABASE_STORAGE_BUCKET");

  if (currentStorage !== configuredStorage) {
    throw new Error("Configured private storage bucket does not match the Staging bucket.");
  }
  if (runtimeDatabaseUrl === workflowDatabaseUrl) {
    throw new Error("Application and workflow runtimes must use separate database roles.");
  }

  assertSupabaseEndpoint(supabaseUrl, currentProjectRef);
  assertRuntimeDatabaseIdentity(runtimeDatabaseUrl, currentProjectRef, "nox_app_runtime");
  assertRuntimeDatabaseIdentity(workflowDatabaseUrl, currentProjectRef, "nox_workflow_runtime");
}

export function verifyEnvironmentIsolation(
  raw: Record<string, string | undefined> = process.env
): void {
  const environment = required(raw, "NOX_EXPECTED_ENV");
  if (environment !== "preview" && environment !== "staging") {
    throw new Error("Environment isolation verification is only valid for Preview or Staging.");
  }

  const currentDatabase = requiredProjectReference(raw, "NOX_CURRENT_DATABASE_RESOURCE");
  const productionDatabase = requiredProjectReference(raw, "NOX_PRODUCTION_DATABASE_RESOURCE");
  const mode = required(raw, "NOX_ISOLATION_MODE") as IsolationMode;

  if (currentDatabase === productionDatabase) {
    throw new Error("Preview or Staging project reference points to Production.");
  }

  if (environment === "preview" && mode === "SECRETLESS_PREVIEW") {
    assertNoRuntimeCredentials(raw);
  } else if (environment === "staging" && mode === "CONNECTED_NON_PRODUCTION") {
    assertConnectedResourceIdentity(raw);
  } else {
    throw new Error("Isolation mode does not match the requested non-production environment.");
  }

  console.log("NON_PRODUCTION_RESOURCE_ISOLATION=PASS");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyEnvironmentIsolation();
}
