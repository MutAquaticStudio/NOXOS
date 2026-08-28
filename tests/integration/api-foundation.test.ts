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

  it("registers module API manifests through the internal transport-neutral router", async () => {
    const api = createFoundationApi({
      modules: moduleDefinitions,
      scientificGateway: new UnavailableScientificAdapter(),
      environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "test-sha" }
    });
    const response = await api.dispatch(request(api, "/materials/foundation"));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ module: "materials", status: "FOUNDATION_ONLY" });
  });
});
