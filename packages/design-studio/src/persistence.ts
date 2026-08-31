import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import type {
  BudgetContext,
  CompositionKind,
  FormulaCandidate,
  NormalizedOlfactoryIntent,
  TrialContext
} from "./contracts.js";
import type { AccordArchitecturePlan } from "./accords.js";
import type { DesignWorkflowMode } from "./contracts.js";

export type DesignProject = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DesignBrief = {
  id: string;
  tenantId: string;
  projectId: string;
  workflowMode: DesignWorkflowMode;
  status: "DRAFT" | "INTENT_CONFIRMED" | "ARCHIVED";
  rawBrief: string;
  briefPayload: Record<string, unknown>;
  normalizedIntent: NormalizedOlfactoryIntent | null;
  accordArchitecturePlan: AccordArchitecturePlan | null;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FrozenFormulaVersion = {
  formulaId: string;
  formulaVersionId: string;
  tenantId: string;
  projectId: string;
  sourceBriefId: string;
  name: string;
  versionNumber: number;
  parentFormulaVersionId: string | null;
  compositionKind: CompositionKind;
  generationStrategy: string;
  engineVersion: string;
  status: "FROZEN";
  approvalState: "NOT_APPROVED" | "APPROVED" | "SUPERSEDED";
  bundleHash: string;
  candidate: FormulaCandidate;
  frozenAt: Date;
};

export type FreezeFormulaInput = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
  projectId: string;
  sourceBriefId: string;
  formulaName: string;
  candidate: FormulaCandidate;
  freshSnapshots: readonly MaterialIntelligenceSnapshot[];
  parentFormulaVersionId?: string;
  sourceTrialId?: string;
  sourceEvaluationId?: string;
};

export interface DesignStudioStore {
  createProject(input: {
    tenantId: string;
    name: string;
    description: string | null;
    actorUserId: string;
  }): Promise<DesignProject>;
  listProjects(tenantId: string): Promise<DesignProject[]>;
  findProject(tenantId: string, projectId: string): Promise<DesignProject | undefined>;
  createBrief(input: {
    tenantId: string;
    projectId: string;
    workflowMode: DesignWorkflowMode;
    rawBrief: string;
    briefPayload: Record<string, unknown>;
    normalizedIntent: NormalizedOlfactoryIntent;
    actorUserId: string;
  }): Promise<DesignBrief>;
  findBrief(tenantId: string, briefId: string): Promise<DesignBrief | undefined>;
  updateBrief(input: {
    tenantId: string;
    briefId: string;
    rawBrief?: string;
    briefPayload?: Record<string, unknown>;
    normalizedIntent?: NormalizedOlfactoryIntent;
    accordArchitecturePlan?: AccordArchitecturePlan;
  }): Promise<DesignBrief | undefined>;
  confirmBrief(input: {
    tenantId: string;
    briefId: string;
    intent: NormalizedOlfactoryIntent;
    actorUserId: string;
  }): Promise<DesignBrief | undefined>;
  freezeFormula(input: FreezeFormulaInput): Promise<FrozenFormulaVersion>;
  findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined>;
  approveFrozenFormulaVersion(input: {
    tenantId: string;
    formulaVersionId: string;
    actorUserId: string;
    requestId: string;
    correlationId: string;
    sourceTrialId: string;
    sourceEvaluationId: string;
  }): Promise<FrozenFormulaVersion | undefined>;
  recordAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void>;
}

export type CandidateGenerationRequest = {
  projectId: string;
  sourceBriefId: string;
  compositionKind: CompositionKind;
  accordKey?: string;
  budget: BudgetContext;
};

export type FrozenFormulaHandoff = {
  formula: FrozenFormulaVersion;
  trialContext: TrialContext;
};
