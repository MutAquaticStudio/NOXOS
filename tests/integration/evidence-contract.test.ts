import { describe, expect, it } from "vitest";
import { createG1StagingEvidence } from "../../scripts/evidence/generate-g1-staging-evidence";
import {
  g1StagingTagName,
  verifyG1StagingTag
} from "../../scripts/evidence/publish-g1-staging-tag";

const previewSha = "1".repeat(40);
const stagingSha = "2".repeat(40);
const base = {
  CI_SHA: previewSha,
  ACCEPTED_PREVIEW_SHA: previewSha,
  ACCEPTED_PREVIEW_URL: "https://preview.vercel.app",
  ACCEPTED_PREVIEW_RUN: "https://github.com/MutAquaticStudio/NOXOS/actions/runs/2",
  ACCEPTED_PREVIEW_ARTIFACT: "g1-preview-attestation-" + previewSha,
  G1_DOD_AUDIT_ARTIFACT: "g1-dod-audit-" + stagingSha,
  ACCEPTED_PR_NUMBER: "2",
  ACCEPTED_CI_REFERENCE:
    "https://github.com/MutAquaticStudio/NOXOS/commit/" + previewSha + "/checks",
  MERGED_MAIN_SHA: stagingSha,
  EXPECTED_STAGING_SHA: stagingSha,
  DEPLOYED_STAGING_SHA: stagingSha,
  GITHUB_SHA: stagingSha,
  GITHUB_REPOSITORY: "MutAquaticStudio/NOXOS",
  GITHUB_RUN_URL: "https://github.com/MutAquaticStudio/NOXOS/actions/runs/1",
  STAGING_DEPLOYMENT_URL: "https://staging.vercel.app",
  GATE_1_DOCUMENT_VERSION: "1.0",
  GATE_1_STATUS: "FROZEN",
  GATE_1_DOD: "PASS",
  G2_READY: "YES",
  ARCHITECTURE_P0: "0",
  ARCHITECTURE_P1: "0",
  ARCHITECTURE_P2: "0"
};

describe("G1 per-SHA evidence contract", () => {
  it("binds accepted PR evidence to one exact Staging source state", () => {
    const evidence = createG1StagingEvidence(base);
    expect(evidence.workflowProvider).toBe("@vercel/queue@0.5.1");
    expect(evidence.ciSha).toBe(previewSha);
    expect(evidence.previewSha).toBe(previewSha);
    expect(evidence.mergedMainSha).toBe(stagingSha);
    expect(evidence.expectedStagingSha).toBe(stagingSha);
    expect(evidence.deployedStagingSha).toBe(stagingSha);
    expect(evidence.productionPromotionPerformed).toBe("NO");
    expect(evidence.previewAttestationArtifact).toBe("g1-preview-attestation-" + previewSha);
    expect(evidence.dodAuditArtifact).toBe("g1-dod-audit-" + stagingSha);
    expect(evidence.gate).toMatchObject({
      documentVersion: "1.0",
      status: "FROZEN",
      definitionOfDone: "PASS",
      g2Ready: "YES"
    });
  });

  it("fails closed on mismatched deployed Staging identity", () => {
    expect(() =>
      createG1StagingEvidence({ ...base, DEPLOYED_STAGING_SHA: "3".repeat(40) })
    ).toThrow(/must match exactly/);
  });

  it("uses a deterministic annotated tag name for the accepted commit", () => {
    expect(g1StagingTagName(stagingSha)).toBe("g1-staging-accepted-" + stagingSha);
  });

  it("verifies that the durable acceptance ref is annotated and targets the exact commit", async () => {
    const tagObjectSha = "3".repeat(40);
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/git/ref/tags/")) {
        return Response.json({ object: { type: "tag", sha: tagObjectSha } });
      }
      if (url.endsWith("/git/tags/" + tagObjectSha)) {
        return Response.json({
          tag: "g1-staging-accepted-" + stagingSha,
          message:
            "NØX-OS G1 Staging acceptance\n\nSource: " +
            stagingSha +
            "\nActions: https://github.com/MutAquaticStudio/NOXOS/actions/runs/1" +
            "\nArtifact: g1-staging-evidence-" +
            stagingSha +
            "\nG1 Document: 1.0" +
            "\nG1 Status: FROZEN" +
            "\nG1 DoD: PASS" +
            "\nG2 Ready: YES" +
            "\nProduction Promotion: NO",
          object: { type: "commit", sha: stagingSha }
        });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      verifyG1StagingTag(
        {
          GITHUB_REPOSITORY: "MutAquaticStudio/NOXOS",
          GITHUB_TOKEN: "test-token",
          EXPECTED_STAGING_SHA: stagingSha
        },
        request as typeof fetch
      )
    ).resolves.toBe("g1-staging-accepted-" + stagingSha);
  });

  it("fails closed when the durable acceptance ref is missing", async () => {
    await expect(
      verifyG1StagingTag(
        {
          GITHUB_REPOSITORY: "MutAquaticStudio/NOXOS",
          GITHUB_TOKEN: "test-token",
          EXPECTED_STAGING_SHA: stagingSha
        },
        (async () => new Response(null, { status: 404 })) as typeof fetch
      )
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a pre-created tag that omits the run and artifact provenance", async () => {
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/git/ref/tags/")) {
        return Response.json({ object: { type: "tag", sha: "3".repeat(40) } });
      }
      return Response.json({ object: { type: "commit", sha: stagingSha } });
    };

    await expect(
      verifyG1StagingTag(
        {
          GITHUB_REPOSITORY: "MutAquaticStudio/NOXOS",
          GITHUB_TOKEN: "test-token",
          EXPECTED_STAGING_SHA: stagingSha
        },
        request as typeof fetch
      )
    ).rejects.toThrow(/required provenance/);
  });

  it("rejects final evidence that tries to freeze without a clean architecture audit", () => {
    expect(() => createG1StagingEvidence({ ...base, ARCHITECTURE_P1: "1" })).toThrow(
      /ARCHITECTURE_P1 must equal 0/
    );
  });

  it("rejects a DoD audit artifact whose identity does not match the accepted main SHA", () => {
    expect(() =>
      createG1StagingEvidence({ ...base, G1_DOD_AUDIT_ARTIFACT: "g1-dod-audit-" + previewSha })
    ).toThrow(/must bind to the accepted main SHA/);
  });
});
