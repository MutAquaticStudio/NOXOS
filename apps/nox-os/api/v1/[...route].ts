import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ApiRequest } from "@nox-os/contracts";
import { createRuntimeDatabase, probeDatabase } from "@nox-os/database";
import { createRequestContext, createFoundationApi } from "@nox-os/platform";
import { UnavailableScientificAdapter } from "@nox-os/scientific";
import { moduleDefinitions } from "../../src/modules/definitions.js";
import { VercelQueueWorkflowLauncher } from "../../workflows/vercel-queue.js";
import { normalizedHeaders, routePath } from "../_transport.js";

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

const foundationApi = createFoundationApi({
  modules: moduleDefinitions,
  scientificGateway: new UnavailableScientificAdapter(),
  databaseProbe: runtimeDatabase
    ? () => probeDatabase(runtimeDatabase, "nox_app_runtime")
    : undefined,
  workflowLauncher,
  diagnosticProbeToken
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
    body: request.body,
    context: createRequestContext(foundationApi.identity, headers)
  };
  const result = await foundationApi.dispatch(apiRequest);

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  response.status(result.status).json(result.body);
}
