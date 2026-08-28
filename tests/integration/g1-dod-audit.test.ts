import { describe, expect, it } from "vitest";
import { createG1DodAudit } from "../../scripts/evidence/audit-g1-dod";

const base = {
  EXPECTED_STAGING_SHA: "a".repeat(40),
  ARCHITECTURE_P0: "0",
  ARCHITECTURE_P1: "0",
  ARCHITECTURE_P2: "0"
};

for (const group of [
  "A_FROZEN_INPUTS",
  "B_CLOUD_ONLY",
  "C_REPOSITORY",
  "D_DEPENDENCIES",
  "E_MODULE_SYSTEM",
  "F_ROUTES",
  "G_UXUI",
  "H_WEB",
  "I_API",
  "J_POSTGRES",
  "K_STORAGE",
  "L_WORKFLOW",
  "M_SCIENTIFIC",
  "N_CLOUDFLARE",
  "O_ENVIRONMENT_ISOLATION",
  "P_CICD",
  "Q_SECURITY",
  "R_OBSERVABILITY",
  "S_PREVIEW_ACCEPTANCE",
  "T_STAGING_ACCEPTANCE",
  "U_GATE_HYGIENE"
] as const) {
  Object.assign(base, { ["G1_DOD_" + group]: "PASS" });
}

describe("G1 DoD audit", () => {
  it("records every blocking group independently", () => {
    const audit = createG1DodAudit(base);
    expect(Object.keys(audit.groups)).toHaveLength(21);
    expect(audit.definitionOfDone).toBe("PASS");
  });

  it("fails closed for one non-passing group", () => {
    expect(() => createG1DodAudit({ ...base, G1_DOD_L_WORKFLOW: "NOT_VERIFIABLE" })).toThrow(
      /L_WORKFLOW is NOT_VERIFIABLE/
    );
  });
});
