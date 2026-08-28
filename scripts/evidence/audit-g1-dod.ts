import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const groups = [
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
] as const;

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required for the Gate 1 DoD audit.");
  }
  return value;
}

function fullSha(raw: Record<string, string | undefined>): string {
  const value = required(raw, "EXPECTED_STAGING_SHA").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("EXPECTED_STAGING_SHA must be a full Git commit SHA.");
  }
  return value;
}

export function createG1DodAudit(raw: Record<string, string | undefined>) {
  const sourceSha = fullSha(raw);
  const results = Object.fromEntries(
    groups.map((group) => {
      const value = required(raw, "G1_DOD_" + group);
      if (value !== "PASS") {
        throw new Error("G1 DoD group " + group + " is " + value + ", not PASS.");
      }
      return [group, value];
    })
  );
  for (const severity of ["ARCHITECTURE_P0", "ARCHITECTURE_P1", "ARCHITECTURE_P2"] as const) {
    if (required(raw, severity) !== "0") {
      throw new Error(severity + " must equal 0 before G1 freeze.");
    }
  }
  return {
    schemaVersion: "1.0",
    goalId: "NOX-OS-GATE-1-CLOUD-ENGINEERING-FOUNDATION",
    evidenceKind: "G1_DOD_AUDIT",
    sourceSha,
    documentVersion: "1.0",
    gateStatus: "FROZEN",
    definitionOfDone: "PASS",
    g2Ready: "YES",
    productionPromotionPerformed: "NO",
    architecture: { P0: 0, P1: 0, P2: 0 },
    groups: results
  } as const;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const audit = createG1DodAudit(process.env);
  const outputDirectory = process.env.NOX_EVIDENCE_OUTPUT_DIR ?? "artifacts/g1";
  const outputPath = join(outputDirectory, "g1-dod-audit-" + audit.sourceSha + ".json");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(audit, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  console.log("G1_DOD_AUDIT_PATH=" + outputPath);
}
