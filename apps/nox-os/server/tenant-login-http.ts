import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  sessionCookie,
  assertMutationOrigin,
  frameDigestPayload
} from "@nox-os/auth/server-session";

type LoginFields = Readonly<Record<string, string | null>>;
type StartResult = { flowId: string; secret: string; expiresAt: number };
type CompleteResult =
  | { kind: "ISSUED"; secret: string; absoluteExpiresAt: number }
  | { kind: "DENIED" | "PENDING_RECONCILIATION" | "STEP_UP_REQUIRED" | "ORIGINAL_RESULT" };

/** Installed server coordinator must enforce digests, abuse policy and persisted
 * flow/provider identity. This transport never resolves roles or tenant headers.
 */
export interface TenantLoginService {
  isActiveTenantHost(host: string): Promise<boolean>;
  start(input: {
    host: string;
    fields: LoginFields;
    cookieHeader: string | undefined;
  }): Promise<StartResult>;
  complete(input: {
    host: string;
    fields: LoginFields;
    cookieHeader: string | undefined;
  }): Promise<CompleteResult>;
}

const policy = "FIPS202-SHA3-256-DOMAIN-SEPARATED-V1";
const startFields = [
  "identifier",
  "providerMethod",
  "returnTo",
  "clientFlowNonce",
  "requestDigest",
  "digestPolicyVersion"
];
const completeFields = [
  "flowId",
  "identifier",
  "password",
  "operationKey",
  "requestDigest",
  "digestPolicyVersion"
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const opaque = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const invalid = () => {
  throw Error("INVALID_LOGIN_REQUEST");
};

/** Auth requests here are flat string/null objects, not arbitrary JSON payloads.
 * Decode each key before duplicate detection, including escaped key aliases.
 */
function decodeFields(text: string, allowed: readonly string[]): Record<string, string | null> {
  let cursor = 0;
  const values: Record<string, string | null> = Object.create(null);
  const whitespace = () => {
    while (/[\t\r\n ]/.test(text[cursor] ?? "x")) cursor++;
  };
  function string(): string {
    const match = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(
      text.slice(cursor)
    );
    if (!match) return invalid();
    cursor += match[0].length;
    const value = JSON.parse(match[0]) as string;
    if (!value.isWellFormed()) return invalid();
    return value;
  }
  whitespace();
  if (text[cursor++] !== "{") return invalid();
  whitespace();
  if (text[cursor] !== "}")
    while (true) {
      const key = string();
      if (!allowed.includes(key) || Object.hasOwn(values, key)) return invalid();
      whitespace();
      if (text[cursor++] !== ":") return invalid();
      whitespace();
      if (text.slice(cursor, cursor + 4) === "null") {
        values[key] = null;
        cursor += 4;
      } else values[key] = string();
      whitespace();
      if (text[cursor] !== ",") break;
      cursor++;
      whitespace();
    }
  if (text[cursor++] !== "}") return invalid();
  whitespace();
  if (cursor !== text.length) return invalid();
  return values;
}

async function boundedBody(request: Request): Promise<string> {
  const limit = 16384;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit))
    return invalid();
  if (!request.body) return invalid();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return invalid();
      }
      chunks.push(part.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    reader.releaseLock();
  }
}

function schema(
  fields: Record<string, string | null>,
  start: boolean,
  returnPaths: readonly string[]
) {
  if (
    fields.digestPolicyVersion !== policy ||
    !/^[a-f0-9]{64}$/.test(fields.requestDigest ?? "") ||
    typeof fields.identifier !== "string" ||
    fields.identifier.length < 3 ||
    fields.identifier.length > 320
  )
    return invalid();
  if (start) {
    if (
      !opaque.test(fields.clientFlowNonce ?? "") ||
      (fields.providerMethod !== undefined && fields.providerMethod !== "PASSWORD") ||
      (fields.returnTo !== undefined &&
        fields.returnTo !== null &&
        !returnPaths.includes(fields.returnTo))
    )
      return invalid();
  } else if (
    !uuid.test(fields.flowId ?? "") ||
    !opaque.test(fields.operationKey ?? "") ||
    typeof fields.password !== "string" ||
    fields.password.length < 1 ||
    fields.password.length > 4096
  )
    return invalid();
  const material = start
    ? {
        clientFlowNonce: fields.clientFlowNonce,
        digestPolicyVersion: policy,
        identifier: fields.identifier,
        providerMethod: fields.providerMethod ?? "PASSWORD",
        returnTo: fields.returnTo ?? null
      }
    : {
        digestPolicyVersion: policy,
        flowId: fields.flowId,
        identifier: fields.identifier,
        operationKey: fields.operationKey
      };
  // Explicit sorted flat schema; passwords and cookie bearer values never enter
  // a canonical payload. Client nonce/operation key are idempotency inputs only.
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(material).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  );
  const expected = createHash("sha3-256")
    .update(
      frameDigestPayload(
        start ? "tenant-login-start" : "tenant-login-complete",
        Buffer.from(canonical, "utf8")
      )
    )
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(fields.requestDigest!, "hex"))) return invalid();
  return Object.freeze(fields);
}

/** Explicit AUTH-001/002 HTTP transport; no legacy bearer or development fallback. */
export function createTenantLoginHttp(options: {
  service: TenantLoginService;
  returnPaths: readonly string[];
  now?: () => number;
}) {
  if (
    !options.returnPaths.length ||
    options.returnPaths.some((path) => !/^\/[^/\\?#]*$/.test(path))
  )
    throw Error("INVALID_LOGIN_RETURN_CONFIGURATION");
  const now = options.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    function reply(status: number, value: Record<string, unknown>, cookies: string[] = []) {
      const headers = new Headers({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, private",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId
      });
      for (const cookie of cookies) headers.append("set-cookie", cookie);
      return new Response(JSON.stringify(value), { status, headers });
    }
    const denied = () =>
      reply(400, {
        error: { code: "AUTH_REQUEST_DENIED", message: "Unable to complete sign in.", requestId }
      });
    try {
      const url = new URL(request.url),
        host = url.host;
      const start = url.pathname === "/api/auth/tenant/login/start";
      if (!start && url.pathname !== "/api/auth/tenant/login/complete") return denied();
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        request.method !== "POST" ||
        (request.headers.has("host") && request.headers.get("host") !== host) ||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          request.headers.get("content-type") ?? ""
        )
      )
        return denied();
      assertMutationOrigin(
        host,
        request.headers.get("origin") ?? undefined,
        request.headers.get("sec-fetch-site") ?? undefined
      );
      // This lookup precedes parsing/identifier access. No header can choose a tenant.
      if (!(await options.service.isActiveTenantHost(host))) return denied();
      const cookieHeader = request.headers.get("cookie") ?? undefined;
      if (!start) {
        const capabilities = (cookieHeader ?? "")
          .split(";")
          .map((part) => part.trim())
          .filter((part) => part.startsWith("__Host-noxos-auth="));
        if (capabilities.length !== 1 || !opaque.test(capabilities[0]!.slice(18))) return denied();
      }
      const fields = schema(
        decodeFields(await boundedBody(request), start ? startFields : completeFields),
        start,
        options.returnPaths
      );
      // Format is not authentication: the coordinator must still verify the
      // keyed digest against this exact unexpired host-bound persisted flow.
      const input = { host, fields, cookieHeader };
      if (start) {
        const result = await options.service.start(input),
          timestamp = now();
        if (
          !uuid.test(result.flowId) ||
          !opaque.test(result.secret) ||
          !Number.isSafeInteger(result.expiresAt) ||
          result.expiresAt <= timestamp ||
          result.expiresAt > timestamp + 900000
        )
          throw Error("INVALID_LOGIN_RESULT");
        return reply(202, { flowId: result.flowId, next: "PASSWORD" }, [
          `__Host-noxos-auth=${result.secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((result.expiresAt - timestamp) / 1000)}`
        ]);
      }
      const result = await options.service.complete(input);
      if (result.kind === "ISSUED")
        return reply(200, { status: "AUTHENTICATED" }, [
          sessionCookie(result.secret, result.absoluteExpiresAt, now()),
          "__Host-noxos-auth=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"
        ]);
      if (result.kind === "DENIED") return denied();
      if (["PENDING_RECONCILIATION", "STEP_UP_REQUIRED", "ORIGINAL_RESULT"].includes(result.kind))
        return reply(202, { status: result.kind });
      throw Error("INVALID_LOGIN_RESULT");
    } catch {
      // Never serialize/log caught provider, SQL, credential or parsing contents.
      return denied();
    }
  };
}
