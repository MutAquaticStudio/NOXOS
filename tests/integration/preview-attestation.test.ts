import { describe, expect, it } from "vitest";
import {
  createPreviewAttestation,
  previewAttestationArtifactName
} from "../../scripts/evidence/generate-preview-attestation";
import { resolveMergedPreview } from "../../scripts/evidence/resolve-merged-preview";

const previewSha = "a".repeat(40);
const mergedSha = "b".repeat(40);
const repository = "MutAquaticStudio/NOXOS";

async function acceptedPreviewRequest(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/commits/" + mergedSha + "/pulls")) {
    return Response.json([
      {
        number: 5,
        merged_at: "2026-08-29T00:00:00Z",
        merge_commit_sha: mergedSha,
        base: { ref: "main" },
        head: {
          ref: "chore/g1-acceptance-trigger",
          sha: previewSha,
          repo: { full_name: repository }
        }
      }
    ]);
  }
  if (url.pathname.endsWith("/commits/" + previewSha + "/check-runs")) {
    return Response.json({
      check_runs: [
        { name: "foundation", conclusion: "success" },
        { name: "browser-foundation", conclusion: "success" },
        { name: "cloud-migration-replay", conclusion: "success" },
        { name: "verify-provider-preview", conclusion: "success" }
      ]
    });
  }
  if (url.pathname.endsWith("/actions/runs")) {
    return Response.json({
      workflow_runs: [
        {
          id: 42,
          name: "preview-acceptance",
          event: "pull_request_target",
          conclusion: "success",
          head_branch: "chore/g1-acceptance-trigger",
          head_sha: previewSha,
          head_repository: { full_name: repository }
        }
      ]
    });
  }
  if (url.pathname.endsWith("/actions/artifacts")) {
    return Response.json({
      artifacts: [
        {
          name: previewAttestationArtifactName(previewSha),
          expired: false,
          workflow_run: {
            id: 42,
            head_branch: "chore/g1-acceptance-trigger",
            head_sha: previewSha
          }
        }
      ]
    });
  }
  if (url.pathname === "/v6/deployments") {
    return Response.json({
      deployments: [
        {
          projectId: "project_1",
          meta: { githubCommitSha: previewSha },
          target: null,
          readyState: "READY",
          url: "candidate.vercel.app"
        }
      ]
    });
  }
  if (url.pathname === "/v13/deployments/candidate.vercel.app") {
    return Response.json({
      project: { id: "project_1" },
      meta: {
        githubCommitSha: previewSha,
        githubCommitOrg: "MutAquaticStudio",
        githubCommitRepo: "NOXOS",
        githubCommitRef: "chore/g1-acceptance-trigger"
      },
      target: null,
      readyState: "READY",
      url: "candidate.vercel.app"
    });
  }
  throw new Error("Unexpected request: " + url);
}

describe("G1 Preview attestation", () => {
  it("binds the artifact to the exact Preview SHA, PR, provider URL, and workflow run", () => {
    const evidence = createPreviewAttestation({
      EXPECTED_SOURCE_SHA: previewSha,
      PREVIEW_DEPLOY_URL: "https://candidate.vercel.app",
      GITHUB_PR_NUMBER: "5",
      GITHUB_REPOSITORY: repository,
      GITHUB_RUN_ID: "42"
    });

    expect(evidence.sourceSha).toBe(previewSha);
    expect(evidence.pullRequest).toBe(5);
    expect(evidence.workflowRun).toBe("https://github.com/MutAquaticStudio/NOXOS/actions/runs/42");
    expect(previewAttestationArtifactName(previewSha)).toBe("g1-preview-attestation-" + previewSha);
  });

  it("rejects malformed source identity or a non-Vercel Preview URL", () => {
    expect(() => previewAttestationArtifactName("short")).toThrow(/full Git commit SHA/);
    expect(() =>
      createPreviewAttestation({
        EXPECTED_SOURCE_SHA: previewSha,
        PREVIEW_DEPLOY_URL: "https://attacker.example",
        GITHUB_PR_NUMBER: "5",
        GITHUB_REPOSITORY: repository,
        GITHUB_RUN_ID: "42"
      })
    ).toThrow(/Vercel HTTPS deployment URL/);
  });

  it("requires a successful trusted workflow run and its non-expired SHA-bound artifact", async () => {
    const evidence = await resolveMergedPreview(
      {
        GITHUB_REPOSITORY: repository,
        GITHUB_TOKEN: "test-token",
        EXPECTED_SOURCE_SHA: mergedSha,
        VERCEL_TOKEN: "test-token",
        VERCEL_PROJECT_ID: "project_1",
        VERCEL_ORG_ID: "team_1"
      },
      acceptedPreviewRequest as typeof fetch
    );

    expect(evidence.previewSha).toBe(previewSha);
    expect(evidence.previewAcceptanceRun).toBe(
      "https://github.com/MutAquaticStudio/NOXOS/actions/runs/42"
    );
    expect(evidence.previewAttestationArtifact).toBe("g1-preview-attestation-" + previewSha);
  });

  it("fails before a Vercel lookup when trusted Preview evidence is absent", async () => {
    const requests: string[] = [];
    const request = async (input: string | URL | Request) => {
      requests.push(String(input));
      const response = await acceptedPreviewRequest(input);
      if (new URL(String(input)).pathname.endsWith("/actions/runs")) {
        return Response.json({ workflow_runs: [] });
      }
      return response;
    };

    await expect(
      resolveMergedPreview(
        {
          GITHUB_REPOSITORY: repository,
          GITHUB_TOKEN: "test-token",
          EXPECTED_SOURCE_SHA: mergedSha,
          VERCEL_TOKEN: "test-token",
          VERCEL_PROJECT_ID: "project_1"
        },
        request as typeof fetch
      )
    ).rejects.toThrow(/successful trusted Preview run/);
    expect(requests.some((value) => value.includes("/v6/deployments"))).toBe(false);
  });
});
