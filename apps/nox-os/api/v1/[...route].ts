import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ApiRequest } from "@nox-os/contracts";
import { SupabaseAccessTokenVerifier } from "@nox-os/auth";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import {
  createPostgresPlatformStore,
  createPostgresMaterialStore,
  createPostgresDesignStudioStore,
  createPostgresMaterialCandidateRetriever,
  createPostgresTrialSensoryStore,
  createPostgresReleaseReadinessStore,
  createPostgresReleaseReadinessSources,
  PostgresInventoryMaterialSource,
  PostgresInventoryStore,
  PostgresProcurementMaterialSource,
  PostgresProcurementStore,
  PostgresProductionStore,
  PostgresQualityControlStore,
  PostgresLabServicesStore,
  PostgresTrialInventoryPort,
  createRuntimeDatabase,
  probeDatabase
} from "@nox-os/database";
import { createMaterialIntelligenceApi } from "@nox-os/material-intelligence";
import {
  createDesignStudioApi,
  DesignStudioApplication,
  DesignStudioFormulaRevisionPort
} from "@nox-os/design-studio";
import { createTrialSensoryApi, TrialSensoryApplication } from "@nox-os/trial-sensory";
import { createInventoryApi, InventoryApplication } from "@nox-os/inventory";
import { createProcurementApi, ProcurementApplication } from "@nox-os/procurement";
import { createProductionApi, ProductionApplication } from "@nox-os/production";
import { createQualityControlApi, QualityControlApplication } from "@nox-os/quality-control";
import { createLabServicesApi, LabServicesApplication } from "@nox-os/lab-services";
import {
  createReleaseReadinessApi,
  KnownLimitV1Policy,
  ReleaseReadinessApplication
} from "@nox-os/release-readiness";
import { createPlatformCoreApi, createRequestContext, createFoundationApi } from "@nox-os/platform";
import { NoxOeScientificAdapter, UnavailableScientificAdapter } from "@nox-os/scientific";
import { SupabasePrivateFileStore } from "@nox-os/storage";
import { moduleDefinitions } from "../../src/modules/definitions.js";
import { foundationTestModuleDefinition } from "../../src/modules/foundation-test-manifest.js";
import { VercelQueueWorkflowLauncher } from "../../workflows/vercel-queue.js";
import { normalizedHeaders, normalizedQuery, routePath } from "../_transport.js";
import { secretlessPreviewAuthResponse } from "../preview-auth-gate.js";

const diagnosticProbeToken = process.env.NOX_DIAGNOSTIC_PROBE_TOKEN;
const workflowLauncher = diagnosticProbeToken ? new VercelQueueWorkflowLauncher() : undefined;
const runtimeDatabaseUrl = process.env.NOX_RUNTIME_DATABASE_URL;
const runtimeDatabase = runtimeDatabaseUrl
  ? createRuntimeDatabase({
      connectionUrl: runtimeDatabaseUrl,
      applicationName: "nox-os-api",
      expectedRole: "nox_app_runtime"
    })
  : undefined;
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const featureFlags = new LocalFeatureFlagResolver(
  (process.env.NOX_FEATURE_FLAGS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const acceptanceModules =
  process.env.NOX_ENV === "staging" && process.env.NOX_G2_TEST_MODE === "true"
    ? [foundationTestModuleDefinition()]
    : [];
const platformCore =
  runtimeDatabase && supabaseUrl && supabasePublishableKey
    ? createPlatformCoreApi({
        store: createPostgresPlatformStore(runtimeDatabase),
        accessTokenVerifier: new SupabaseAccessTokenVerifier({
          url: supabaseUrl,
          publishableKey: supabasePublishableKey
        }),
        moduleDefinitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const materialIntelligence =
  runtimeDatabase && platformCore
    ? createMaterialIntelligenceApi({
        store: createPostgresMaterialStore(runtimeDatabase),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const privateFileStore =
  supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET
    ? new SupabasePrivateFileStore({
        url: supabaseUrl,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: process.env.SUPABASE_STORAGE_BUCKET
      })
    : undefined;
const designStudioStore = runtimeDatabase
  ? createPostgresDesignStudioStore(runtimeDatabase)
  : undefined;
const designStudioApplication = runtimeDatabase
  ? new DesignStudioApplication(createPostgresMaterialCandidateRetriever(runtimeDatabase))
  : undefined;
const trialSensoryApplication =
  runtimeDatabase && designStudioStore
    ? new TrialSensoryApplication(
        createPostgresTrialSensoryStore(runtimeDatabase),
        designStudioStore,
        new PostgresTrialInventoryPort(runtimeDatabase)
      )
    : undefined;
const inventory =
  runtimeDatabase && platformCore
    ? createInventoryApi({
        application: new InventoryApplication(
          new PostgresInventoryStore(runtimeDatabase),
          new PostgresInventoryMaterialSource(runtimeDatabase)
        ),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const procurement =
  runtimeDatabase && platformCore
    ? createProcurementApi({
        application: new ProcurementApplication(
          new PostgresProcurementStore(runtimeDatabase),
          new PostgresProcurementMaterialSource(runtimeDatabase)
        ),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const production =
  runtimeDatabase && platformCore
    ? createProductionApi({
        application: new ProductionApplication(new PostgresProductionStore(runtimeDatabase)),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const qualityControl =
  runtimeDatabase && platformCore
    ? createQualityControlApi({
        application: new QualityControlApplication(
          new PostgresQualityControlStore(runtimeDatabase)
        ),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const labServices =
  runtimeDatabase && platformCore
    ? createLabServicesApi({
        application: new LabServicesApplication(new PostgresLabServicesStore(runtimeDatabase)),
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const designStudio =
  platformCore && designStudioStore && designStudioApplication
    ? createDesignStudioApi({
        store: designStudioStore,
        application: designStudioApplication,
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags,
        fileStore: privateFileStore,
        approvalEvidenceReader: trialSensoryApplication,
        revisionContextReader: trialSensoryApplication,
        revisionPortFactory: (context) =>
          new DesignStudioFormulaRevisionPort(designStudioApplication, designStudioStore, context)
      })
    : undefined;
const trialSensory =
  platformCore && trialSensoryApplication && designStudioStore && designStudioApplication
    ? createTrialSensoryApi({
        application: trialSensoryApplication,
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags,
        revisionPortFactory: (context) =>
          new DesignStudioFormulaRevisionPort(designStudioApplication, designStudioStore, context)
      })
    : undefined;
const releaseReadinessSources = runtimeDatabase
  ? createPostgresReleaseReadinessSources(runtimeDatabase)
  : undefined;
const releaseReadinessApplication =
  runtimeDatabase && releaseReadinessSources
    ? new ReleaseReadinessApplication(
        createPostgresReleaseReadinessStore(runtimeDatabase),
        releaseReadinessSources,
        releaseReadinessSources,
        releaseReadinessSources,
        new KnownLimitV1Policy()
      )
    : undefined;
const releaseReadiness =
  platformCore && releaseReadinessApplication
    ? createReleaseReadinessApi({
        application: releaseReadinessApplication,
        authorization: platformCore,
        definitions: [...moduleDefinitions, ...acceptanceModules],
        featureFlags
      })
    : undefined;
const scientificGateway =
  process.env.NOX_OE_URL && process.env.NOX_OE_INTERNAL_TOKEN
    ? new NoxOeScientificAdapter({
        endpoint: process.env.NOX_OE_URL,
        internalToken: process.env.NOX_OE_INTERNAL_TOKEN
      })
    : new UnavailableScientificAdapter();

const foundationApi = createFoundationApi({
  modules: moduleDefinitions,
  scientificGateway,
  databaseProbe: runtimeDatabase
    ? () => probeDatabase(runtimeDatabase, "nox_app_runtime")
    : undefined,
  workflowLauncher,
  diagnosticProbeToken,
  platformCore,
  additionalRouteRegistrars: [
    ...(materialIntelligence ? [materialIntelligence] : []),
    ...(designStudio ? [designStudio] : []),
    ...(trialSensory ? [trialSensory] : []),
    ...(releaseReadiness ? [releaseReadiness] : []),
    ...(inventory ? [inventory] : []),
    ...(procurement ? [procurement] : []),
    ...(production ? [production] : []),
    ...(qualityControl ? [qualityControl] : []),
    ...(labServices ? [labServices] : [])
  ],
  // Production release/start are bounded, multi-lot PostgreSQL transactions.
  // Keep the foundation timeout fail-safe while allowing the cloud runtime
  // enough time to complete the atomic G7 reservation/consumption protocol.
  apiTimeoutMs: 30_000
});

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
): Promise<void> {
  const headers = normalizedHeaders(request);
  const apiRequest: ApiRequest = {
    method: request.method ?? "GET",
    path: routePath(request),
    headers,
    query: normalizedQuery(request),
    body: request.body,
    context: createRequestContext(foundationApi.identity, headers)
  };
  const result =
    secretlessPreviewAuthResponse(apiRequest, {
      environment: foundationApi.identity.environment,
      platformCoreConfigured: Boolean(platformCore)
    }) ?? (await foundationApi.dispatch(apiRequest));

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  response.status(result.status).json(result.body);
}
