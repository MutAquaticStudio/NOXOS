import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ApiRequest } from "@nox-os/contracts";
import { createRequestContext, createFoundationApi } from "@nox-os/platform";
import { UnavailableScientificAdapter } from "@nox-os/scientific";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";

const foundationApi = createFoundationApi({
  modules: moduleDefinitions,
  scientificGateway: new UnavailableScientificAdapter()
});

function routePath(request: VercelRequest): string {
  const route = request.query.route;
  if (Array.isArray(route)) {
    return "/" + route.join("/");
  }
  if (typeof route === "string") {
    return "/" + route;
  }
  return "/";
}

function normalizedHeaders(request: VercelRequest): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : value
    ])
  );
}

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
