import { computeFormulaBundleHash } from "@nox-os/design-studio";
import type {
  DesignBrief,
  DesignProject,
  DesignStudioStore,
  FreezeFormulaInput,
  FrozenFormulaVersion
} from "@nox-os/design-studio";

const PROJECT_ID = "51000000-0000-4000-8000-000000000001";
const BRIEF_ID = "52000000-0000-4000-8000-000000000001";
const FORMULA_ID = "53000000-0000-4000-8000-000000000001";
const VERSION_ID = "54000000-0000-4000-8000-000000000001";

export class InMemoryDesignStudioStore implements DesignStudioStore {
  readonly projects = new Map<string, DesignProject>();
  readonly briefs = new Map<string, DesignBrief>();
  readonly formulaVersions = new Map<string, FrozenFormulaVersion>();
  readonly audits: Array<Parameters<DesignStudioStore["recordAudit"]>[0]> = [];

  async createProject(input: {
    tenantId: string;
    name: string;
    description: string | null;
    actorUserId: string;
  }): Promise<DesignProject> {
    const now = new Date("2026-08-31T00:00:00.000Z");
    const value: DesignProject = {
      id: PROJECT_ID,
      tenantId: input.tenantId,
      name: input.name,
      description: input.description,
      status: "ACTIVE",
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(value.id, value);
    return structuredClone(value);
  }

  async listProjects(tenantId: string): Promise<DesignProject[]> {
    return [...this.projects.values()]
      .filter((value) => value.tenantId === tenantId)
      .map((value) => structuredClone(value));
  }

  async findProject(tenantId: string, projectId: string): Promise<DesignProject | undefined> {
    const value = this.projects.get(projectId);
    return value?.tenantId === tenantId ? structuredClone(value) : undefined;
  }

  async createBrief(input: Parameters<DesignStudioStore["createBrief"]>[0]): Promise<DesignBrief> {
    const now = new Date("2026-08-31T00:00:00.000Z");
    const value: DesignBrief = {
      id: BRIEF_ID,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowMode: input.workflowMode,
      status: "DRAFT",
      rawBrief: input.rawBrief,
      briefPayload: structuredClone(input.briefPayload),
      normalizedIntent: structuredClone(input.normalizedIntent),
      accordArchitecturePlan: null,
      confirmedByUserId: null,
      confirmedAt: null,
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.briefs.set(value.id, value);
    return structuredClone(value);
  }

  async findBrief(tenantId: string, briefId: string): Promise<DesignBrief | undefined> {
    const value = this.briefs.get(briefId);
    return value?.tenantId === tenantId ? structuredClone(value) : undefined;
  }

  async updateBrief(
    input: Parameters<DesignStudioStore["updateBrief"]>[0]
  ): Promise<DesignBrief | undefined> {
    const value = this.briefs.get(input.briefId);
    if (!value || value.tenantId !== input.tenantId) return undefined;
    const updated: DesignBrief = {
      ...value,
      ...(input.rawBrief === undefined ? {} : { rawBrief: input.rawBrief }),
      ...(input.briefPayload === undefined
        ? {}
        : { briefPayload: structuredClone(input.briefPayload) }),
      ...(input.normalizedIntent === undefined
        ? {}
        : { normalizedIntent: structuredClone(input.normalizedIntent) }),
      ...(input.accordArchitecturePlan === undefined
        ? {}
        : { accordArchitecturePlan: structuredClone(input.accordArchitecturePlan) }),
      updatedAt: new Date("2026-08-31T00:01:00.000Z")
    };
    this.briefs.set(updated.id, updated);
    return structuredClone(updated);
  }

  async confirmBrief(
    input: Parameters<DesignStudioStore["confirmBrief"]>[0]
  ): Promise<DesignBrief | undefined> {
    const value = this.briefs.get(input.briefId);
    if (!value || value.tenantId !== input.tenantId) return undefined;
    const confirmedAt = new Date("2026-08-31T00:02:00.000Z");
    const updated: DesignBrief = {
      ...value,
      status: "INTENT_CONFIRMED",
      normalizedIntent: structuredClone(input.intent),
      confirmedByUserId: input.actorUserId,
      confirmedAt,
      updatedAt: confirmedAt
    };
    this.briefs.set(updated.id, updated);
    return structuredClone(updated);
  }

  async freezeFormula(input: FreezeFormulaInput): Promise<FrozenFormulaVersion> {
    const lines = input.candidate.lines.map((line) => ({
      materialId: line.materialId,
      normalizedMassMg: line.normalizedMassMg,
      snapshotHash: line.materialSnapshot.snapshotHash
    }));
    const value: FrozenFormulaVersion = {
      formulaId: FORMULA_ID,
      formulaVersionId: VERSION_ID,
      tenantId: input.tenantId,
      projectId: input.projectId,
      sourceBriefId: input.sourceBriefId,
      name: input.formulaName,
      versionNumber: 1,
      compositionKind: input.candidate.compositionKind,
      generationStrategy: input.candidate.generationStrategy,
      engineVersion: input.candidate.engineVersion,
      status: "FROZEN",
      approvalState: "NOT_APPROVED",
      bundleHash: computeFormulaBundleHash(input.candidate.compositionKind, lines),
      candidate: structuredClone(input.candidate),
      frozenAt: new Date("2026-08-31T00:03:00.000Z")
    };
    this.formulaVersions.set(value.formulaVersionId, value);
    await this.recordAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "formula.frozen",
      resourceType: "FormulaVersion",
      resourceId: value.formulaVersionId,
      requestId: input.requestId,
      correlationId: input.correlationId
    });
    return structuredClone(value);
  }

  async findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined> {
    const value = this.formulaVersions.get(formulaVersionId);
    return value?.tenantId === tenantId ? structuredClone(value) : undefined;
  }

  async approveFrozenFormulaVersion(
    input: Parameters<DesignStudioStore["approveFrozenFormulaVersion"]>[0]
  ): Promise<FrozenFormulaVersion | undefined> {
    const value = this.formulaVersions.get(input.formulaVersionId);
    if (!value || value.tenantId !== input.tenantId) return undefined;
    const approved = { ...value, approvalState: "APPROVED" as const };
    this.formulaVersions.set(approved.formulaVersionId, approved);
    await this.recordAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "formula.approved",
      resourceType: "FormulaVersion",
      resourceId: approved.formulaVersionId,
      requestId: input.requestId,
      correlationId: input.correlationId
    });
    return structuredClone(approved);
  }

  async recordAudit(input: Parameters<DesignStudioStore["recordAudit"]>[0]): Promise<void> {
    this.audits.push(structuredClone(input));
  }
}
