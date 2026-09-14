type Environment = "staging" | "production";
const projects: Record<Environment, string> = {
  staging: "uyfddpmbszjkhdkqvncz",
  production: "soioshmcdwxhlgrjzkoc"
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_PROVIDER_RESULT");
  return value as RecordValue;
}

export type PasswordVerification =
  | {
      kind: "VERIFIED";
      providerKey: "supabase";
      issuer: string;
      subject: string;
      providerSessionId: string;
      assurance: "A1";
      environment: Environment;
      verifiedAt: number;
    }
  | { kind: "DENIED" }
  | { kind: "PENDING_RECONCILIATION" };

/** Server-only password verification. No membership, application session or credential custody.
 * The flow coordinator must serialize attempts and never retry a completed provider effect.
 */
export function createSupabasePasswordAdapter(options: {
  environment: Environment;
  url: string;
  publishableKey: string;
  request?: typeof fetch;
  now?: () => number;
}) {
  const project = projects[options.environment];
  if (
    !project ||
    options.url !== `https://${project}.supabase.co` ||
    !options.publishableKey.startsWith("sb_publishable_") ||
    /\s/.test(options.publishableKey)
  ) {
    throw Error("INVALID_AUTH_PROVIDER_CONFIGURATION");
  }
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  const issuer = `${options.url}/auth/v1`;
  return {
    async verifyPassword(input: {
      identifier: string;
      password: string;
    }): Promise<PasswordVerification> {
      if (
        typeof input.identifier !== "string" ||
        input.identifier.length < 3 ||
        input.identifier.length > 320 ||
        typeof input.password !== "string" ||
        input.password.length === 0 ||
        input.password.length > 4096
      )
        return { kind: "DENIED" };
      // One deadline covers token verification and native server-side getUser.
      const signal = AbortSignal.timeout(10_000);
      try {
        const response = await request(`${issuer}/token?grant_type=password`, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: { apikey: options.publishableKey, "content-type": "application/json" },
          body: JSON.stringify({ email: input.identifier, password: input.password })
        });
        if (!response.ok) {
          // Do not parse/log provider error bodies or reveal whether the account exists.
          return { kind: response.status >= 500 ? "PENDING_RECONCILIATION" : "DENIED" };
        }
        const payload = record(await response.json());
        const accessToken = payload.access_token;
        if (
          typeof accessToken !== "string" ||
          accessToken.length > 16384 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
        )
          return { kind: "DENIED" };
        // Parsing is only an additional constraint. The native Auth server below
        // verifies the assertion; a locally decoded JWT is never identity proof.
        const claims = record(
          JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8"))
        );
        const time = now();
        if (
          claims.iss !== issuer ||
          claims.aud !== "authenticated" ||
          typeof claims.sub !== "string" ||
          !uuid.test(claims.sub) ||
          typeof claims.session_id !== "string" ||
          !uuid.test(claims.session_id) ||
          claims.aal !== "aal1" ||
          typeof claims.exp !== "number" ||
          !Number.isSafeInteger(claims.exp) ||
          claims.exp * 1000 <= time ||
          typeof claims.iat !== "number" ||
          !Number.isSafeInteger(claims.iat) ||
          claims.iat * 1000 > time ||
          claims.iat >= claims.exp
        )
          return { kind: "DENIED" };
        const verified = await request(`${issuer}/user`, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: { apikey: options.publishableKey, authorization: `Bearer ${accessToken}` }
        });
        if (!verified.ok)
          return { kind: verified.status >= 500 ? "PENDING_RECONCILIATION" : "DENIED" };
        const user = record(await verified.json());
        if (
          user.id !== claims.sub ||
          user.is_anonymous !== false ||
          typeof user.email_confirmed_at !== "string" ||
          !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
          claims.exp * 1000 <= now()
        )
          return { kind: "DENIED" };
        // Deliberately discard refresh/access tokens and all provider metadata.
        // Required assurance, host, realm and binding are rechecked by G2 at commit.
        return {
          kind: "VERIFIED",
          providerKey: "supabase",
          issuer,
          subject: claims.sub,
          providerSessionId: claims.session_id,
          assurance: "A1",
          environment: options.environment,
          verifiedAt: now()
        };
      } catch {
        // A timeout may occur after the provider has performed its effect.
        return { kind: "PENDING_RECONCILIATION" };
      }
    }
  };
}
