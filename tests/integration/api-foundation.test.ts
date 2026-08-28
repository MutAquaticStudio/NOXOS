import { describe, expect, it } from "vitest";
import type { ApiRequest } from "@nox-os/contracts";
import { createRequestContext, createFoundationApi } from "@nox-os/platform";
import { UnavailableScientificAdapter } from "@nox-os/scientific";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

function request(api: ReturnType<typeof createFoundationApi>, path: string): ApiRequest {
  const headers = { "x-correlation-id": "corr-test" };
  return {
    method: "GET",
    path,
    headers,
    context: createRequestContext(api.identity, headers)
  };
}

describe("API foundation", () => {
  it("exposes a safe degraded health response when science is unavailable", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "staging", VERCEL_GIT_COMMIT_SHA: "abc123" }
    });
    const response = await api.dispatch(request(api, "/health"));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "DEGRADED",
      environment: "staging",
      sourceSha: "abc123"
    });
    expect(response.headers?.["x-request-id"]).toMatch(/^req_/);
    expect(response.headers?.["x-correlation-id"]).toBe("corr-test");
  });

  it("uses the error envelope without leaking implementation detail", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "preview-sha" }
    });
    const response = await api.dispatch(request(api, "/no-such-route"));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_/) }
    });
    expect(JSON.stringify(response.body)).not.toMatch(/sql|stack|secret/i);
  });

  it("fails closed for module APIs until a request authorizer is connected", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "test-sha" }
    });
    const response = await api.dispatch(request(api, "/materials/foundation"));

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("does not register API routes for disabled modules", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "test-sha" }
    });
    const response = await api.dispatch(request(api, "/inventory/foundation"));

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("registers a module API only behind an explicit request authorizer", async () => {
    const events: Array<{ moduleId?: string; details?: Record<string, unknown> }> = [];
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "test-sha" },
      moduleAuthorizer: {
        async canAccess(_request, descriptor) {
          return descriptor.id === "material-intelligence";
        }
      },
      logSink(event) {
        events.push(event);
      }
    });
    const response = await api.dispatch(request(api, "/materials/foundation"));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ module: "materials", status: "FOUNDATION_ONLY" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      moduleId: "material-intelligence",
      details: { status: 200 }
    });
  });

  it("uses an explicitly deployed source SHA instead of relying on a provider system variable", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: {
        NOX_ENV: "staging",
        NOX_SOURCE_SHA: "deployed-sha",
        VERCEL_GIT_COMMIT_SHA: "provider-sha"
      }
    });
    const response = await api.dispatch(request(api, "/version"));

    expect(response.body).toMatchObject({
      environment: "staging",
      sourceSha: "deployed-sha"
    });
  });

  it("treats a configured runtime database outage as unhealthy without exposing database details", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      databaseProbe: async () => ({ healthy: false }),
      environment: { NOX_ENV: "staging", VERCEL_GIT_COMMIT_SHA: "database-sha" }
    });
    const response = await api.dispatch(request(api, "/health"));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "UNHEALTHY",
      dependencies: { database: "UNAVAILABLE" }
    });
    expect(JSON.stringify(response.body)).not.toMatch(/postgres|connection|password/i);
  });

  it("starts a diagnostic workflow only through its server-side probe token and retains correlation", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "staging", VERCEL_GIT_COMMIT_SHA: "workflow-sha" },
      diagnosticProbeToken: "diagnostic-token",
      workflowLauncher: {
        async start(_workflowType, _input, context) {
          return {
            id: context.workflowId,
            state: "COMPLETED",
            correlationId: context.correlationId
          };
        }
      }
    });
    const denied = await api.dispatch(request(api, "/internal/g1/workflow-probe"));
    expect(denied.status).toBe(404);

    const deniedHeaders = { "x-nox-diagnostic-probe-token": "incorrect-token" };
    const deniedPost = await api.dispatch({
      method: "POST",
      path: "/internal/g1/workflow-probe",
      headers: deniedHeaders,
      context: createRequestContext(api.identity, deniedHeaders)
    });
    expect(deniedPost.status).toBe(403);

    const headers = {
      "x-correlation-id": "workflow-correlation",
      "x-nox-diagnostic-probe-token": "diagnostic-token"
    };
    const authorized = await api.dispatch({
      method: "POST",
      path: "/internal/g1/workflow-probe",
      headers,
      context: createRequestContext(api.identity, headers)
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({ correlationId: "workflow-correlation" });
  });
});
