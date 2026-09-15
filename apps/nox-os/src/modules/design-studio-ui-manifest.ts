import type { GateUIManifest } from "../../../../packages/contracts/src/ui-manifest";

/** Acceptance metadata only. Domain commands remain owned by Design Studio. */
export const formulaDetailUiManifest = {
  schemaVersion: "1.0",
  status: "BLOCKED",
  screenId: "DS-04",
  gateId: "G4",
  route: "/design-studio/formula-versions/:formulaVersionId",
  module: "design-studio",
  userJob: "Inspect an exact frozen FormulaVersion and its selected approval/revision evidence",
  contractRefs: [
    { document: "DESIGN.md", version: "3.0-OS-SHELL-CANONICAL", section: "48, 54.1, 92, 98" },
    {
      document: "docs/nox-os/G4_DESIGN_STUDIO_NOX_OE_DRAFT_v2.2.md",
      version: "2.3-COMPLETE CANDIDATE",
      section: "Source binding"
    }
  ],
  visualRefs: [
    {
      sourceType: "none",
      id: "DESIGN.md textual composition",
      version: "3.0",
      approvalStatus: "none"
    }
  ],
  canonicalObject: "FrozenFormulaVersion",
  domainOwner: "G4 Design Studio",
  relationships: [
    "FormulaVersion → candidate frozen Material snapshots",
    "exact sourceTrialId → sourceEvaluationId"
  ],
  entryEvidence: [
    "tenant-bound GET FormulaVersion",
    "optional explicit sourceTrialId/sourceEvaluationId URL hints validated through G5"
  ],
  currentPhaseSource: "FormulaVersionEntry formula.status/approvalState + evidenceMatches",
  blockersSource: "FormulaVersionEntry evidenceError/approvalError + canonical API rejection",
  nextActionSource: "FormulaVersionEntry canApprove/canAssess + modulePermissions",
  routeAccess: {
    tenantBindingRef: "app.tsx authenticated activeTenant",
    readPermission: "module.design-studio.studio.read",
    entitlementRef: "module.design-studio"
  },
  query: {
    source: "GET /design-studio/formula-versions/:formulaVersionId",
    tenantBindingRef: "ApiClient options.tenantId",
    readPermission: "module.design-studio.studio.read",
    cacheIsolationRef: "app.tsx LazyDesignStudioExperience tenantId:pathname key"
  },
  serverGuardSource:
    "packages/design-studio/src/api.ts DesignStudioApi tenant + approvalSchema + approvalEvidenceReader",
  template: "studio",
  canvasMode: "atelier",
  density: "default",
  interaction: {
    supported: ["pointer", "touch"],
    default: "pointer",
    touchOverride: "coarse-pointer-or-user-preference"
  },
  openableEntities: [
    {
      entityType: "Material",
      routeRef: "/materials/:materialId",
      tenantBindingRef: "current active tenant; destination authorizes again",
      readPermission: "module.material-intelligence.material.read"
    }
  ],
  inspectorTabs: ["Overview", "Properties"],
  commands: [
    {
      kind: "read",
      canonicalCommandId: "GET /design-studio/formula-versions/:formulaVersionId",
      commandOwner: "G4",
      permission: "module.design-studio.studio.read",
      tenantBindingRef: "ApiClient tenantId",
      errorCodes: ["PERMISSION_DENIED", "FORMULA_VERSION_NOT_FOUND"]
    },
    {
      kind: "read",
      canonicalCommandId: "GET /trials/:sourceTrialId",
      commandOwner: "G5",
      permission: "module.trial-sensory.trial.read",
      tenantBindingRef: "ApiClient tenantId; explicit Trial/Evaluation IDs",
      errorCodes: ["PERMISSION_DENIED", "TRIAL_NOT_FOUND"]
    },
    {
      kind: "mutation",
      canonicalCommandId: "POST /design-studio/formula-versions/:formulaVersionId/approve",
      commandOwner: "G4",
      permission: "module.design-studio.formula.approve",
      targetObjectRef: "route formulaVersionId",
      targetVersionSource: "loaded formula.formulaVersionId + bundleHash + FROZEN/NOT_APPROVED",
      guardRefs: [
        "DesignStudioApi approvalEvidenceReader.findApprovalEvidence",
        "PostgresDesignStudioStore transaction → G5 lockFinalTrialEvidence",
        "PostgresDesignStudioStore.approveFrozenFormulaVersion conditional update"
      ],
      confirmation: "required",
      consequence: "Record explicit approval; frozen composition remains immutable",
      auditConsequence:
        "Insert formula.approved in the same database transaction as approval update",
      auditEventRef:
        "packages/database/src/design-studio-store.ts approveFrozenFormulaVersion: formula.approved",
      successDestination: "same exact FormulaVersion route",
      successStateSource: "response.formulaVersion; no optimistic approval",
      idempotency: {
        mode: "documented-server-uniqueness",
        contractRef:
          "approveFrozenFormulaVersion updates only FROZEN + NOT_APPROVED; duplicate transition changes zero rows and emits no second audit"
      },
      errorCodes: [
        "PERMISSION_DENIED",
        "APPROVAL_EVIDENCE_REQUIRED",
        "APPROVAL_EVIDENCE_INVALID",
        "FORMULA_VERSION_NOT_FOUND"
      ]
    }
  ],
  guardRefs: [
    "packages/design-studio/src/api.ts approval handler",
    "packages/database/src/design-studio-store.ts approveFrozenFormulaVersion"
  ],
  handoffInputs: ["sourceTrialId", "sourceEvaluationId"],
  handoffOutputs: [
    "exact FormulaVersion approval state",
    "G5 Trial navigation or eligible G6 assessment navigation"
  ],
  stateFixtures: [
    "loading",
    "query error",
    "frozen composition",
    "missing evidence",
    "wrong lineage",
    "permission denied",
    "approval confirmation",
    "server rejection",
    "approved response",
    "finalized revision evidence",
    "read-only revision handoff",
    "revision response lineage conflict",
    "confirmed new revision navigation"
  ],
  unknowns: [
    {
      id: "DS04-REVISION-COMMAND-ACCEPTANCE",
      concern:
        "Revision request audit deduplication and Formula-serialized revision replay are implemented in the existing stores. Their real PostgreSQL concurrency/rollback probes are not yet executed; full MutationCommand acceptance remains incomplete.",
      owner: "G4/G5 domain owner",
      contractNeeded:
        "Execute design-studio-evidence.postgres.test.ts on disposable migrated PostgreSQL before completing mutation manifests and UI v3 acceptance. Replay binds tenant + parent + Trial + evaluation + strategy and rejects changed candidate payload.",
      blocksMutations: true
    },
    {
      id: "DS04-APPROVAL-COMMIT-EVIDENCE",
      concern:
        "Commit-time G5 evidence validation/locking is implemented in the approval transaction. Real PostgreSQL locking/rollback acceptance remains unexecuted; complete §98 capability acceptance is not inferred from the request-level permission guard.",
      owner: "G4/G5 domain owner",
      contractNeeded:
        "User approved the narrow G4/G5 patch. Execute transaction/TOCTOU acceptance and finish capability checks before UI v3 release.",
      blocksMutations: true
    }
  ],
  contentSecurityRefs: ["React text rendering of authorized DTO; no HTML injection"],
  mobile: {
    policy: "task-priority",
    priority: [
      "Formula identity and state",
      "Exact composition",
      "Approval evidence and blockers",
      "Explicit confirmation"
    ]
  },
  forbiddenBehavior: [
    "Editing frozen lines",
    "Inferring approval from Freeze",
    "Selecting an implicit latest Trial",
    "G5-owned approval",
    "Client authorization authority"
  ]
} satisfies GateUIManifest;
