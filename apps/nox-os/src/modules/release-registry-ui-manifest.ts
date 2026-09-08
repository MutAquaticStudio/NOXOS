import type { GateUIManifest } from "../../../../packages/contracts/src/ui-manifest";

/** Read-only registry contract; does not certify the separate create/detail commands. */
export const releaseRegistryUiManifest = {
  schemaVersion: "1.0",
  status: "BLOCKED",
  screenId: "release-readiness.registry",
  gateId: "G6",
  route: "/release-readiness",
  module: "release-readiness",
  userJob: "Find and open a recorded immutable release assessment without inferring Batch release",
  contractRefs: [
    { document: "DESIGN.md", version: "3.0-OS-SHELL-CANONICAL", section: "71, 92–95" }
  ],
  visualRefs: [
    {
      sourceType: "none",
      id: "Existing OS registry grammar",
      version: "3.0",
      approvalStatus: "none"
    }
  ],
  canonicalObject: "ReleaseAssessment",
  domainOwner: "G6 Release Readiness",
  relationships: ["Assessment → exact FormulaVersion", "Assessment → superseded assessment"],
  entryEvidence: ["Authorized tenant-bound GET /release-readiness"],
  currentPhaseSource: "Server assessment.decision; no client readiness calculation",
  blockersSource: "NoxReadFeedback plus original assessment decision",
  nextActionSource: "Open exact assessment; new-screen navigation requires create + run grants",
  routeAccess: {
    tenantBindingRef: "G2 activeTenant",
    readPermission: "module.release-readiness.assessment.read",
    entitlementRef: "module.release-readiness"
  },
  query: {
    source: "GET /release-readiness",
    tenantBindingRef: "ApiClient tenantId",
    readPermission: "module.release-readiness.assessment.read",
    cacheIsolationRef: "Registry keyed by tenant; cancelled read effect ignores late response"
  },
  serverGuardSource: "packages/release-readiness/src/api.ts",
  template: "index",
  canvasMode: "review",
  density: "compact",
  interaction: {
    supported: ["pointer", "touch"],
    default: "pointer",
    touchOverride: "coarse-pointer-or-user-preference"
  },
  openableEntities: [
    {
      entityType: "ReleaseAssessment",
      routeRef: "/release-readiness/:assessmentId",
      tenantBindingRef: "G2 active tenant; destination reauthorizes",
      readPermission: "module.release-readiness.assessment.read"
    }
  ],
  inspectorTabs: [],
  commands: [
    {
      kind: "read",
      canonicalCommandId: "GET /release-readiness",
      commandOwner: "G6",
      permission: "module.release-readiness.assessment.read",
      tenantBindingRef: "ApiClient tenantId",
      errorCodes: ["PERMISSION_DENIED"]
    }
  ],
  guardRefs: ["ReleaseReadinessExperience read grant; API remains authoritative"],
  handoffInputs: ["URL formula, decision and application filters"],
  handoffOutputs: ["Exact assessment ID route"],
  stateFixtures: [
    "loading",
    "error/retry",
    "invalid row",
    "empty",
    "filtered empty",
    "populated",
    "tenant switch",
    "read denied",
    "long text"
  ],
  unknowns: [
    {
      id: "G6-REGISTRY-RELEASE-ACCEPTANCE",
      concern:
        "Local read fixtures do not prove authenticated release acceptance or full-system manifest coverage.",
      owner: "UI v3 release owner",
      contractNeeded:
        "Authenticated acceptance and complete runtime manifest mapping before READY. This registry has no mutations.",
      blocksMutations: true
    }
  ],
  contentSecurityRefs: [
    "React text only; URL filters do not confer authority; UUID-only object links"
  ],
  mobile: {
    policy: "task-priority",
    priority: ["Filter", "Decision", "Exact assessment link", "Scrollable evidence registry"]
  },
  forbiddenBehavior: [
    "Inferring Batch release from READY",
    "Client permission authority",
    "Hidden mutation on filtering",
    "Assessing on registry entry"
  ]
} satisfies GateUIManifest;
