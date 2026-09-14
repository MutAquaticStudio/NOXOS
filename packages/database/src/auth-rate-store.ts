import type { Sql } from "postgres";

type Dimension = "IDENTIFIER" | "NETWORK" | "FLOW" | "SUBJECT";
type Budget = Readonly<{
  dimension: Dimension;
  digest: string;
  limit: number;
  windowSeconds: number;
}>;
export type AuthRateInput = Readonly<{
  environment: "staging" | "production";
  realm: "TENANT" | "PLATFORM";
  policyRef: string;
  keyVersion: string;
  phase: "BEFORE_PROVIDER" | "VERIFIED_SUBJECT";
  budgets: readonly Budget[];
}>;

/** Server-resolved keyed digests and policy only, never raw HTTP data.
 * BEFORE_PROVIDER requires all three independent anonymous budgets. The second
 * phase charges the verified provider subject without charging the first three twice.
 * Storage/config failure throws: callers must not interpret it as ALLOW.
 */
export function createAuthRateStore(sql: Sql) {
  return {
    async consume(input: AuthRateInput): Promise<"ALLOW" | "THROTTLED"> {
      const expected =
        input.phase === "BEFORE_PROVIDER"
          ? ["FLOW", "IDENTIFIER", "NETWORK"]
          : input.phase === "VERIFIED_SUBJECT"
            ? ["SUBJECT"]
            : [];
      const budgets = [...input.budgets].sort((a, b) =>
        a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0
      );
      if (
        !expected.length ||
        !["staging", "production"].includes(input.environment) ||
        !["TENANT", "PLATFORM"].includes(input.realm) ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(input.policyRef) ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(input.keyVersion) ||
        budgets.map((b) => b.dimension).join() !== expected.join() ||
        budgets.some(
          (b) =>
            !/^[a-f0-9]{64}$/.test(b.digest) ||
            !Number.isSafeInteger(b.limit) ||
            b.limit < 1 ||
            b.limit > 1000000 ||
            !Number.isSafeInteger(b.windowSeconds) ||
            b.windowSeconds < 1 ||
            b.windowSeconds > 3600
        )
      )
        throw Error("AUTH_RATE_CONFIGURATION_UNAVAILABLE");
      return sql.begin(async (tx) => {
        await tx`select set_config('nox.environment',${input.environment},true),
          set_config('nox.auth_rate_realm',${input.realm},true),
          set_config('nox.auth_rate_policy',${input.policyRef},true),
          set_config('nox.auth_rate_key',${input.keyVersion},true),
          set_config('nox.auth_rate_digests',${budgets.map((b) => b.digest).join(",")},true),
          set_config('lock_timeout','2s',true),set_config('statement_timeout','5s',true)`;
        let allowed = true;
        // Stable order, atomic ON CONFLICT, and no early return: every independent
        // budget is charged even when another is already exhausted.
        for (const b of budgets) {
          const rows = await tx`insert into nox_foundation.auth_rate_bucket as bucket
            (environment,realm,policy_ref,key_version,dimension,subject_digest,window_seconds,
             attempt_limit,attempts,window_started_at,expires_at)
            values (${input.environment},${input.realm},${input.policyRef},${input.keyVersion},${b.dimension},
              ${b.digest},${b.windowSeconds},${b.limit},1,statement_timestamp(),
              statement_timestamp()+${b.windowSeconds}*interval '1 second')
            on conflict (environment,realm,policy_ref,key_version,dimension,subject_digest)
            do update set attempts=case when bucket.expires_at<=statement_timestamp() then 1
                else least(bucket.attempts+1,bucket.attempt_limit+1) end,
              window_started_at=case when bucket.expires_at<=statement_timestamp() then statement_timestamp()
                else bucket.window_started_at end,
              expires_at=case when bucket.expires_at<=statement_timestamp()
                then statement_timestamp()+bucket.window_seconds*interval '1 second' else bucket.expires_at end
            returning attempts,attempt_limit,window_seconds`;
          const row = rows[0];
          if (
            rows.length !== 1 ||
            row!.attempt_limit !== b.limit ||
            row!.window_seconds !== b.windowSeconds
          )
            throw Error("AUTH_RATE_POLICY_CONFLICT");
          allowed = allowed && row!.attempts <= row!.attempt_limit;
        }
        // Retain expired blind indexes for at most the cleanup backlog, never
        // extend active windows by retrying. No account/session tables are touched.
        await tx`delete from nox_foundation.auth_rate_bucket
          where expires_at < statement_timestamp()-interval '24 hours' and ctid in (
          select ctid from nox_foundation.auth_rate_bucket
          where expires_at < statement_timestamp()-interval '24 hours'
          order by expires_at limit 32)`;
        return allowed ? "ALLOW" : "THROTTLED";
      });
    }
  };
}
