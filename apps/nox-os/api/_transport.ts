import type { VercelRequest } from "@vercel/node";

const API_PREFIX = "/api/v1";

export function routePath(request: Pick<VercelRequest, "query" | "url">): string {
  const route = request.query.route;
  if (Array.isArray(route)) {
    return "/" + route.join("/");
  }
  if (typeof route === "string" && route.length > 0) {
    return "/" + route;
  }

  const pathname = new URL(request.url ?? "/", "https://nox.invalid").pathname;
  if (pathname === API_PREFIX) {
    return "/";
  }
  if (pathname.startsWith(API_PREFIX + "/")) {
    return pathname.slice(API_PREFIX.length);
  }
  return "/";
}

export function normalizedHeaders(
  request: Pick<VercelRequest, "headers">
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : value
    ])
  );
}
