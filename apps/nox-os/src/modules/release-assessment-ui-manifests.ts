import type { GateUIManifest } from "../../../../packages/contracts/src/ui-manifest";
import { releaseRegistryUiManifest } from "./release-registry-ui-manifest";

const mutationErrors = [
  "PERMISSION_DENIED",
  "TENANT_ACCESS_DENIED",
  "NOT_FOUND",
  "FORMULA_VERSION_NOT_FROZEN",
  "APPROVAL_EVIDENCE_REQUIRED",
  "UNSUPPORTED_COMPOSITION_KIND",
  "IDEMPOTENCY_CONFLICT",
  "VALIDATION_FAILED"
];
const pendingEvidence: GateUIManifest["unknowns"] = [
  {
    id: "G6-COMMAND-ACCEPTANCE",
    concern:
      "Replay/audit rollback probes exist but have not run against disposable PostgreSQL; authenticated and complete visual acceptance remain unverified.",
    owner: "UI v3 release owner",
    contractNeeded:
      "Execute design-studio-evidence.postgres.test.ts G6 probes plus authenticated screen acceptance before certification. Only keyed callers have replay protection.",
    blocksMutations: true
  }
];

/** Acceptance contracts, not a parallel permission or routing authority. */
export const releaseCreateUiManifest = {
  ...releaseRegistryUiManifest,
  screenId: "release-readiness.create",
  route: "/release-readiness/new",
  userJob: "Confirm an exact approved FormulaVersion release profile and record its assessment",
  template: "workflow",
  query: {
    source: "No automatic query; optional formulaVersionId URL hint is an untrusted form value",
    tenantBindingRef: "ApiClient tenantId; server G2 RequestContext",
    readPermission: "module.release-readiness.assessment.read",
    cacheIsolationRef:
      "NewAssessment keyed by active tenant; no persisted draft or shared query cache"
  },
  entryEvidence: [
    "G2 active tenant and read/create/run grants; server validates Formula on submission"
  ],
  currentPhaseSource:
    "Local profile entry / pending / unconfirmed; never a fabricated domain status",
  blockersSource: "Canonical API rejection; safe error mapping; unknown-outcome input lock",
  nextActionSource: "Explicit Run Assessment; same-intent retry; confirmed local leave",
  commands: [
    {
      kind: "mutation",
      canonicalCommandId: "POST /release-readiness/assessments",
      commandOwner: "G6",
      permission: "module.release-readiness.assessment.create",
      targetObjectRef: "body.formulaVersionId + active tenant",
      targetVersionSource: "Server-resolved immutable FormulaVersion and current approval/evidence",
      guardRefs: [
        "ReleaseReadinessApi create + run permission checks",
        "ReleaseReadinessApplication.assess eligibility",
        "PostgresReleaseReadinessStore.createFinalAssessment transaction"
      ],
      confirmation: "required",
      consequence:
        "Explicit submitted profile creates one immutable assessment; does not release a Batch",
      auditConsequence: "Assessment, checks and release-readiness.assessed audit commit atomically",
      auditEventRef: "packages/database/src/release-readiness-store.ts release-readiness.assessed",
      successDestination: "/release-readiness/:assessmentId",
      successStateSource: "POST result.assessment.id then tenant-bound GET; no optimistic decision",
      idempotency: {
        mode: "keyed-server-replay",
        contractRef:
          "createFinalAssessment tenant+actor+idempotencyKey advisory lock and audit intent/result; unchanged browser retry reuses key"
      },
      errorCodes: mutationErrors
    }
  ],
  handoffInputs: ["Optional untrusted formulaVersionId query hint"],
  handoffOutputs: ["Exact server-created assessment ID"],
  stateFixtures: [
    "profile entry",
    "dirty leave cancelled",
    "pending",
    "unknown response/input lock",
    "same-key retry",
    "safe error",
    "success navigation",
    "permission denied"
  ],
  unknowns: pendingEvidence,
  mobile: {
    policy: "task-priority",
    priority: ["Release profile", "Consequence warning", "Submit/recover exact request"]
  },
  forbiddenBehavior: [
    ...releaseRegistryUiManifest.forbiddenBehavior,
    "Editing unknown-outcome request into another submission",
    "Discard claiming server cancellation",
    "Unkeyed UI submission"
  ]
} satisfies GateUIManifest;

export const releaseDetailUiManifest = {
  ...releaseRegistryUiManifest,
  screenId: "release-readiness.detail",
  route: "/release-readiness/:assessmentId",
  userJob:
    "Inspect immutable decision evidence and explicitly request a new assessment of current evidence",
  template: "entity",
  query: {
    source: "GET /release-readiness/assessments/:assessmentId",
    tenantBindingRef: "ApiClient tenantId; server G2 RequestContext",
    readPermission: "module.release-readiness.assessment.read",
    cacheIsolationRef:
      "Detail keyed by tenant + assessment ID; cancelled read ignores late response"
  },
  entryEvidence: ["Exact tenant-authorized assessment GET"],
  nextActionSource: "run + review permission enables explicit Reassess Current Evidence",
  inspectorTabs: ["Overview", "Properties"],
  commands: [
    {
      kind: "read",
      canonicalCommandId: "GET /release-readiness/assessments/:assessmentId",
      commandOwner: "G6",
      permission: "module.release-readiness.assessment.read",
      tenantBindingRef: "ApiClient tenantId + exact route ID",
      errorCodes: ["PERMISSION_DENIED", "NOT_FOUND"]
    },
    {
      ...releaseCreateUiManifest.commands[0],
      canonicalCommandId: "POST /release-readiness/assessments/:assessmentId/reassess",
      permission: "module.release-readiness.assessment.run",
      targetObjectRef: "Exact loaded immutable assessment.id + tenant",
      targetVersionSource:
        "Immutable assessment ID; server re-resolves current evidence for its profile",
      guardRefs: [
        "ReleaseReadinessApi run + review permission checks",
        "ReleaseReadinessApplication.reassess",
        "createFinalAssessment lineage + keyed transaction"
      ],
      consequence:
        "Explicit action creates a new immutable assessment linked to its predecessor; never edits previous truth",
      auditConsequence:
        "Assessment, checks and release-readiness.reassessed audit commit atomically",
      auditEventRef: "packages/database/src/release-readiness-store.ts release-readiness.reassessed"
    }
  ],
  handoffInputs: ["Exact assessment ID"],
  handoffOutputs: [
    "Immutable assessment DTO",
    "New superseding assessment ID after explicit action"
  ],
  stateFixtures: [
    "loading",
    "read error",
    "immutable decision",
    "empty evidence warning",
    "unconfirmed reassessment",
    "same-key recovery",
    "permission denied"
  ],
  unknowns: pendingEvidence,
  mobile: {
    policy: "task-priority",
    priority: [
      "Recorded decision",
      "Evidence warning",
      "Exact lineage",
      "Scrollable checks",
      "Reassess/recover"
    ]
  },
  forbiddenBehavior: [
    ...releaseRegistryUiManifest.forbiddenBehavior,
    "Editing immutable assessment",
    "Automatic reassessment on read",
    "Showing raw exception details"
  ]
} satisfies GateUIManifest;
