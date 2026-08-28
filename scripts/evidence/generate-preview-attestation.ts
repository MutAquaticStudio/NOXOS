import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVercelDeploymentUrl } from "../verify/vercel-deployment";

const fullSha = /^[0-9a-f]{40}$/i;

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required to create Preview acceptance evidence.");
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

export function previewAttestationArtifactName(sourceSha: string): string {
  if (!fullSha.test(sourceSha)) {
    throw new Error("Preview attestation artifact requires a full Git commit SHA.");
  }
  return "g1-preview-attestation-" + sourceSha.toLowerCase();
}

export function createPreviewAttestation(raw: Record<string, string | undefined>) {
  const sourceSha = sha(raw, "EXPECTED_SOURCE_SHA");
  const pullRequest = Number(required(raw, "GITHUB_PR_NUMBER"));
  if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
    throw new Error("GITHUB_PR_NUMBER must be a positive pull-request number.");
  }
  const repository = required(raw, "GITHUB_REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository pair.");
  }
  const runId = required(raw, "GITHUB_RUN_ID");
  if (!/^\d+$/.test(runId)) {
    throw new Error("GITHUB_RUN_ID must be numeric.");
  }

  return {
    schemaVersion: "1.0",
    evidenceKind: "G1_PREVIEW_ACCEPTANCE",
    repository,
    pullRequest,
    sourceSha,
    previewReference: normalizeVercelDeploymentUrl(required(raw, "PREVIEW_DEPLOY_URL")),
    workflowName: "preview-acceptance",
    workflowRun: "https://github.com/" + repository + "/actions/runs/" + runId,
    checks: {
      providerDeployment: "PASS",
      environmentIsolation: "PASS",
      apiHealthVersion: "PASS",
      browserFoundation: "PASS",
      exactSha: "PASS"
    }
  } as const;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const attestation = createPreviewAttestation(process.env);
  const artifactName = previewAttestationArtifactName(attestation.sourceSha);
  const outputDirectory = process.env.NOX_EVIDENCE_OUTPUT_DIR ?? "artifacts/g1";
  const outputPath = join(outputDirectory, artifactName + ".json");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(attestation, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  console.log("G1_PREVIEW_ATTESTATION_PATH=" + outputPath);
  console.log("G1_PREVIEW_ATTESTATION_ARTIFACT=" + artifactName);
}
