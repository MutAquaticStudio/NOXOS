import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import type { BudgetContext, FormulaCandidate } from "./contracts.js";
import type { AccordArchitecturePlan } from "./accords.js";
import type { ConfirmedIntent } from "./intent.js";
import { buildAccordArchitecture } from "./accords.js";
import {
  generateFormulaCandidates,
  type CostResolver,
  type FormulaPerceptionScorer
} from "./formula.js";
import { createMaterialCandidateEvidence } from "./materials.js";
import { DesignStudioProblem } from "./problem.js";

export const designStudioPermissions = {
  read: "module.design-studio.studio.read",
  manageBrief: "module.design-studio.brief.manage",
  confirmIntent: "module.design-studio.intent.confirm",
  generateFormula: "module.design-studio.formula.generate",
  planAccord: "module.design-studio.accord.plan",
  developAccord: "module.design-studio.accord.develop",
  freezeFormula: "module.design-studio.formula.freeze"
} as const;
export type DesignStudioPermission =
  (typeof designStudioPermissions)[keyof typeof designStudioPermissions];

export type DesignStudioTenantContext = {
  actorUserId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
};

export function requireDesignStudioPermission(
  context: DesignStudioTenantContext,
  permission: DesignStudioPermission
): void {
  if (!context.permissions.has(permission)) {
    throw new DesignStudioProblem(
      403,
      "TENANT_ACCESS_DENIED",
      "Design Studio permission was denied."
    );
  }
}

export type TenantMaterialSnapshot = {
  snapshot: MaterialIntelligenceSnapshot;
  tenantAccessible: boolean;
};

export interface TenantMaterialSnapshotSource {
  loadApprovedForTenant(
    tenantId: string,
    materialIds: readonly string[]
  ): Promise<readonly TenantMaterialSnapshot[]>;
}

/** Application boundary: tenant ID and current permissions are mandatory on every operation. */
export class DesignStudioApplication {
  constructor(private readonly snapshots: TenantMaterialSnapshotSource) {}

  planAccordArchitecture(
    context: DesignStudioTenantContext,
    input: { projectId: string; sourceBriefId: string; confirmedIntent: ConfirmedIntent }
  ): AccordArchitecturePlan {
    requireDesignStudioPermission(context, designStudioPermissions.planAccord);
    return buildAccordArchitecture(input);
  }

  async generateFormula(
    context: DesignStudioTenantContext,
    input: {
      projectId: string;
      sourceBriefId: string;
      confirmedIntent: ConfirmedIntent;
      materialIds: readonly string[];
      budget: BudgetContext;
      scorer: FormulaPerceptionScorer;
      costResolver?: CostResolver;
    }
  ): Promise<FormulaCandidate[]> {
    requireDesignStudioPermission(context, designStudioPermissions.generateFormula);
    const records = await this.snapshots.loadApprovedForTenant(context.tenantId, input.materialIds);
    const evidence = records.map((record) =>
      createMaterialCandidateEvidence({
        snapshot: record.snapshot,
        tenantAccessible: record.tenantAccessible,
        intent: input.confirmedIntent.intent
      })
    );
    return generateFormulaCandidates({ ...input, evidence });
  }

  freezeFormula(context: DesignStudioTenantContext): never {
    requireDesignStudioPermission(context, designStudioPermissions.freezeFormula);
    throw new DesignStudioProblem(
      503,
      "FORMULA_FROZEN_SNAPSHOT_SCHEMA_MISSING",
      "Formula Freeze persistence is blocked until the canonical schema is supplied."
    );
  }
}
