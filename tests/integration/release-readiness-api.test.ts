import { describe, expect, it } from "vitest";
import type { ApiRequest, TenantRequestContext } from "@nox-os/contracts";
import { InternalApiRouter } from "@nox-os/platform";
import { LocalFeatureFlagResolver } from "@nox-os/module-registry";
import {
  createReleaseReadinessApi,
  KnownLimitV1Policy,
  ReleaseReadinessApplication,
  releaseReadinessPermissions
} from "@nox-os/release-readiness";
import { moduleDefinitions } from "../../apps/nox-os/src/modules/definitions";
import { InMemoryReleaseReadinessStore } from "../helpers/in-memory-release-readiness-store";
import {
  G6_IDS,
  g6Evidence,
  g6Formula,
  g6MaterialEvidence,
  verifiedTrace
} from "../helpers/g6-release-fixture";

function context(tenantId: string, modulePermissions: readonly string[]): TenantRequestContext {
  return {
    requestId: "req_g6_api",
    correlationId: "corr_g6_api",
    environment: "test",
    sourceSha: "g6-test",
    actor: { userId: G6_IDS.actorA, platformRoleKey: null, platformPermissions: [] },
    tenant: { tenantId, roleKey: "TENANT_OWNER" },
    authorization: { tenantPermissions: [], modulePermissions },
    entitlements: ["module.release-readiness"]
  };
}

function fixture(options: { disabled?: boolean; entitled?: boolean } = {}) {
  const store = new InMemoryReleaseReadinessStore();
  const formula = g6Formula();
  const sources = {
    async findFrozenFormulaVersion(tenantId: string, formulaVersionId: string) {
      return tenantId === G6_IDS.tenantA && formulaVersionId === formula.formulaVersionId
        ? structuredClone(formula)
        : undefined;
    },
    async resolve() {
      return g6Evidence(formula, {
        materials: [
          g6MaterialEvidence(),
          g6MaterialEvidence({
            materialId: G6_IDS.materialB,
            activeAromaticMassMg: "400000",
            ifraRestricted: false,
            ifraCat4MaxPct: null,
            ifraAmendment: "51",
            ifraSourceReference: "IFRA-NONRESTRICTED-TEST"
          })
        ],
        formulaLineCount: 2
      });
    },
    async resolveApprovalTrace() {
      return verifiedTrace();
    }
  };
  const application = new ReleaseReadinessApplication(
    store,
    sources,
    sources,
    sources,
    new KnownLimitV1Policy()
  );
  const authorization = {
    async tenantContext(request: ApiRequest) {
      if (!request.headers.authorization) {
        throw { status: 401, code: "AUTH_REQUIRED", message: "Authentication required." };
      }
      const tenantId = request.headers["x-nox-tenant-id"];
      if (tenantId !== G6_IDS.tenantA && tenantId !== G6_IDS.tenantB) {
        throw { status: 403, code: "TENANT_ACCESS_DENIED", message: "Tenant access denied." };
      }
      const values =
        request.headers.authorization === "Bearer read"
          ? [releaseReadinessPermissions.read]
          : Object.values(releaseReadinessPermissions);
      const resolved = context(tenantId, values);
      return options.entitled === false ? { ...resolved, entitlements: [] } : resolved;
    }
  };
  const api = createReleaseReadinessApi({
    application,
    authorization,
    definitions: moduleDefinitions,
    featureFlags: new LocalFeatureFlagResolver(options.disabled ? [] : ["module.release-readiness"])
  });
  const router = new InternalApiRouter();
  api.registerRoutes(router);
  const request = (input: {
    path: string;
    method?: string;
    tenantId?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) =>
    router.dispatch({
      method: input.method ?? "GET",
      path: input.path,
      headers: {
        ...(input.token === "none" ? {} : { authorization: input.token ?? "Bearer owner" }),
        "x-nox-tenant-id": input.tenantId ?? G6_IDS.tenantA,
        ...input.headers
      },
      body: input.body,
      context: {
        requestId: "req_g6_api",
        correlationId: "corr_g6_api",
        environment: "test",
        sourceSha: "g6-test"
      }
    });
  return { request, store };
}

const profile = {
  formulaVersionId: G6_IDS.version,
  applicationKey: "fine-fragrance",
  dosagePct: 10,
  policyKey: "g6-known-limit-v1"
};

describe("G6 Release Readiness API", () => {
  it("creates, reads, and reassesses only through server-derived context", async () => {
    const target = fixture();
    const created = await target.request({
      path: "/release-readiness/assessments",
      method: "POST",
      body: profile,
      headers: {
        "x-role": "PLATFORM_OWNER",
        "x-permission": "*",
        "x-user-id": G6_IDS.actorB
      }
    });
    expect(created.status).toBe(201);
    const value = (created.body as { assessment: { id: string; createdByUserId: string } })
      .assessment;
    expect(value.createdByUserId).toBe(G6_IDS.actorA);
    expect(
      (await target.request({ path: `/release-readiness/assessments/${value.id}` })).status
    ).toBe(200);
    const reassessed = await target.request({
      path: `/release-readiness/assessments/${value.id}/reassess`,
      method: "POST"
    });
    expect(reassessed.status).toBe(201);
    expect(
      (reassessed.body as { assessment: { supersedesAssessmentId: string } }).assessment
        .supersedesAssessmentId
    ).toBe(value.id);
  });

  it("non-discloses cross-tenant assessment and Formula access", async () => {
    const target = fixture();
    const created = await target.request({
      path: "/release-readiness/assessments",
      method: "POST",
      body: profile
    });
    const id = (created.body as { assessment: { id: string } }).assessment.id;
    expect(
      (
        await target.request({
          path: `/release-readiness/assessments/${id}`,
          tenantId: G6_IDS.tenantB
        })
      ).status
    ).toBe(404);
    expect(
      (
        await target.request({
          path: "/release-readiness/assessments",
          method: "POST",
          tenantId: G6_IDS.tenantB,
          body: profile
        })
      ).status
    ).toBe(404);
  });

  it("fails closed for unauthenticated, read-only, and disabled-module requests", async () => {
    expect((await fixture().request({ path: "/release-readiness", token: "none" })).status).toBe(
      401
    );
    expect(
      (
        await fixture().request({
          path: "/release-readiness/assessments",
          method: "POST",
          token: "Bearer read",
          body: profile
        })
      ).status
    ).toBe(403);
    expect((await fixture({ disabled: true }).request({ path: "/release-readiness" })).status).toBe(
      403
    );
    expect(
      (await fixture({ entitled: false }).request({ path: "/release-readiness" })).status
    ).toBe(403);
  });
});
