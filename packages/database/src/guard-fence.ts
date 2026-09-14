import type { TransactionSql } from "postgres";

export type GuardRequirement = Readonly<{
  scope: "TENANT" | "PLATFORM";
  tenantId: string | null;
  ownerGate: string;
  objectType: string;
  objectId: string;
  mode: "SHARED" | "EXCLUSIVE";
}>;

function tuple(value: GuardRequirement): string[] {
  if (
    !value ||
    !["SHARED", "EXCLUSIVE"].includes(value.mode) ||
    !/^G([0-9]|1[0-5])$/.test(value.ownerGate) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(value.objectType) ||
    typeof value.objectId !== "string" ||
    value.objectId.length < 1 ||
    value.objectId.length > 128 ||
    (value.scope === "TENANT"
      ? typeof value.tenantId !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.tenantId)
      : value.scope !== "PLATFORM" || value.tenantId !== null)
  ) {
    throw new Error("INVALID_GUARD_REQUIREMENT");
  }
  return [value.scope, value.tenantId ?? "", value.ownerGate, value.objectType, value.objectId];
}

export function orderedGuardRequirements(
  input: readonly GuardRequirement[]
): readonly GuardRequirement[] {
  const unique = new Map<string, GuardRequirement>();
  for (const value of input) {
    const key = JSON.stringify(tuple(value));
    const previous = unique.get(key);
    unique.set(
      key,
      Object.freeze({ ...value, mode: previous?.mode === "EXCLUSIVE" ? "EXCLUSIVE" : value.mode })
    );
  }
  return Object.freeze(
    [...unique.values()].sort((left, right) => {
      const a = tuple(left);
      const b = tuple(right);
      for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]!) return -1;
        if (a[i]! > b[i]!) return 1;
      }
      return 0;
    })
  );
}

/** Call once, after claiming operation identity, inside the owning transaction.
 * Provision guards with aggregates, never here. Keep this handle for owner validation,
 * writes, audit/outbox and result. No external calls or late lock-set append.
 */
export async function acquireGuardFences(tx: TransactionSql, input: readonly GuardRequirement[]) {
  const result: Array<Readonly<{ requirement: GuardRequirement; epoch: string }>> = [];
  for (const requirement of orderedGuardRequirements(input)) {
    const { scope, tenantId, ownerGate, objectType, objectId } = requirement;
    const rows =
      requirement.mode === "EXCLUSIVE"
        ? await tx`select epoch::text from nox_foundation.guard_fence
          where scope=${scope} and tenant_id is not distinct from ${tenantId}::uuid
            and owner_gate=${ownerGate} and object_type=${objectType} and object_id=${objectId} for update`
        : await tx`select epoch::text from nox_foundation.guard_fence
          where scope=${scope} and tenant_id is not distinct from ${tenantId}::uuid
            and owner_gate=${ownerGate} and object_type=${objectType} and object_id=${objectId} for share`;
    if (
      rows.length !== 1 ||
      typeof rows[0]?.epoch !== "string" ||
      !/^[1-9][0-9]*$/.test(rows[0].epoch)
    ) {
      throw new Error("UNKNOWN_REQUIRED_GUARD");
    }
    result.push(Object.freeze({ requirement, epoch: rows[0].epoch }));
  }
  return Object.freeze(result);
}
