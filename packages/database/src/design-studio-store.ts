import type { Sql, TransactionSql } from "postgres";
import {
  DesignStudioProblem,
  computeFormulaBundleHash,
  formulaCandidateSchema,
  taxonomyTargetKey,
  type AccordArchitecturePlan,
  type DesignBrief,
  type DesignProject,
  type DesignStudioStore,
  type FrozenFormulaVersion,
  type FreezeFormulaInput,
  type TenantMaterialSnapshotSource
} from "@nox-os/design-studio";
import {
  buildMaterialSnapshot,
  canReadMaterial,
  type MaterialAggregate,
  type MaterialStore
} from "@nox-os/material-intelligence";
import { createPostgresMaterialStore } from "./material-store.js";

type SqlExecutor = Sql | TransactionSql;

function databaseJson(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never;
}

type ProjectRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: DesignProject["status"];
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};
type BriefRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workflow_mode: DesignBrief["workflowMode"];
  status: DesignBrief["status"];
  raw_brief: string;
  brief_payload: Record<string, unknown>;
  normalized_intent: DesignBrief["normalizedIntent"];
  accord_architecture_plan: DesignBrief["accordArchitecturePlan"];
  confirmed_by_user_id: string | null;
  confirmed_at: Date | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};
type FrozenRow = {
  formula_id: string;
  formula_version_id: string;
  tenant_id: string;
  project_id: string;
  source_brief_id: string;
  name: string;
  version_number: number;
  composition_kind: FrozenFormulaVersion["compositionKind"];
  generation_strategy: string;
  engine_version: string;
  intent_snapshot: FrozenFormulaVersion["candidate"]["intentSnapshot"];
  resolved_composition: FrozenFormulaVersion["candidate"]["resolvedComposition"];
  validation: FrozenFormulaVersion["candidate"]["validation"];
  scientific_context: FrozenFormulaVersion["candidate"]["scientificContext"];
  approval_state: FrozenFormulaVersion["approvalState"];
  bundle_hash: string;
  frozen_at: Date;
};
type LineRow = {
  material_id: string;
  normalized_mass_mg: bigint | string;
  active_aromatic_mass_mg: bigint | string;
  carrier_solvent_mass_mg: bigint | string;
  solvent_type: string | null;
  contribution_evidence: FrozenFormulaVersion["candidate"]["lines"][number]["contributionEvidence"];
  snapshot_hash: string;
  snapshot_payload: FrozenFormulaVersion["candidate"]["lines"][number]["materialSnapshot"];
};

function project(row: ProjectRow): DesignProject {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function brief(row: BriefRow): DesignBrief {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workflowMode: row.workflow_mode,
    status: row.status,
    rawBrief: row.raw_brief,
    briefPayload: row.brief_payload,
    normalizedIntent: row.normalized_intent,
    accordArchitecturePlan: row.accord_architecture_plan,
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedAt: row.confirmed_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class PostgresDesignStudioStore implements DesignStudioStore {
  constructor(private readonly sql: SqlExecutor) {}

  async createProject(input: {
    tenantId: string;
    name: string;
    description: string | null;
    actorUserId: string;
  }): Promise<DesignProject> {
    const rows = await this.sql<ProjectRow[]>`
      insert into design_studio.projects (tenant_id, name, description, created_by_user_id)
      values (${input.tenantId}, ${input.name}, ${input.description}, ${input.actorUserId})
      returning id, tenant_id, name, description, status, created_by_user_id, created_at, updated_at
    `;
    return project(rows[0]);
  }

  async listProjects(tenantId: string): Promise<DesignProject[]> {
    const rows = await this.sql<ProjectRow[]>`
      select id, tenant_id, name, description, status, created_by_user_id, created_at, updated_at
      from design_studio.projects
      where tenant_id = ${tenantId}
      order by updated_at desc, id
    `;
    return rows.map(project);
  }

  async findProject(tenantId: string, projectId: string): Promise<DesignProject | undefined> {
    const rows = await this.sql<ProjectRow[]>`
      select id, tenant_id, name, description, status, created_by_user_id, created_at, updated_at
      from design_studio.projects
      where tenant_id = ${tenantId} and id = ${projectId}
    `;
    return rows[0] ? project(rows[0]) : undefined;
  }

  async createBrief(input: {
    tenantId: string;
    projectId: string;
    workflowMode: DesignBrief["workflowMode"];
    rawBrief: string;
    briefPayload: Record<string, unknown>;
    normalizedIntent: NonNullable<DesignBrief["normalizedIntent"]>;
    actorUserId: string;
  }): Promise<DesignBrief> {
    const rows = await this.sql<BriefRow[]>`
      insert into design_studio.design_briefs (
        tenant_id, project_id, workflow_mode, raw_brief, brief_payload,
        normalized_intent, created_by_user_id
      ) values (
        ${input.tenantId}, ${input.projectId}, ${input.workflowMode}, ${input.rawBrief},
        ${this.sql.json(databaseJson(input.briefPayload))}, ${this.sql.json(databaseJson(input.normalizedIntent))},
        ${input.actorUserId}
      )
      returning id, tenant_id, project_id, workflow_mode, status, raw_brief, brief_payload,
                normalized_intent, accord_architecture_plan, confirmed_by_user_id, confirmed_at,
                created_by_user_id, created_at, updated_at
    `;
    return brief(rows[0]);
  }

  async findBrief(tenantId: string, briefId: string): Promise<DesignBrief | undefined> {
    const rows = await this.sql<BriefRow[]>`
      select id, tenant_id, project_id, workflow_mode, status, raw_brief, brief_payload,
             normalized_intent, accord_architecture_plan, confirmed_by_user_id, confirmed_at,
             created_by_user_id, created_at, updated_at
      from design_studio.design_briefs
      where tenant_id = ${tenantId} and id = ${briefId}
    `;
    return rows[0] ? brief(rows[0]) : undefined;
  }

  async updateBrief(input: {
    tenantId: string;
    briefId: string;
    rawBrief?: string;
    briefPayload?: Record<string, unknown>;
    normalizedIntent?: NonNullable<DesignBrief["normalizedIntent"]>;
    accordArchitecturePlan?: AccordArchitecturePlan;
  }): Promise<DesignBrief | undefined> {
    const rows = await this.sql<BriefRow[]>`
      update design_studio.design_briefs set
        raw_brief = case when ${input.rawBrief === undefined} then raw_brief else ${input.rawBrief ?? null} end,
        brief_payload = case when ${input.briefPayload === undefined} then brief_payload else ${this.sql.json(databaseJson(input.briefPayload ?? {}))} end,
        normalized_intent = case when ${input.normalizedIntent === undefined} then normalized_intent else ${this.sql.json(input.normalizedIntent ?? {})} end,
        accord_architecture_plan = case when ${input.accordArchitecturePlan === undefined} then accord_architecture_plan else ${this.sql.json(input.accordArchitecturePlan ?? {})} end,
        updated_at = now()
      where tenant_id = ${input.tenantId} and id = ${input.briefId} and status <> 'ARCHIVED'
      returning id, tenant_id, project_id, workflow_mode, status, raw_brief, brief_payload,
                normalized_intent, accord_architecture_plan, confirmed_by_user_id, confirmed_at,
                created_by_user_id, created_at, updated_at
    `;
    return rows[0] ? brief(rows[0]) : undefined;
  }

  async confirmBrief(input: {
    tenantId: string;
    briefId: string;
    intent: NonNullable<DesignBrief["normalizedIntent"]>;
    actorUserId: string;
  }): Promise<DesignBrief | undefined> {
    const rows = await this.sql<BriefRow[]>`
      update design_studio.design_briefs set
        status = 'INTENT_CONFIRMED', normalized_intent = ${this.sql.json(input.intent)},
        confirmed_by_user_id = ${input.actorUserId}, confirmed_at = now(), updated_at = now()
      where tenant_id = ${input.tenantId} and id = ${input.briefId} and status = 'DRAFT'
      returning id, tenant_id, project_id, workflow_mode, status, raw_brief, brief_payload,
                normalized_intent, accord_architecture_plan, confirmed_by_user_id, confirmed_at,
                created_by_user_id, created_at, updated_at
    `;
    return rows[0] ? brief(rows[0]) : undefined;
  }

  async freezeFormula(input: FreezeFormulaInput): Promise<FrozenFormulaVersion> {
    if (!("begin" in this.sql))
      throw new Error("Freeze requires a transaction-capable SQL client.");
    return (await this.sql.begin(async (tx) => {
      for (const snapshot of input.freshSnapshots) {
        const rows = await tx<{ approval_status: string; updated_at: Date }[]>`
          select approval_status, updated_at
          from material_intelligence.materials
          where id = ${snapshot.material.id}
          for share
        `;
        if (
          rows[0]?.approval_status !== "APPROVED" ||
          rows[0].updated_at.toISOString() !== snapshot.sourceMaterialUpdatedAt
        ) {
          throw new DesignStudioProblem(
            409,
            "MATERIAL_INELIGIBLE",
            "Material state changed before Formula Freeze."
          );
        }
      }
      const formulaRows = await tx<{ id: string }[]>`
        insert into design_studio.formulas (
          tenant_id, project_id, source_brief_id, name, composition_kind, created_by_user_id
        ) values (
          ${input.tenantId}, ${input.projectId}, ${input.sourceBriefId}, ${input.formulaName},
          ${input.candidate.compositionKind}, ${input.actorUserId}
        ) returning id
      `;
      const formulaId = formulaRows[0].id;
      const versionRows = await tx<{ id: string }[]>`
        insert into design_studio.formula_versions (
          tenant_id, formula_id, version_number, generation_strategy, engine_version,
          intent_snapshot, resolved_composition, validation, scientific_context,
          created_by_user_id
        ) values (
          ${input.tenantId}, ${formulaId}, 1, ${input.candidate.generationStrategy},
          ${input.candidate.engineVersion}, ${tx.json(input.candidate.intentSnapshot)},
          ${tx.json(input.candidate.resolvedComposition)}, ${tx.json(input.candidate.validation)},
          ${tx.json(input.candidate.scientificContext)}, ${input.actorUserId}
        ) returning id
      `;
      const formulaVersionId = versionRows[0].id;
      const snapshotByMaterial = new Map(
        input.freshSnapshots.map((snapshot) => [snapshot.material.id, snapshot])
      );
      for (const [index, line] of input.candidate.lines.entries()) {
        const snapshot = snapshotByMaterial.get(line.materialId);
        if (!snapshot || snapshot.snapshotHash !== line.materialSnapshot.snapshotHash) {
          throw new DesignStudioProblem(
            409,
            "MATERIAL_INELIGIBLE",
            "Formula candidate does not match fresh Material truth."
          );
        }
        await tx`
          insert into design_studio.formula_lines (
            tenant_id, formula_version_id, material_id, line_order, normalized_mass_mg,
            active_aromatic_mass_mg, carrier_solvent_mass_mg, solvent_type,
            contribution_evidence, material_snapshot_hash
          ) values (
            ${input.tenantId}, ${formulaVersionId}, ${line.materialId}, ${index + 1},
            ${line.normalizedMassMg}, ${line.activeAromaticMassMg},
            ${line.carrierSolventMassMg}, ${line.solventType ?? null},
            ${tx.json(line.contributionEvidence)}, ${snapshot.snapshotHash}
          )
        `;
        await tx`
          insert into design_studio.formula_frozen_snapshots (
            tenant_id, formula_version_id, material_id, snapshot_hash, snapshot_payload, captured_at
          ) values (
            ${input.tenantId}, ${formulaVersionId}, ${line.materialId}, ${snapshot.snapshotHash},
            ${tx.json(databaseJson(snapshot))}, ${snapshot.capturedAt}
          )
        `;
      }
      const bundleHash = computeFormulaBundleHash(
        input.candidate.compositionKind,
        input.candidate.lines.map((line) => ({
          materialId: line.materialId,
          normalizedMassMg: line.normalizedMassMg,
          snapshotHash: line.materialSnapshot.snapshotHash
        }))
      );
      const frozenRows = await tx<{ frozen_at: Date }[]>`
        update design_studio.formula_versions set
          status = 'FROZEN', bundle_hash = ${bundleHash},
          frozen_by_user_id = ${input.actorUserId}, frozen_at = now()
        where tenant_id = ${input.tenantId} and id = ${formulaVersionId} and status = 'DRAFT'
        returning frozen_at
      `;
      await tx`
        insert into platform.audit_events (
          tenant_id, actor_user_id, action, resource_type, resource_id,
          request_id, correlation_id, metadata
        ) values (
          ${input.tenantId}, ${input.actorUserId}, 'formula.frozen',
          'FormulaVersion', ${formulaVersionId}, ${input.requestId}, ${input.correlationId},
          ${tx.json({ formulaId, bundleHash, compositionKind: input.candidate.compositionKind })}
        )
      `;
      return {
        formulaId,
        formulaVersionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        sourceBriefId: input.sourceBriefId,
        name: input.formulaName,
        versionNumber: 1,
        compositionKind: input.candidate.compositionKind,
        generationStrategy: input.candidate.generationStrategy,
        engineVersion: input.candidate.engineVersion,
        status: "FROZEN" as const,
        approvalState: "NOT_APPROVED" as const,
        bundleHash,
        candidate: input.candidate,
        frozenAt: frozenRows[0].frozen_at
      };
    })) as FrozenFormulaVersion;
  }

  async findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined> {
    const rows = await this.sql<FrozenRow[]>`
      select f.id as formula_id, v.id as formula_version_id, v.tenant_id, f.project_id,
             f.source_brief_id, f.name, v.version_number, f.composition_kind,
             v.generation_strategy, v.engine_version, v.intent_snapshot,
             v.resolved_composition, v.validation, v.scientific_context,
             v.approval_state, v.bundle_hash, v.frozen_at
      from design_studio.formula_versions as v
      join design_studio.formulas as f on f.tenant_id = v.tenant_id and f.id = v.formula_id
      where v.tenant_id = ${tenantId} and v.id = ${formulaVersionId} and v.status = 'FROZEN'
    `;
    const row = rows[0];
    if (!row) return undefined;
    const lines = await this.sql<LineRow[]>`
      select l.material_id, l.normalized_mass_mg, l.active_aromatic_mass_mg,
             l.carrier_solvent_mass_mg, l.solvent_type, l.contribution_evidence,
             s.snapshot_hash, s.snapshot_payload
      from design_studio.formula_lines as l
      join design_studio.formula_frozen_snapshots as s
        on s.tenant_id = l.tenant_id and s.formula_version_id = l.formula_version_id
       and s.material_id = l.material_id
      where l.tenant_id = ${tenantId} and l.formula_version_id = ${formulaVersionId}
      order by l.line_order
    `;
    const candidate = formulaCandidateSchema.parse({
      candidateId: formulaVersionId,
      projectId: row.project_id,
      sourceBriefId: row.source_brief_id,
      compositionKind: row.composition_kind,
      referenceFormulaMassMg: "1000000",
      generationStrategy: row.generation_strategy,
      engineVersion: row.engine_version,
      taxonomySource: "OSMO",
      taxonomyVersion: "osmo_v1.2",
      intentSnapshot: row.intent_snapshot,
      lines: lines.map((line) => ({
        materialId: line.material_id,
        normalizedMassMg: String(line.normalized_mass_mg),
        activeAromaticMassMg: String(line.active_aromatic_mass_mg),
        carrierSolventMassMg: String(line.carrier_solvent_mass_mg),
        ...(line.solvent_type ? { solventType: line.solvent_type } : {}),
        contributionEvidence: line.contribution_evidence,
        materialSnapshot: line.snapshot_payload
      })),
      resolvedComposition: row.resolved_composition,
      validation: row.validation,
      scientificContext: row.scientific_context
    });
    return {
      formulaId: row.formula_id,
      formulaVersionId: row.formula_version_id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      sourceBriefId: row.source_brief_id,
      name: row.name,
      versionNumber: row.version_number,
      compositionKind: row.composition_kind,
      generationStrategy: row.generation_strategy,
      engineVersion: row.engine_version,
      status: "FROZEN",
      approvalState: row.approval_state,
      bundleHash: row.bundle_hash,
      candidate,
      frozenAt: row.frozen_at
    };
  }

  async approveFrozenFormulaVersion(input: {
    tenantId: string;
    formulaVersionId: string;
    actorUserId: string;
    requestId: string;
    correlationId: string;
  }): Promise<FrozenFormulaVersion | undefined> {
    if (!("begin" in this.sql))
      throw new Error("Approval requires a transaction-capable SQL client.");
    const changed = await this.sql.begin(async (tx) => {
      const rows = await tx<{ formula_id: string; composition_kind: string }[]>`
        update design_studio.formula_versions as version set
          approval_state = 'APPROVED', approved_by_user_id = ${input.actorUserId},
          approved_at = now()
        from design_studio.formulas as formula
        where version.tenant_id = ${input.tenantId}
          and version.id = ${input.formulaVersionId}
          and version.status = 'FROZEN'
          and version.approval_state = 'NOT_APPROVED'
          and formula.tenant_id = version.tenant_id
          and formula.id = version.formula_id
        returning version.formula_id, formula.composition_kind
      `;
      if (!rows[0]) return false;
      await tx`
        insert into platform.audit_events (
          tenant_id, actor_user_id, action, resource_type, resource_id,
          request_id, correlation_id, metadata
        ) values (
          ${input.tenantId}, ${input.actorUserId}, 'formula.approved', 'FormulaVersion',
          ${input.formulaVersionId}, ${input.requestId}, ${input.correlationId},
          ${tx.json({ formulaId: rows[0].formula_id, compositionKind: rows[0].composition_kind })}
        )
      `;
      return true;
    });
    return changed
      ? this.findFrozenFormulaVersion(input.tenantId, input.formulaVersionId)
      : undefined;
  }

  async recordAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    await this.sql`
      insert into platform.audit_events (
        tenant_id, actor_user_id, action, resource_type, resource_id,
        request_id, correlation_id, metadata
      ) values (
        ${input.tenantId}, ${input.actorUserId}, ${input.action}, ${input.resourceType},
        ${input.resourceId}, ${input.requestId}, ${input.correlationId},
        ${this.sql.json(databaseJson(input.metadata ?? {}))}
      )
    `;
  }
}

async function hasRecursiveComponentCycle(
  root: MaterialAggregate,
  store: MaterialStore,
  tenantId: string
): Promise<boolean> {
  const visiting = new Set<string>();
  const complete = new Set<string>();
  const traverse = async (aggregate: MaterialAggregate): Promise<boolean> => {
    if (visiting.has(aggregate.material.id)) return true;
    if (complete.has(aggregate.material.id)) return false;
    visiting.add(aggregate.material.id);
    for (const component of aggregate.components) {
      const nested = await store.findMaterialAggregate(component.componentMaterialId, false);
      if (
        !nested ||
        nested.material.approvalStatus !== "APPROVED" ||
        !canReadMaterial({ tenantId, platformAuthority: false }, nested.material) ||
        (await traverse(nested))
      ) {
        return true;
      }
    }
    visiting.delete(aggregate.material.id);
    complete.add(aggregate.material.id);
    return false;
  };
  return traverse(root);
}

export class PostgresMaterialCandidateRetriever implements TenantMaterialSnapshotSource {
  constructor(private readonly materials: MaterialStore) {}

  async retrieveApprovedForTenant(
    input: Parameters<TenantMaterialSnapshotSource["retrieveApprovedForTenant"]>[0]
  ) {
    const aggregates = await this.materials.searchMaterials(
      { approvalStatus: "APPROVED", limit: 250, offset: 0 },
      { tenantId: input.tenantId, platformAuthority: false }
    );
    const desired = new Set(
      [...input.intent.required, ...input.intent.preferred, ...input.intent.inferred].map(
        taxonomyTargetKey
      )
    );
    const excluded = new Set(input.intent.excluded.map(taxonomyTargetKey));
    let missingGuidance = 0;
    const result = [];
    for (const aggregate of aggregates) {
      const odorKeys = new Set(
        aggregate.odorAssignments.map((assignment) =>
          taxonomyTargetKey({
            assignmentType: assignment.assignmentType,
            taxonomyTerm: assignment.taxonomyTerm
          })
        )
      );
      if ([...excluded].some((key) => odorKeys.has(key))) continue;
      if (desired.size > 0 && ![...desired].some((key) => odorKeys.has(key))) continue;
      const guidance = aggregate.formulationGuidance?.some(
        (item) => item.applicationKey === input.applicationKey && item.maxFormulaPct > 0
      );
      if (!guidance) {
        missingGuidance += 1;
        continue;
      }
      if (await hasRecursiveComponentCycle(aggregate, this.materials, input.tenantId)) continue;
      result.push({ snapshot: buildMaterialSnapshot(aggregate, false), tenantAccessible: true });
      if (result.length >= 64) break;
    }
    if (result.length === 0 && missingGuidance > 0) {
      throw new DesignStudioProblem(
        409,
        "FORMULATION_GUIDANCE_MISSING",
        "Matching Materials lack approved guidance for this application."
      );
    }
    return result;
  }
}

export function createPostgresDesignStudioStore(sql: Sql): DesignStudioStore {
  return new PostgresDesignStudioStore(sql);
}

export function createPostgresMaterialCandidateRetriever(sql: Sql): TenantMaterialSnapshotSource {
  return new PostgresMaterialCandidateRetriever(createPostgresMaterialStore(sql));
}
