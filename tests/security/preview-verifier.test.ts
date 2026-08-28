import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertExpectedVercelDeployment,
  type ExpectedVercelDeployment
} from "../../scripts/verify/vercel-deployment";
import {
  authenticatedPreviewUrl,
  readyPreviewDeployment,
  resolveVercelPreview
} from "../../scripts/verify/resolve-vercel-preview";

const expectedPreview: ExpectedVercelDeployment = {
  projectId: "project_1",
  sourceSha: "expected-sha",
  target: "preview",
  token: "protected-token",
  gitSource: {
    organization: "MutAquaticStudio",
    repository: "NOXOS",
    ref: "feature/g1-cloud-foundation"
  }
};

describe("trusted Preview verification", () => {
  it("uses an authenticated provider record with exact Git provenance for the expected source SHA", async () => {
    const previewUrl = await resolveVercelPreview(
      {
        EXPECTED_SOURCE_SHA: "expected-sha",
        EXPECTED_GIT_REPOSITORY: "MutAquaticStudio/NOXOS",
        EXPECTED_GIT_REF: "feature/g1-cloud-foundation",
        VERCEL_PROJECT_ID: "project_1",
        VERCEL_ORG_ID: "team_1",
        VERCEL_TOKEN: "protected-token"
      },
      async (request, options) => {
        const url = new URL(String(request));
        expect(options?.headers).toMatchObject({ authorization: "Bearer protected-token" });
        if (url.pathname === "/v6/deployments") {
          expect(url.hostname).toBe("api.vercel.com");
          expect(url.searchParams.get("projectId")).toBe("project_1");
          expect(url.searchParams.get("meta-githubCommitSha")).toBe("expected-sha");
          expect(url.searchParams.get("teamId")).toBe("team_1");
          return new Response(
            JSON.stringify({
              deployments: [
                {
                  projectId: "project_1",
                  meta: { githubCommitSha: "another-sha" },
                  target: null,
                  readyState: "READY",
                  url: "wrong.vercel.app"
                },
                {
                  projectId: "project_1",
                  meta: { githubCommitSha: "expected-sha" },
                  target: "staging",
                  readyState: "READY",
                  url: "staging.vercel.app"
                },
                {
                  projectId: "project_1",
                  meta: { githubCommitSha: "expected-sha" },
                  target: null,
                  readyState: "READY",
                  url: "candidate.vercel.app"
                }
              ]
            })
          );
        }
        expect(url.pathname).toBe("/v13/deployments/candidate.vercel.app");
        expect(url.searchParams.get("withGitRepoInfo")).toBe("true");
        expect(url.searchParams.get("teamId")).toBe("team_1");
        return new Response(
          JSON.stringify({
            project: { id: "project_1" },
            meta: {
              githubCommitSha: "expected-sha",
              githubCommitOrg: "MutAquaticStudio",
              githubCommitRepo: "NOXOS",
              githubCommitRef: "feature/g1-cloud-foundation"
            },
            target: null,
            readyState: "READY",
            url: "candidate.vercel.app"
          })
        );
      }
    );

    expect(previewUrl).toBe("https://candidate.vercel.app");
  });

  it("rejects arbitrary URLs, custom-target deployments, and missing provider Git provenance", () => {
    expect(() => authenticatedPreviewUrl({ url: "attacker.example" })).toThrow(
      /Vercel HTTPS deployment URL/
    );
    expect(
      readyPreviewDeployment(
        {
          deployments: [
            {
              projectId: "project_1",
              meta: { githubCommitSha: "expected-sha" },
              target: null,
              readyState: "BUILDING",
              url: "candidate.vercel.app"
            }
          ]
        },
        "expected-sha",
        "project_1"
      )
    ).toBeUndefined();
    expect(() =>
      assertExpectedVercelDeployment(
        {
          projectId: "project_1",
          meta: { githubCommitSha: "expected-sha" },
          target: "staging",
          readyState: "READY",
          url: "candidate.vercel.app",
          gitSource: {
            type: "github",
            org: "MutAquaticStudio",
            repo: "NOXOS",
            ref: "feature/g1-cloud-foundation",
            sha: "expected-sha"
          }
        },
        expectedPreview,
        "candidate.vercel.app"
      )
    ).toThrow(/does not match/);
    expect(() =>
      assertExpectedVercelDeployment(
        {
          projectId: "project_1",
          meta: { githubCommitSha: "expected-sha" },
          target: null,
          readyState: "READY",
          url: "candidate.vercel.app",
          gitSource: {
            type: "github",
            org: "attacker",
            repo: "fork",
            ref: "feature/g1-cloud-foundation",
            sha: "expected-sha"
          }
        },
        expectedPreview,
        "candidate.vercel.app"
      )
    ).toThrow(/does not match/);
    expect(() =>
      assertExpectedVercelDeployment(
        {
          project: { id: "project_1" },
          meta: {
            githubCommitSha: "expected-sha",
            githubCommitOrg: "MutAquaticStudio",
            githubCommitRepo: "NOXOS",
            githubCommitRef: "attacker-branch"
          },
          target: null,
          readyState: "READY",
          url: "candidate.vercel.app"
        },
        expectedPreview,
        "candidate.vercel.app"
      )
    ).toThrow(/does not match/);
  });

  it("accepts the current Vercel list response project.id shape", () => {
    expect(
      readyPreviewDeployment(
        {
          deployments: [
            {
              project: { id: "project_1" },
              meta: { githubCommitSha: "expected-sha" },
              target: null,
              readyState: "READY",
              url: "candidate.vercel.app"
            }
          ]
        },
        "expected-sha",
        "project_1"
      )
    ).toMatchObject({ url: "candidate.vercel.app" });
  });

  it("accepts complete GitHub metadata when Vercel also supplies partial gitSource", () => {
    expect(() =>
      assertExpectedVercelDeployment(
        {
          project: { id: "project_1" },
          meta: {
            githubCommitSha: "expected-sha",
            githubCommitOrg: "MutAquaticStudio",
            githubCommitRepo: "NOXOS",
            githubCommitRef: "feature/g1-cloud-foundation"
          },
          target: null,
          readyState: "READY",
          url: "candidate.vercel.app",
          gitSource: { type: "github" }
        },
        expectedPreview,
        "candidate.vercel.app"
      )
    ).not.toThrow();
  });

  it("accepts the current custom-environment response only without a foreign environment ID", () => {
    const expectedStaging: ExpectedVercelDeployment = {
      ...expectedPreview,
      target: "staging"
    };
    const deployment = {
      project: { id: "project_1" },
      meta: {
        githubCommitSha: "expected-sha",
        githubCommitOrg: "MutAquaticStudio",
        githubCommitRepo: "NOXOS",
        githubCommitRef: "feature/g1-cloud-foundation"
      },
      target: null,
      readyState: "READY",
      url: "candidate.vercel.app"
    };

    expect(() =>
      assertExpectedVercelDeployment(deployment, expectedStaging, "candidate.vercel.app")
    ).not.toThrow();
    expect(() =>
      assertExpectedVercelDeployment(
        { ...deployment, customEnvironmentId: "env_other" },
        expectedStaging,
        "candidate.vercel.app"
      )
    ).toThrow(/does not match/);
  });

  it("keeps ordinary pull-request Preview secretless and executes only trusted base verifier code", () => {
    const workflow = readFileSync(".github/workflows/preview.yml", "utf8");

    expect(workflow).toMatch(/^\s*pull_request_target:/m);
    expect(workflow).not.toMatch(/^\s*workflow_run:/m);
    expect(workflow).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("NOX_ISOLATION_MODE: SECRETLESS_PREVIEW");
    expect(workflow).not.toContain("pnpm db:migrate:cloud");
    expect(workflow).not.toContain("pnpm infra:apply");
    expect(workflow).not.toContain("verify:staging:data-plane");
    expect(workflow).not.toMatch(/NOX_(RUNTIME|MIGRATION)_DATABASE_URL/);
    expect(workflow).not.toMatch(/SUPABASE_(URL|SERVICE_ROLE_KEY|ACCESS_TOKEN|STORAGE_BUCKET)/);
    expect(workflow).not.toMatch(/NOX_(WORKFLOW_PROBE|DIAGNOSTIC_PROBE)_TOKEN/);
  });
});
