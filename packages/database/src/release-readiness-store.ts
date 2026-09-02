import type { Sql, TransactionSql } from "postgres";
import type { FrozenFormulaVersion } from "@nox-os/design-studio";
import { createPostgresDesignStudioStore } from "./design-studio-store.js";
import { createPostgresMaterialStore } from "./material-store.js";
import type { ProductionReadinessResolution, ProductionReadinessSource } from "@nox-os/production";
import { canReadMaterial } from "@nox-os/material-intelligence";
import {
  RELEASE_READINESS_POLICY_KEY,
  RELEASE_READINESS_POLICY_VERSION,
  tenantSafeCurrentRegulatoryProjection,
  type ApprovalTraceEvidence,
  type RegulatoryEvidenceSnapshot,
  type ReleaseAssessment,
  type ReleaseCheckResult,
  type ReleaseReadinessStore,
  type RegulatoryEvidenceResolver,
  type ApprovalTraceResolver,
  type ReleaseFormulaSource
} from "@nox-os/release-readiness";

type SqlExecutor = Sql | TransactionSql;

function databaseJson(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never;
}

type AssessmentRow = {
  id: string;
  tenant_id: string;
  formula_version_id: string;
  formula_bundle_hash: string;
  policy_key: typeof RELEASE_READINESS_POLICY_KEY;
  policy_version: typeof RELEASE_READINESS_POLICY_VERSION;
  release_profile: ReleaseAssessment["releaseProfile"];
  evidence_snapshot: ReleaseAssessment["evidenceSnapshot"];
  decision: ReleaseAssessment["decision"];
  created_by_user_id: string;
  assessed_by_user_id: string;
  supersedes_assessment_id: string | null;
  created_at: Date;
  assessed_at: Date;
};

type CheckRow = {
  check_key: string;
  subject_type: ReleaseCheckResult["subjectType"];
  material_id: string | null;
  result: ReleaseCheckResult["result"];
  evidence: ReleaseCheckResult["evidence"];
  message: string;
};

function check(row: CheckRow): ReleaseCheckResult {
  return {
    checkKey: row.check_key,
    subjectType: row.subject_type,
    materialId: row.material_id,
    result: row.result,
    evidence: row.evidence,
    message: row.message
  };
}

function assessment(row: AssessmentRow, checks: readonly ReleaseCheckResult[]): ReleaseAssessment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    formulaVersionId: row.formula_version_id,
    formulaBundleHash: row.formula_bundle_hash,
    policyKey: row.policy_key,
    policyVersion: row.policy_version,
    releaseProfile: row.release_profile,
    evidenceSnapshot: row.evidence_snapshot,
    decision: row.decision,
    createdByUserId: row.created_by_user_id,
    assessedByUserId: row.assessed_by_user_id,
    supersedesAssessmentId: row.supersedes_assessment_id,
    createdAt: row.created_at,
    assessedAt: row.assessed_at,
    checks
  };
}

class PostgresReleaseReadinessStore implements ReleaseReadinessStore {
  constructor(private readonly sql: SqlExecutor) {}

  async listAssessments(tenantId: string): Promise<ReleaseAssessment[]> {
    const rows = await this.sql<AssessmentRow[]>`
      select id, tenant_id, formula_version_id, formula_bundle_hash, policy_key,
             policy_version, release_profile, evidence_snapshot, decision, created_by_user_id,
             assessed_by_user_id, supersedes_assessment_id, created_at, assessed_at
      from release_readiness.assessments
      where tenant_id = ${tenantId}
      order by assessed_at desc, id
    `;
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async findAssessment(
    tenantId: string,
    assessmentId: string
  ): Promise<ReleaseAssessment | undefined> {
    const rows = await this.sql<AssessmentRow[]>`
      select id, tenant_id, formula_version_id, formula_bundle_hash, policy_key,
             policy_version, release_profile, evidence_snapshot, decision, created_by_user_id,
             assessed_by_user_id, supersedes_assessment_id, created_at, assessed_at
      from release_readiness.assessments
      where tenant_id = ${tenantId} and id = ${assessmentId}
    `;
    return rows[0] ? this.hydrate(rows[0]) : undefined;
  }

  async createFinalAssessment(
    input: Parameters<ReleaseReadinessStore["createFinalAssessment"]>[0]
  ): Promise<ReleaseAssessment> {
    if (!("begin" in this.sql)) {
      throw new Error("Release assessment requires a transaction-capable SQL client.");
    }
    return this.sql.begin(async (tx) => {
      if (input.supersedesAssessmentId) {
        const lineage = await tx<{ id: string }[]>`
          select id from release_readiness.assessments
          where tenant_id = ${input.context.tenantId}
            and id = ${input.supersedesAssessmentId}
            and formula_version_id = ${input.formulaVersionId}
        `;
        if (!lineage[0]) throw new Error("ASSESSMENT_LINEAGE_INVALID");
      }
      const rows = await tx<AssessmentRow[]>`
        insert into release_readiness.assessments (
          tenant_id, formula_version_id, formula_bundle_hash, policy_key, policy_version,
          release_profile, evidence_snapshot, decision, expected_check_count, created_by_user_id,
          assessed_by_user_id, supersedes_assessment_id
        ) values (
          ${input.context.tenantId}, ${input.formulaVersionId}, ${input.formulaBundleHash},
          ${RELEASE_READINESS_POLICY_KEY}, ${RELEASE_READINESS_POLICY_VERSION},
          ${tx.json(databaseJson(input.releaseProfile))},
          ${tx.json(databaseJson(input.evidenceSnapshot))}, ${input.decision}, ${input.checks.length},
          ${input.context.actorUserId}, ${input.context.actorUserId},
          ${input.supersedesAssessmentId}
        ) returning id, tenant_id, formula_version_id, formula_bundle_hash, policy_key,
          policy_version, release_profile, evidence_snapshot, decision, created_by_user_id,
          assessed_by_user_id, supersedes_assessment_id, created_at, assessed_at
      `;
      const row = rows[0];
      for (const [index, result] of input.checks.entries()) {
        await tx`
          insert into release_readiness.checks (
            tenant_id, assessment_id, check_order, check_key, subject_type, material_id,
            result, evidence, message
          ) values (
            ${input.context.tenantId}, ${row.id}, ${index + 1}, ${result.checkKey},
            ${result.subjectType}, ${result.materialId}, ${result.result},
            ${tx.json(databaseJson(result.evidence))}, ${result.message}
          )
        `;
      }
      await tx`
        insert into platform.audit_events (
          tenant_id, actor_user_id, action, resource_type, resource_id,
          request_id, correlation_id, metadata
        ) values (
          ${input.context.tenantId}, ${input.context.actorUserId}, ${input.auditAction},
          'ReleaseAssessment', ${row.id}, ${input.context.requestId},
          ${input.context.correlationId}, ${tx.json(
            databaseJson({
              formulaVersionId: input.formulaVersionId,
              policyKey: RELEASE_READINESS_POLICY_KEY,
              policyVersion: RELEASE_READINESS_POLICY_VERSION,
              decision: input.decision,
              supersedesAssessmentId: input.supersedesAssessmentId
            })
          )}
        )
      `;
      return assessment(row, input.checks);
    });
  }

  private async hydrate(row: AssessmentRow): Promise<ReleaseAssessment> {
    const rows = await this.sql<CheckRow[]>`
      select check_key, subject_type, material_id, result, evidence, message
      from release_readiness.checks
      where tenant_id = ${row.tenant_id} and assessment_id = ${row.id}
      order by check_order
    `;
    return assessment(row, rows.map(check));
  }
}

/** Narrow, read-only bridge for Production. It never creates or mutates a readiness assessment. */
export class PostgresProductionReadinessSource implements ProductionReadinessSource {
  constructor(private readonly sql: SqlExecutor) {}

  async resolveCurrentForFormula(input: {
    tenantId: string;
    formulaVersionId: string;
    formulaBundleHash: string;
  }): Promise<ProductionReadinessResolution> {
    const rows = await this.sql<
      { id: string; decision: "READY" | "REVIEW_REQUIRED" | "BLOCKED" }[]
    >`
      select assessment.id, assessment.decision
      from release_readiness.assessments assessment
      where assessment.tenant_id = ${input.tenantId}
        and assessment.formula_version_id = ${input.formulaVersionId}
        and assessment.formula_bundle_hash = ${input.formulaBundleHash}
        and not exists (
          select 1 from release_readiness.assessments successor
          where successor.tenant_id = assessment.tenant_id
            and successor.supersedes_assessment_id = assessment.id
        )
      order by assessment.assessed_at desc, assessment.id
    `;
    if (rows.length === 0) return { status: "MISSING" };
    if (rows.length !== 1) return { status: "AMBIGUOUS" };
    return { status: "RESOLVED", assessmentId: rows[0].id, decision: rows[0].decision };
  }
}

export function createPostgresProductionReadinessSource(sql: Sql): ProductionReadinessSource {
  return new PostgresProductionReadinessSource(sql);
}

class PostgresReleaseReadinessSources
  implements ReleaseFormulaSource, RegulatoryEvidenceResolver, ApprovalTraceResolver
{
  private readonly formulas;

  constructor(private readonly sql: Sql) {
    this.formulas = createPostgresDesignStudioStore(sql);
  }

  findFrozenFormulaVersion(
    tenantId: string,
    formulaVersionId: string
  ): Promise<FrozenFormulaVersion | undefined> {
    return this.formulas.findFrozenFormulaVersion(tenantId, formulaVersionId);
  }

  async resolve(input: {
    tenantId: string;
    formula: FrozenFormulaVersion;
  }): Promise<RegulatoryEvidenceSnapshot> {
    return this.sql.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read read only`;
      const materialStore = createPostgresMaterialStore(transaction as unknown as Sql);
      const materials = await Promise.all(
        input.formula.candidate.lines.map(async (line) => {
          const aggregate = await materialStore.findMaterialAggregate(line.materialId, false);
          const tenantAccessible = Boolean(
            aggregate &&
            canReadMaterial(
              { tenantId: input.tenantId, platformAuthority: false },
              aggregate.material
            )
          );
          const properties = aggregate?.properties;
          const safeCurrent = tenantSafeCurrentRegulatoryProjection({
            tenantAccessible,
            frozenDisplayName: line.materialSnapshot.material.displayName,
            frozenMaterialType: line.materialSnapshot.material.materialType,
            current: aggregate
              ? {
                  displayName: aggregate.material.displayName,
                  materialType: aggregate.material.materialType,
                  approvalStatus: aggregate.material.approvalStatus,
                  sourceMaterialUpdatedAt: new Date(
                    Math.max(
                      aggregate.material.updatedAt.getTime(),
                      properties?.updatedAt.getTime() ?? 0
                    )
                  ).toISOString(),
                  ifraRestricted: properties?.ifraRestricted ?? false,
                  ifraCat4MaxPct:
                    properties?.ifraCat4MaxPct == null ? null : String(properties.ifraCat4MaxPct),
                  ifraLimits: properties?.ifraLimits ?? {},
                  ifraAmendment: properties?.ifraAmendment ?? null,
                  ifraSourceReference: properties?.ifraSourceReference ?? null,
                  sourceReference: properties?.sourceReference ?? null,
                  euAllergens: properties?.euAllergens ?? []
                }
              : undefined
          });
          return {
            materialId: line.materialId,
            tenantAccessible,
            frozenSnapshotHash: line.materialSnapshot.snapshotHash,
            frozenSourceMaterialUpdatedAt: line.materialSnapshot.sourceMaterialUpdatedAt,
            activeAromaticMassMg: line.activeAromaticMassMg,
            carrierSolventMassMg: line.carrierSolventMassMg,
            ...safeCurrent
          };
        })
      );
      return {
        resolvedAt: new Date().toISOString(),
        formulaVersionId: input.formula.formulaVersionId,
        formulaBundleHash: input.formula.bundleHash,
        compositionKind: input.formula.compositionKind,
        formulaStatus: input.formula.status,
        approvalState: input.formula.approvalState,
        referenceFormulaMassMg: input.formula.candidate.referenceFormulaMassMg,
        formulaLineCount: input.formula.candidate.lines.length,
        approvalTrace: {
          verified: false,
          sourceTrialId: null,
          sourceEvaluationId: null,
          decision: null,
          finalizedAt: null
        },
        materials
      };
    });
  }

  async resolveApprovalTrace(input: {
    tenantId: string;
    formulaVersionId: string;
  }): Promise<ApprovalTraceEvidence> {
    const rows = await this.sql<
      {
        source_trial_id: string;
        source_evaluation_id: string;
        decision: "READY_FOR_APPROVAL";
        finalized_at: Date;
      }[]
    >`
      select trial.id::text as source_trial_id, evaluation.id::text as source_evaluation_id,
             evaluation.decision, evaluation.finalized_at
      from platform.audit_events as audit
      join trial_sensory.trials as trial
        on trial.tenant_id = audit.tenant_id
       and trial.id::text = audit.metadata ->> 'sourceTrialId'
       and trial.formula_version_id::text = audit.resource_id
      join trial_sensory.sensory_evaluations as evaluation
        on evaluation.tenant_id = trial.tenant_id
       and evaluation.trial_id = trial.id
       and evaluation.id::text = audit.metadata ->> 'sourceEvaluationId'
      where audit.tenant_id = ${input.tenantId}
        and audit.action = 'formula.approved'
        and audit.resource_type = 'FormulaVersion'
        and audit.resource_id = ${input.formulaVersionId}
        and trial.status = 'COMPLETED'
        and evaluation.status = 'FINAL'
        and evaluation.decision = 'READY_FOR_APPROVAL'
      order by audit.created_at desc
      limit 1
    `;
    const row = rows[0];
    return row
      ? {
          verified: true,
          sourceTrialId: row.source_trial_id,
          sourceEvaluationId: row.source_evaluation_id,
          decision: row.decision,
          finalizedAt: row.finalized_at.toISOString()
        }
      : {
          verified: false,
          sourceTrialId: null,
          sourceEvaluationId: null,
          decision: null,
          finalizedAt: null
        };
  }
}

export function createPostgresReleaseReadinessStore(sql: Sql): ReleaseReadinessStore {
  return new PostgresReleaseReadinessStore(sql);
}

export function createPostgresReleaseReadinessSources(sql: Sql) {
  return new PostgresReleaseReadinessSources(sql);
}
