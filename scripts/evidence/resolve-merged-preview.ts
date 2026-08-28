import { fileURLToPath } from "node:url";
import { resolveVercelPreview } from "../verify/resolve-vercel-preview";
import { previewAttestationArtifactName } from "./generate-preview-attestation";

type AssociatedPullRequest = {
  number?: number;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  base?: { ref?: string };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
};

type CheckRun = { name?: string; conclusion?: string | null };

type WorkflowRun = {
  id?: number;
  name?: string;
  event?: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  head_repository?: { full_name?: string };
};

type WorkflowArtifact = {
  name?: string;
  expired?: boolean;
  workflow_run?: { id?: number; head_branch?: string; head_sha?: string };
};

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required to resolve accepted Preview evidence.");
  }
  return value;
}

async function github<T>(
  path: string,
  raw: Record<string, string | undefined>,
  request: typeof fetch
): Promise<T> {
  const response = await request("https://api.github.com" + path, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + required(raw, "GITHUB_TOKEN"),
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error("GitHub accepted-Preview lookup failed without exposing provider details.");
  }
  return (await response.json()) as T;
}

async function resolvePreviewAttestation(
  repository: string,
  pullRequest: AssociatedPullRequest,
  previewSha: string,
  raw: Record<string, string | undefined>,
  request: typeof fetch
): Promise<{ runId: number; artifactName: string }> {
  const gitRef = pullRequest.head!.ref!;
  const workflowRuns = await github<{ workflow_runs?: WorkflowRun[] }>(
    "/repos/" +
      repository +
      "/actions/runs?event=pull_request_target&head_sha=" +
      encodeURIComponent(previewSha) +
      "&per_page=100",
    raw,
    request
  );
  const acceptedRuns = workflowRuns.workflow_runs?.filter(
    (run) =>
      run.id &&
      run.name === "preview-acceptance" &&
      run.event === "pull_request_target" &&
      run.conclusion === "success" &&
      run.head_sha === previewSha &&
      run.head_branch === gitRef &&
      run.head_repository?.full_name === repository
  );
  if (acceptedRuns?.length !== 1) {
    throw new Error("Accepted Preview source is missing one successful trusted Preview run.");
  }

  const run = acceptedRuns[0];
  const artifactName = previewAttestationArtifactName(previewSha);
  const artifacts = await github<{ artifacts?: WorkflowArtifact[] }>(
    "/repos/" +
      repository +
      "/actions/artifacts?name=" +
      encodeURIComponent(artifactName) +
      "&per_page=100",
    raw,
    request
  );
  const acceptedArtifacts = artifacts.artifacts?.filter((artifact) => {
    const workflowRun = artifact.workflow_run;
    return (
      artifact.name === artifactName &&
      artifact.expired === false &&
      workflowRun?.id === run.id &&
      workflowRun?.head_sha === previewSha &&
      workflowRun?.head_branch === gitRef
    );
  });
  if (acceptedArtifacts?.length !== 1) {
    throw new Error("Accepted Preview source is missing one valid SHA-bound attestation artifact.");
  }
  return { runId: run.id!, artifactName };
}

export async function resolveMergedPreview(
  raw: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch
): Promise<{
  pullRequest: number;
  previewSha: string;
  previewUrl: string;
  ciReference: string;
  previewAcceptanceRun: string;
  previewAttestationArtifact: string;
}> {
  const repository = required(raw, "GITHUB_REPOSITORY");
  const mergedMainSha = required(raw, "EXPECTED_SOURCE_SHA");
  if (!/^[0-9a-f]{40}$/i.test(mergedMainSha)) {
    throw new Error("EXPECTED_SOURCE_SHA must be a full Git commit SHA.");
  }
  const pullRequests = await github<AssociatedPullRequest[]>(
    "/repos/" + repository + "/commits/" + mergedMainSha + "/pulls?per_page=100",
    raw,
    request
  );
  const matches = pullRequests.filter(
    (candidate) =>
      candidate.merged_at &&
      candidate.merge_commit_sha === mergedMainSha &&
      candidate.base?.ref === "main" &&
      candidate.head?.repo?.full_name === repository &&
      candidate.head.sha &&
      candidate.head.ref &&
      candidate.number
  );
  if (matches.length !== 1) {
    throw new Error(
      "Accepted main SHA must bind to exactly one merged same-repository pull request."
    );
  }
  const pullRequest = matches[0];
  const previewSha = pullRequest.head!.sha!;
  if (!/^[0-9a-f]{40}$/i.test(previewSha)) {
    throw new Error("Associated pull request does not expose a full head SHA.");
  }

  const checks = await github<{ check_runs?: CheckRun[] }>(
    "/repos/" + repository + "/commits/" + previewSha + "/check-runs?filter=latest&per_page=100",
    raw,
    request
  );
  const successful = new Set(
    checks.check_runs
      ?.filter((check) => check.conclusion === "success" && check.name)
      .map((check) => check.name!) ?? []
  );
  const requiredChecks = [
    "foundation",
    "browser-foundation",
    "cloud-migration-replay",
    "verify-provider-preview"
  ];
  if (requiredChecks.some((name) => !successful.has(name))) {
    throw new Error("Accepted Preview source is missing required successful checks.");
  }

  const attestation = await resolvePreviewAttestation(
    repository,
    pullRequest,
    previewSha,
    raw,
    request
  );

  const previewUrl = await resolveVercelPreview(
    {
      ...raw,
      EXPECTED_SOURCE_SHA: previewSha,
      EXPECTED_GIT_REF: pullRequest.head!.ref!,
      EXPECTED_GIT_REPOSITORY: repository
    },
    request
  );
  return {
    pullRequest: pullRequest.number!,
    previewSha,
    previewUrl,
    ciReference: "https://github.com/" + repository + "/commit/" + previewSha + "/checks",
    previewAcceptanceRun: "https://github.com/" + repository + "/actions/runs/" + attestation.runId,
    previewAttestationArtifact: attestation.artifactName
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const evidence = await resolveMergedPreview();
  console.log("ACCEPTED_PR_NUMBER=" + evidence.pullRequest);
  console.log("ACCEPTED_PREVIEW_SHA=" + evidence.previewSha);
  console.log("ACCEPTED_PREVIEW_URL=" + evidence.previewUrl);
  console.log("ACCEPTED_CI_REFERENCE=" + evidence.ciReference);
  console.log("ACCEPTED_PREVIEW_RUN=" + evidence.previewAcceptanceRun);
  console.log("ACCEPTED_PREVIEW_ARTIFACT=" + evidence.previewAttestationArtifact);
}
