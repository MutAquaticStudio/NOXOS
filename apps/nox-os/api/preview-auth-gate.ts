import type { ApiRequest, ApiResponse } from "@nox-os/contracts";
import { readBearerToken } from "@nox-os/auth";
import { toErrorEnvelope } from "@nox-os/platform";

const platformCoreRoutePatterns = [
  /^\/me(?:\/tenants)?$/,
  /^\/context$/,
  /^\/tenant(?:\/members(?:\/[^/]+)?|\/entitlements)?$/,
  /^\/platform\/users(?:\/[^/]+)?$/,
  /^\/platform\/tenants(?:\/[^/]+(?:\/(?:members|entitlements)(?:\/[^/]+)?)?)?$/,
  /^\/platform\/audit$/
] as const;

export function isPlatformCoreRoute(path: string): boolean {
  return platformCoreRoutePatterns.some((pattern) => pattern.test(path));
}

/**
 * A secretless Preview must never expose an accidental public Platform Core
 * route. It has no runtime database or Supabase server configuration, so it
 * can only establish the transport boundary: missing bearer tokens are 401
 * AUTH_REQUIRED and supplied tokens are fail-closed as AUTH_INVALID.
 */
export function secretlessPreviewAuthResponse(
  request: ApiRequest,
  options: { environment: string | undefined; platformCoreConfigured: boolean }
): ApiResponse | undefined {
  if (
    options.environment !== "preview" ||
    options.platformCoreConfigured ||
    !isPlatformCoreRoute(request.path)
  ) {
    return undefined;
  }

  const hasBearerToken = Boolean(readBearerToken(request.headers));
  return {
    status: 401,
    body: toErrorEnvelope(
      hasBearerToken ? "AUTH_INVALID" : "AUTH_REQUIRED",
      hasBearerToken
        ? "Authentication is invalid in this environment."
        : "Authentication is required.",
      request.context.requestId
    )
  };
}
