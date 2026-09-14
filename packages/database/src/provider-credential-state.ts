import type { TransactionSql } from "postgres";

/** Call with the issuer transaction after the exact host, flow-cookie and actor
 * context has been established. No provider HTTP request or network retry here.
 * This checks native credential/session eligibility, not role, risk or permission.
 */
export async function readSupabaseCredentialState(
  tx: TransactionSql,
  flowId: string
): Promise<"CURRENT" | "REVOKED" | "UNKNOWN"> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(flowId))
    throw Error("AUTH_FLOW_UNAVAILABLE");
  const rows = await tx`select platform.read_auth_flow_credential_state(${flowId}::uuid) as state`;
  if (rows.length !== 1 || !["CURRENT", "REVOKED", "UNKNOWN"].includes(rows[0]!.state))
    throw Error("AUTH_CURRENT_AUTHORITY_UNAVAILABLE");
  return rows[0]!.state;
}
