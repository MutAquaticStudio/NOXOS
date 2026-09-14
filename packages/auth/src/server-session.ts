// Server-only entry point. Keep Node crypto out of the browser-facing auth root.
export { resolveLoginPolicy } from "./security-policy.js";
export { createSupabasePasswordAdapter } from "./supabase-password.js";
export type { PasswordVerification } from "./supabase-password.js";
export { authenticateTenantSession, authenticateTenantMutation } from "./tenant-session.js";
export { tenantCsrfProof, verifyTenantCsrfProof } from "./session-csrf.js";
export type {
  TenantSessionRepository,
  TenantSessionContext,
  CurrentSessionRecord
} from "./tenant-session.js";
export {
  issueSessionSecret,
  sessionSecretDigest,
  verifySessionSecret,
  assertSha3Available,
  frameDigestPayload
} from "./session-crypto.js";
export type { SessionDigestKey, StoredSessionDigest } from "./session-crypto.js";
export {
  sessionCookie,
  clearSessionCookie,
  assertMutationOrigin,
  assertTenantSessionCurrent
} from "./session-fence.js";
export type { TenantSessionState, CurrentTenantAuthority } from "./session-fence.js";
