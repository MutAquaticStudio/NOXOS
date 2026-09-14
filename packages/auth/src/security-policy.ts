const assuranceRanks = new Map<string, number>([
  ["A1", 1],
  ["A2", 2],
  ["PHISHING_RESISTANT", 3]
]);
const timeLimits = {
  idle_seconds: 1800,
  absolute_seconds: 43200,
  step_up_seconds: 300,
  recovery_token_seconds: 900,
  privileged_max_seconds: 1800
} as const;

/** Validate the persisted policy boundary before issuing any session. */
export function resolveLoginPolicy(
  floor: Record<string, unknown>,
  tightening?: Record<string, unknown>
) {
  function validate(policy: Record<string, unknown>) {
    const actions = policy.required_assurance_by_action;
    if (!actions || typeof actions !== "object" || Array.isArray(actions))
      throw Error("AUTH_POLICY_INVALID");
    const ranks = new Map<string, number>();
    for (const [action, assurance] of Object.entries(actions)) {
      const rank = typeof assurance === "string" ? assuranceRanks.get(assurance) : undefined;
      if (!action || rank === undefined) throw Error("AUTH_POLICY_INVALID");
      ranks.set(action, rank);
    }
    if (!ranks.has("TENANT_LOGIN")) throw Error("AUTH_POLICY_INVALID");
    for (const [field, ceiling] of Object.entries(timeLimits)) {
      const value = policy[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > ceiling)
        throw Error("AUTH_POLICY_INVALID");
    }
    if ((policy.idle_seconds as number) > (policy.absolute_seconds as number))
      throw Error("AUTH_POLICY_INVALID");
    const factors = policy.allowed_authenticator_classes;
    if (
      !Array.isArray(factors) ||
      factors.length === 0 ||
      factors.some((value) => typeof value !== "string" || value.trim() !== value || !value) ||
      new Set(factors).size !== factors.length
    )
      throw Error("AUTH_POLICY_INVALID");
    for (const field of ["rate_policy_ref", "detection_policy_ref"])
      if (typeof policy[field] !== "string" || !(policy[field] as string).trim())
        throw Error("AUTH_POLICY_INVALID");
    return { ranks, factors: factors as string[] };
  }
  const base = validate(floor);
  if (tightening) {
    const tenant = validate(tightening);
    for (const [action, rank] of base.ranks)
      if ((tenant.ranks.get(action) ?? 0) < rank) throw Error("AUTH_POLICY_INVALID");
    for (const field of Object.keys(timeLimits))
      if ((tightening[field] as number) > (floor[field] as number))
        throw Error("AUTH_POLICY_INVALID");
    if (tenant.factors.some((factor) => !base.factors.includes(factor)))
      throw Error("AUTH_POLICY_INVALID");
    // References are not ordered policy values. Until their typed resolver proves
    // monotonic tightening, a different reference is unknown, never safer by assumption.
    if (
      tightening.rate_policy_ref !== floor.rate_policy_ref ||
      tightening.detection_policy_ref !== floor.detection_policy_ref
    )
      throw Error("AUTH_POLICY_INVALID");
  }
  const selected = tightening ?? floor;
  return Object.freeze({
    requiredRank: assuranceRanks.get(
      (selected.required_assurance_by_action as Record<string, string>).TENANT_LOGIN
    )!,
    idleSeconds: selected.idle_seconds as number,
    absoluteSeconds: selected.absolute_seconds as number
  });
}
