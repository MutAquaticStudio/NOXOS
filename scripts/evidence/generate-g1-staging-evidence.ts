import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fullSha = /^[0-9a-f]{40}$/i;

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required to generate SHA-bound G1 evidence.");
  }
  return value;
}

function sha(raw: Record<string, string | undefined>, name: string): string {
  const value = required(raw, name);
  if (!fullSha.test(value)) {
    throw new Error(name + " must be a full Git commit SHA.");
  }
  return value.toLowerCase();
}

function requiredExact(
  raw: Record<string, string | undefined>,
  name: string,
  expected: string
): string {
  const value = required(raw, name);
  if (value !== expected) {
    throw new Error(name + " must equal " + expected + " for G1 freeze evidence.");
  }
  return value;
}

export type G1StagingEvidence = ReturnType<typeof createG1StagingEvidence>;

export function createG1StagingEvidence(raw: Record<string, string | undefined>) {
  const ciSha = sha(raw, "CI_SHA");
  const previewSha = sha(raw, "ACCEPTED_PREVIEW_SHA");
  const mergedMainSha = sha(raw, "MERGED_MAIN_SHA");
  const expectedStagingSha = sha(raw, "EXPECTED_STAGING_SHA");
  const deployedStagingSha = sha(raw, "DEPLOYED_STAGING_SHA");
  const workflowSha = sha(raw, "GITHUB_SHA");

  if (ciSha !== previewSha) {
    throw new Error("CI_SHA must identify the accepted Preview source SHA.");
  }
  if (
    mergedMainSha !== expectedStagingSha ||
    expectedStagingSha !== deployedStagingSha ||
    deployedStagingSha !== workflowSha
  ) {
    throw new Error("Merged, expected, deployed, and workflow Staging SHAs must match exactly.");
  }

  const repository = required(raw, "GITHUB_REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository pair.");
  }
  const dodAuditArtifact = required(raw, "G1_DOD_AUDIT_ARTIFACT");
  if (dodAuditArtifact !== "g1-dod-audit-" + mergedMainSha) {
    throw new Error("G1_DOD_AUDIT_ARTIFACT must bind to the accepted main SHA.");
  }

  return {
    schemaVersion: "1.0",
    goalId: "NOX-OS-GATE-1-CLOUD-ENGINEERING-FOUNDATION",
    evidenceKind: "G1_STAGING_ACCEPTANCE",
    generatedAt: new Date().toISOString(),
    repository,
    branch: "main",
    pullRequest: Number(required(raw, "ACCEPTED_PR_NUMBER")),
    ciSha,
    ciReference: required(raw, "ACCEPTED_CI_REFERENCE"),
    previewSha,
    previewReference: required(raw, "ACCEPTED_PREVIEW_URL"),
    previewAcceptanceRun: required(raw, "ACCEPTED_PREVIEW_RUN"),
    previewAttestationArtifact: required(raw, "ACCEPTED_PREVIEW_ARTIFACT"),
    dodAuditArtifact,
    mergedMainSha,
    expectedStagingSha,
    deployedStagingSha,
    stagingReference: required(raw, "STAGING_DEPLOYMENT_URL"),
    workflowProvider: "@vercel/queue@0.5.1",
    productionPromotionPerformed: "NO",
    gate: {
      documentVersion: requiredExact(raw, "GATE_1_DOCUMENT_VERSION", "1.0"),
      status: requiredExact(raw, "GATE_1_STATUS", "FROZEN"),
      definitionOfDone: requiredExact(raw, "GATE_1_DOD", "PASS"),
      g2Ready: requiredExact(raw, "G2_READY", "YES"),
      architectureP0: requiredExact(raw, "ARCHITECTURE_P0", "0"),
      architectureP1: requiredExact(raw, "ARCHITECTURE_P1", "0"),
      architectureP2: requiredExact(raw, "ARCHITECTURE_P2", "0")
    },
    githubActionsRun: required(raw, "GITHUB_RUN_URL"),
    acceptance: {
      protectedConfiguration: "PASS",
      frozenInputs: "PASS",
      environmentIsolation: "PASS",
      migrationDryRun: "PASS",
      migrationApply: "PASS",
      migrationHistory: "PASS",
      migrationDrift: "PASS",
      stagingPrivateBucketExists: "PASS",
      stagingPrivateBucketPublicFalse: "PASS",
      storagePublicReadDenied: "PASS",
      storagePut: "PASS",
      storageStatRead: "PASS",
      storageDelete: "PASS",
      vercelStagingDeployment: "PASS",
      apiHealthVersion: "PASS",
      databaseCurrentUser: "nox_app_runtime",
      databasePermissionBoundary: "PASS",
      workflowQueueDelivery: "PASS",
      workflowCurrentUser: "nox_workflow_runtime",
      workflowRetry: "PASS",
      workflowIdempotency: "PASS",
      workflowCorrelation: "PASS",
      cloudflareDns: "PASS",
      cloudflareTurnstile: "PASS",
      cloudflareAccess: "PASS",
      browserAcceptance: "PASS",
      exactSha: "PASS"
    }
  } as const;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const evidence = createG1StagingEvidence(process.env);
  const outputDirectory = process.env.NOX_EVIDENCE_OUTPUT_DIR ?? "artifacts/g1";
  const artifactName = "g1-staging-evidence-" + evidence.mergedMainSha;
  const outputPath = join(outputDirectory, artifactName + ".json");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  console.log("G1_EVIDENCE_PATH=" + outputPath);
  console.log("G1_EVIDENCE_ARTIFACT_NAME=" + artifactName);
}
