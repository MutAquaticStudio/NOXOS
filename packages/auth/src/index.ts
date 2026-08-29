import type { ActorContext, RequestContext } from "@nox-os/contracts";

export type AuthenticatedIdentity = {
  userId: string;
  email?: string;
};

export type TokenVerificationResult =
  { kind: "AUTHENTICATED"; identity: AuthenticatedIdentity } | { kind: "AUTH_INVALID" };

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<TokenVerificationResult>;
}

export interface AuthenticationPort {
  authenticate(context: RequestContext): Promise<ActorContext | undefined>;
}

export const unauthenticated: AuthenticationPort = {
  async authenticate(): Promise<ActorContext | undefined> {
    return undefined;
  }
};

export function readBearerToken(
  headers: Readonly<Record<string, string | undefined>>
): string | undefined {
  const value = headers.authorization;
  if (!value) {
    return undefined;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match?.[1];
}

export type SupabaseAccessTokenVerifierOptions = {
  url: string;
  publishableKey: string;
  request?: typeof fetch;
};

/**
 * Performs an Auth-server verification for every API request. It deliberately
 * does not use user metadata or a locally decoded JWT as authorization input.
 */
export class SupabaseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly request: typeof fetch;
  private readonly endpoint: URL;

  constructor(private readonly options: SupabaseAccessTokenVerifierOptions) {
    this.endpoint = new URL("/auth/v1/user", options.url);
    this.request = options.request ?? fetch;
  }

  async verifyAccessToken(token: string): Promise<TokenVerificationResult> {
    try {
      const response = await this.request(this.endpoint, {
        headers: {
          authorization: "Bearer " + token,
          apikey: this.options.publishableKey
        }
      });
      if (!response.ok) {
        return { kind: "AUTH_INVALID" };
      }
      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !("id" in payload) ||
        typeof payload.id !== "string"
      ) {
        return { kind: "AUTH_INVALID" };
      }
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          payload.id
        )
      ) {
        return { kind: "AUTH_INVALID" };
      }
      const email =
        "email" in payload && typeof payload.email === "string" ? payload.email : undefined;
      return { kind: "AUTHENTICATED", identity: { userId: payload.id, email } };
    } catch {
      return { kind: "AUTH_INVALID" };
    }
  }
}
