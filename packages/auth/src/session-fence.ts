export type TenantSessionState = Readonly<{
  id: string;
  actorKind: string;
  actorId: string;
  tenantId: string | null;
  issuedHost: string;
  routingVersionAtIssue: number | null;
  realm: string;
  mode: string;
  assurance: string;
  credentialEpoch: string;
  authorizationEpoch: string;
  issuedAt: string;
  lastAuthoritativeActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  state: string;
  entityVersion: number;
}>;

/** Load fresh from G2/host registry, never from request JSON, headers or a cached JWT. */
export type CurrentTenantAuthority = Readonly<{
  tenantId: string;
  actorId: string;
  host: string;
  routingVersion: number;
  routeState: string;
  actorState: string;
  tenantState: string;
  bindingState: string;
  credentialEpoch: string;
  authorizationEpoch: string;
}>;

function deny(): never {
  throw new Error("Session access denied.");
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) deny();
  return parsed;
}

function exactHost(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    value.includes(".") &&
    value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

/** Read fence only: MAC verification and a trusted exact-host lookup must precede it.
 * Consequential writes must repeat these checks under the owning transaction locks.
 * ACCOUNT_ONLY is deliberately not business access.
 */
export function assertTenantSessionCurrent(
  session: TenantSessionState,
  current: CurrentTenantAuthority,
  now: number
): void {
  if (
    ![
      session.id,
      session.actorId,
      session.tenantId,
      session.credentialEpoch,
      session.authorizationEpoch
    ].every((value) => typeof value === "string" && value.length > 0) ||
    !Number.isSafeInteger(now) ||
    !exactHost(current.host) ||
    session.state !== "ACTIVE" ||
    session.realm !== "TENANT" ||
    session.actorKind !== "TENANT_USER" ||
    session.mode !== "NORMAL" ||
    !["A1", "A2", "PHISHING_RESISTANT"].includes(session.assurance) ||
    !Number.isSafeInteger(session.entityVersion) ||
    session.entityVersion < 1 ||
    !Number.isSafeInteger(current.routingVersion) ||
    current.routingVersion < 1 ||
    session.actorId !== current.actorId ||
    session.tenantId !== current.tenantId ||
    session.issuedHost !== current.host ||
    session.routingVersionAtIssue !== current.routingVersion ||
    session.credentialEpoch !== current.credentialEpoch ||
    session.authorizationEpoch !== current.authorizationEpoch ||
    [current.routeState, current.actorState, current.tenantState, current.bindingState].some(
      (state) => state !== "ACTIVE"
    )
  )
    deny();
  const issued = instant(session.issuedAt);
  const activity = instant(session.lastAuthoritativeActivityAt);
  const idle = instant(session.idleExpiresAt);
  const absolute = instant(session.absoluteExpiresAt);
  if (issued > activity || activity > now || idle > absolute || now >= idle || now >= absolute)
    deny();
}

const COOKIE_NAME = "__Host-noxos-session";
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Strict";
const SECRET = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  const value = values[0]!.slice(COOKIE_NAME.length + 1);
  return SECRET.test(value) ? value : null;
}

export function sessionCookie(secret: string, absoluteExpiresAt: number, now: number): string {
  if (
    typeof secret !== "string" ||
    !SECRET.test(secret) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(absoluteExpiresAt) ||
    absoluteExpiresAt <= now
  )
    deny();
  const maxAge = Math.floor((absoluteExpiresAt - now) / 1000);
  return `${COOKIE_NAME}=${secret}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`;
}

/** Call only after server-side revocation commits, not instead of revocation. */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** Additional origin fence; does NOT replace session-bound CSRF proof verification. */
export function assertMutationOrigin(
  host: string,
  origin: string | undefined,
  fetchSite: string | undefined
): void {
  if (
    !exactHost(host) ||
    origin !== `https://${host}` ||
    (fetchSite !== undefined && fetchSite !== "same-origin")
  )
    deny();
}
