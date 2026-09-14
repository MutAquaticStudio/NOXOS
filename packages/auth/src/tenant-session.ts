import { sessionSecretDigest, verifySessionSecret } from "./session-crypto.js";
import type { SessionDigestKey, StoredSessionDigest } from "./session-crypto.js";
import { assertTenantSessionCurrent, readSessionCookie } from "./session-fence.js";
import type { CurrentTenantAuthority, TenantSessionState } from "./session-fence.js";
import { assertMutationOrigin } from "./session-fence.js";
import { verifyTenantCsrfProof } from "./session-csrf.js";

export type CurrentSessionRecord = Readonly<{
  session: TenantSessionState;
  secret: StoredSessionDigest;
  authority: CurrentTenantAuthority;
}>;

/** G2-owned persistence. Must read exact host, binding, actor, tenant and epochs
 * afresh, not synthesize authority from headers/provider metadata. Query by digest,
 * never raw secret. Writes need their own commit fence in the same transaction.
 */
export interface TenantSessionRepository {
  readCurrent(
    input: Readonly<{ host: string; digests: readonly StoredSessionDigest[] }>
  ): Promise<readonly CurrentSessionRecord[]>;
}

/** Identity/CSRF entry fence only. Business authorization and commit-time
 * epoch/guard checks remain mandatory in the consuming command transaction.
 */
export async function authenticateTenantMutation(
  input: Parameters<typeof authenticateTenantSession>[0] &
    Readonly<{
      method: string;
      origin: string | undefined;
      fetchSite: string | undefined;
      csrfProof: string | undefined;
    }>,
  dependencies: Parameters<typeof authenticateTenantSession>[1]
): Promise<TenantSessionContext | null> {
  try {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(input.method)) return null;
    assertMutationOrigin(input.exactRequestHost, input.origin, input.fetchSite);
    const context = await authenticateTenantSession(input, dependencies);
    if (!context) return null;
    return dependencies.keys.some((key) => verifyTenantCsrfProof(input.csrfProof, context, key))
      ? context
      : null;
  } catch {
    return null;
  }
}

export type TenantSessionContext = Readonly<{
  sessionId: string;
  actorId: string;
  tenantId: string;
  issuedHost: string;
  routingVersion: number;
  authorizationEpoch: string;
  assurance: string;
}>;

/** Server entry: opaque cookie is the only accepted credential. This is identity
 * and session validation, not business permission/field authorization.
 * Missing persistence/key/edge integration must never fall back to legacy JWT auth.
 */
export async function authenticateTenantSession(
  input: Readonly<{ cookieHeader: string | undefined; exactRequestHost: string }>,
  dependencies: Readonly<{
    environment: "staging" | "production";
    keys: readonly SessionDigestKey[];
    repository: TenantSessionRepository;
    now: () => number;
  }>
): Promise<TenantSessionContext | null> {
  const secret = readSessionCookie(input.cookieHeader);
  if (!secret || dependencies.keys.length === 0) return null;
  try {
    if (
      dependencies.keys.some((key) => key.environment !== dependencies.environment) ||
      new Set(dependencies.keys.map((key) => key.version)).size !== dependencies.keys.length
    )
      return null;
    const digests = dependencies.keys.map((key) => sessionSecretDigest(secret, key));
    const records = await dependencies.repository.readCurrent({
      host: input.exactRequestHost,
      digests
    });
    if (records.length !== 1) return null;
    const record = records[0]!;
    const key = dependencies.keys.find(
      (candidate) => candidate.version === record.secret.keyVersion
    );
    if (
      !key ||
      !verifySessionSecret(secret, record.secret, key) ||
      record.authority.host !== input.exactRequestHost
    )
      return null;
    assertTenantSessionCurrent(record.session, record.authority, dependencies.now());
    return Object.freeze({
      sessionId: record.session.id,
      actorId: record.authority.actorId,
      tenantId: record.authority.tenantId,
      issuedHost: record.authority.host,
      routingVersion: record.authority.routingVersion,
      authorizationEpoch: record.authority.authorizationEpoch,
      assurance: record.session.assurance
    });
  } catch {
    // Public failure is deliberately uniform. Dependency readiness has a separate operator path.
    return null;
  }
}
