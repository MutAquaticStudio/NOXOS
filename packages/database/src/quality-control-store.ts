import type { Sql, TransactionSql } from "postgres";
import type {
  BatchDisposition,
  BatchInspection,
  BatchInspectionResult,
  BatchReleaseDecision,
  BatchSpecification,
  BatchSpecificationItem,
  InspectionResultInput,
  QualityBatchReference,
  QualityBatchView,
  QualityCommandContext,
  QualityControlStore,
  QualityJudgement,
  QuantityMg,
  SpecificationItemInput
} from "@nox-os/quality-control";
import {
  inspectionOutcome,
  numericRangeJudgement,
  QualityControlProblem,
  requireReleaseEligibility
} from "@nox-os/quality-control";
import { PostgresProductionReadinessSource } from "./release-readiness-store.js";

type Executor = Sql | TransactionSql;
type SpecificationRow = {
  id: string;
  tenant_id: string;
  specification_code: string;
  version_number: number;
  formula_version_id: string;
  formula_bundle_hash: string;
  status: BatchSpecification["status"];
  supersedes_specification_id: string | null;
  notes: string | null;
  created_by_user_id: string;
  activated_by_user_id: string | null;
  retired_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
  retired_at: Date | null;
};
type ItemRow = {
  id: string;
  tenant_id: string;
  specification_id: string;
  item_order: number;
  check_key: string;
  name: string;
  check_type: BatchSpecificationItem["checkType"];
  unit_code: string | null;
  min_value: string | number | null;
  max_value: string | number | null;
  expected_boolean: boolean | null;
  acceptance_criteria_text: string | null;
  method_reference: string | null;
  created_at: Date;
  updated_at: Date;
};
type InspectionRow = {
  id: string;
  tenant_id: string;
  inspection_number: string;
  batch_id: string;
  specification_id: string;
  status: BatchInspection["status"];
  outcome: QualityJudgement | null;
  supersedes_inspection_id: string | null;
  sample_reference: string | null;
  retest_reason: string | null;
  notes: string | null;
  created_by_user_id: string;
  finalized_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
  cancelled_at: Date | null;
};
type ResultRow = {
  id: string;
  tenant_id: string;
  inspection_id: string;
  specification_item_id: string;
  observed_numeric_value: string | number | null;
  observed_boolean_value: boolean | null;
  observed_text: string | null;
  judgement: QualityJudgement;
  measured_by_user_id: string;
  measured_at: Date;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};
type DecisionRow = {
  id: string;
  tenant_id: string;
  batch_id: string;
  decision: BatchReleaseDecision["decision"];
  basis_inspection_id: string | null;
  release_readiness_assessment_id: string | null;
  supersedes_decision_id: string | null;
  reason: string | null;
  decided_by_user_id: string;
  decided_at: Date;
};
type BatchRow = {
  batch_id: string;
  tenant_id: string;
  batch_number: string;
  production_order_id: string;
  production_order_status: string;
  formula_version_id: string;
  formula_bundle_hash: string;
  release_readiness_assessment_id: string;
  start_readiness_assessment_id: string;
  target_mass_mg: bigint | string;
  actual_output_mass_mg: bigint | string | null;
  completed_at: Date | null;
  aborted_at: Date | null;
};
type AllocationRow = {
  material_id: string;
  inventory_lot_id: string;
  inventory_location_id: string;
  allocated_mass_mg: bigint | string;
  inventory_consumption_movement_id: string | null;
};

const decimal = (value: string | number | null): string | null =>
  value === null ? null : String(value);
const quantity = (value: bigint | string) => String(value) as QuantityMg;
const item = (row: ItemRow): BatchSpecificationItem =>
  ({
    id: row.id,
    tenantId: row.tenant_id,
    specificationId: row.specification_id,
    itemOrder: row.item_order,
    checkKey: row.check_key,
    name: row.name,
    checkType: row.check_type,
    unitCode: row.unit_code,
    minValue: decimal(row.min_value),
    maxValue: decimal(row.max_value),
    expectedBoolean: row.expected_boolean,
    acceptanceCriteriaText: row.acceptance_criteria_text,
    methodReference: row.method_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) as BatchSpecificationItem;
const result = (row: ResultRow): BatchInspectionResult => ({
  id: row.id,
  tenantId: row.tenant_id,
  inspectionId: row.inspection_id,
  specificationItemId: row.specification_item_id,
  observedNumericValue: decimal(row.observed_numeric_value),
  observedBooleanValue: row.observed_boolean_value,
  observedText: row.observed_text,
  judgement: row.judgement,
  measuredByUserId: row.measured_by_user_id,
  measuredAt: row.measured_at,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
const decision = (row: DecisionRow): BatchReleaseDecision => ({
  id: row.id,
  tenantId: row.tenant_id,
  batchId: row.batch_id,
  decision: row.decision,
  basisInspectionId: row.basis_inspection_id,
  releaseReadinessAssessmentId: row.release_readiness_assessment_id,
  supersedesDecisionId: row.supersedes_decision_id,
  reason: row.reason,
  decidedByUserId: row.decided_by_user_id,
  decidedAt: row.decided_at
});

async function hydrateSpecification(
  sql: Executor,
  row: SpecificationRow
): Promise<BatchSpecification> {
  const rows = await sql<ItemRow[]>`
    select * from quality_control.batch_specification_items
    where tenant_id = ${row.tenant_id} and specification_id = ${row.id}
    order by item_order
  `;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    specificationCode: row.specification_code,
    versionNumber: row.version_number,
    formulaVersionId: row.formula_version_id,
    formulaBundleHash: row.formula_bundle_hash,
    status: row.status,
    supersedesSpecificationId: row.supersedes_specification_id,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    activatedByUserId: row.activated_by_user_id,
    retiredByUserId: row.retired_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    retiredAt: row.retired_at,
    items: rows.map(item)
  };
}

async function hydrateInspection(sql: Executor, row: InspectionRow): Promise<BatchInspection> {
  const rows = await sql<ResultRow[]>`
    select * from quality_control.batch_inspection_results
    where tenant_id = ${row.tenant_id} and inspection_id = ${row.id}
    order by created_at, specification_item_id
  `;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    inspectionNumber: row.inspection_number,
    batchId: row.batch_id,
    specificationId: row.specification_id,
    status: row.status,
    outcome: row.outcome,
    supersedesInspectionId: row.supersedes_inspection_id,
    sampleReference: row.sample_reference,
    retestReason: row.retest_reason,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    finalizedByUserId: row.finalized_by_user_id,
    cancelledByUserId: row.cancelled_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    cancelledAt: row.cancelled_at,
    results: rows.map(result)
  };
}

async function audit(
  sql: TransactionSql,
  context: QualityCommandContext,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await sql`
    insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      request_id, correlation_id, metadata
    ) values (
      ${context.tenantId}, ${context.actorUserId}, ${action}, ${resourceType}, ${resourceId},
      ${context.requestId}, ${context.correlationId}, ${sql.json(JSON.parse(JSON.stringify(metadata)))}
    )
  `;
}

export class PostgresQualityControlStore implements QualityControlStore {
  private readonly readiness: PostgresProductionReadinessSource;
  constructor(private readonly sql: Sql) {
    this.readiness = new PostgresProductionReadinessSource(sql);
  }

  async listBatchViews(tenantId: string): Promise<QualityBatchView[]> {
    const rows = await this.sql<{ id: string }[]>`
      select batch.id from production.production_batches batch
      join production.production_orders production_order
        on production_order.tenant_id = batch.tenant_id and production_order.id = batch.production_order_id
      where batch.tenant_id = ${tenantId} and production_order.status = 'COMPLETED'
      order by batch.completed_at desc, batch.id
    `;
    return (await Promise.all(rows.map((row) => this.findBatchView(tenantId, row.id)))).filter(
      (value): value is QualityBatchView => Boolean(value)
    );
  }

  async findBatchView(tenantId: string, batchId: string): Promise<QualityBatchView | undefined> {
    const batch = await this.findBatchForQuality(tenantId, batchId);
    if (!batch) return undefined;
    const currentInspection = await this.currentInspection(this.sql, tenantId, batchId);
    const currentDecision = await this.currentDecision(this.sql, tenantId, batchId);
    return {
      batch,
      currentInspection,
      currentDecision,
      disposition: currentDecision?.decision ?? "PENDING_QC",
      currentReadiness: await this.readiness.resolveCurrentForFormula({
        tenantId,
        formulaVersionId: batch.formulaVersionId,
        formulaBundleHash: batch.formulaBundleHash
      })
    };
  }

  async findBatchForQuality(
    tenantId: string,
    batchId: string
  ): Promise<QualityBatchReference | undefined> {
    return this.findBatchWith(this.sql, tenantId, batchId);
  }

  async listSpecifications(tenantId: string): Promise<BatchSpecification[]> {
    const rows = await this.sql<SpecificationRow[]>`
      select * from quality_control.batch_specifications where tenant_id = ${tenantId}
      order by specification_code, version_number desc
    `;
    return Promise.all(rows.map((row) => hydrateSpecification(this.sql, row)));
  }

  async findSpecification(
    tenantId: string,
    specificationId: string
  ): Promise<BatchSpecification | undefined> {
    const rows = await this.sql<
      SpecificationRow[]
    >`select * from quality_control.batch_specifications where tenant_id = ${tenantId} and id = ${specificationId}`;
    return rows[0] ? hydrateSpecification(this.sql, rows[0]) : undefined;
  }

  async createSpecification(
    context: Parameters<QualityControlStore["createSpecification"]>[0]
  ): Promise<BatchSpecification> {
    const id = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        insert into quality_control.batch_specifications (
          tenant_id, specification_code, version_number, formula_version_id, formula_bundle_hash,
          supersedes_specification_id, notes, created_by_user_id
        ) values (
          ${context.tenantId}, ${context.specificationCode}, ${context.versionNumber}, ${context.formulaVersionId},
          ${context.formulaBundleHash}, ${context.supersedesSpecificationId ?? null}, ${context.notes ?? null}, ${context.actorUserId}
        ) returning id
      `;
      await audit(
        transaction,
        context,
        "quality-control.specification.created",
        "BatchSpecification",
        rows[0].id,
        { specificationCode: context.specificationCode, versionNumber: context.versionNumber }
      );
      return rows[0].id;
    });
    return (await this.findSpecification(context.tenantId, id))!;
  }

  async updateSpecification(
    context: Parameters<QualityControlStore["updateSpecification"]>[0]
  ): Promise<BatchSpecification> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        { notes: string | null }[]
      >`select notes from quality_control.batch_specifications where tenant_id = ${context.tenantId} and id = ${context.specificationId} and status = 'DRAFT' for update`;
      if (!rows[0])
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_NOT_EDITABLE",
          "Only a DRAFT specification is editable."
        );
      if (rows[0].notes === context.notes) return;
      await transaction`update quality_control.batch_specifications set notes = ${context.notes}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.specificationId}`;
      await audit(
        transaction,
        context,
        "quality-control.specification.updated",
        "BatchSpecification",
        context.specificationId
      );
    });
    return (await this.findSpecification(context.tenantId, context.specificationId))!;
  }

  async replaceSpecificationItems(
    context: Parameters<QualityControlStore["replaceSpecificationItems"]>[0]
  ): Promise<BatchSpecification> {
    await this.sql.begin(async (transaction) => {
      await this.lockDraftSpecification(transaction, context.tenantId, context.specificationId);
      const orders = new Set(context.items.map((value) => value.itemOrder));
      const keys = new Set(context.items.map((value) => value.checkKey));
      if (orders.size !== context.items.length || keys.size !== context.items.length)
        throw new QualityControlProblem(
          400,
          "QC_SPECIFICATION_ITEM_INVALID",
          "Specification item order and key must be unique."
        );
      await transaction`delete from quality_control.batch_specification_items where tenant_id = ${context.tenantId} and specification_id = ${context.specificationId}`;
      for (const value of context.items)
        await this.insertSpecificationItem(transaction, context, value);
      await audit(
        transaction,
        context,
        "quality-control.specification.updated",
        "BatchSpecification",
        context.specificationId,
        { itemCount: context.items.length }
      );
    });
    return (await this.findSpecification(context.tenantId, context.specificationId))!;
  }

  async activateSpecification(
    context: Parameters<QualityControlStore["activateSpecification"]>[0]
  ): Promise<BatchSpecification> {
    await this.sql.begin(async (transaction) => {
      const specification = await this.lockDraftSpecification(
        transaction,
        context.tenantId,
        context.specificationId
      );
      const items = await transaction<
        { count: number }[]
      >`select count(*)::int as count from quality_control.batch_specification_items where tenant_id = ${context.tenantId} and specification_id = ${context.specificationId}`;
      if (!items[0]?.count)
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_NOT_ACTIVATABLE",
          "Specification must contain at least one item."
        );
      const formula = await transaction<
        { approval_state: string; composition_kind: string; status: string; bundle_hash: string }[]
      >`
        select version.approval_state, formula.composition_kind, version.status, version.bundle_hash
        from design_studio.formula_versions version
        join design_studio.formulas formula on formula.tenant_id = version.tenant_id and formula.id = version.formula_id
        where version.tenant_id = ${context.tenantId} and version.id = ${specification.formula_version_id}
        for share of version, formula
      `;
      if (
        !formula[0] ||
        formula[0].status !== "FROZEN" ||
        formula[0].approval_state !== "APPROVED" ||
        formula[0].composition_kind !== "FULL_FORMULA" ||
        formula[0].bundle_hash !== specification.formula_bundle_hash
      ) {
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_FORMULA_MISMATCH",
          "Specification requires the exact approved FROZEN FULL_FORMULA lineage."
        );
      }
      const active = await transaction<SpecificationRow[]>`
        select * from quality_control.batch_specifications
        where tenant_id = ${context.tenantId} and formula_version_id = ${specification.formula_version_id}
          and formula_bundle_hash = ${specification.formula_bundle_hash} and status = 'ACTIVE'
        for update
      `;
      if (active[0]) {
        if (specification.supersedes_specification_id !== active[0].id)
          throw new QualityControlProblem(
            409,
            "QC_SPECIFICATION_ALREADY_ACTIVE",
            "Replacement must explicitly supersede the current ACTIVE specification."
          );
        await transaction`update quality_control.batch_specifications set status = 'RETIRED', retired_by_user_id = ${context.actorUserId}, retired_at = now(), updated_at = now() where tenant_id = ${context.tenantId} and id = ${active[0].id}`;
        await audit(
          transaction,
          context,
          "quality-control.specification.retired",
          "BatchSpecification",
          active[0].id,
          { supersededBy: context.specificationId }
        );
      } else if (specification.supersedes_specification_id) {
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_NOT_ACTIVATABLE",
          "Superseded specification is not the current ACTIVE version."
        );
      }
      await transaction`update quality_control.batch_specifications set status = 'ACTIVE', activated_by_user_id = ${context.actorUserId}, activated_at = now(), updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.specificationId}`;
      await audit(
        transaction,
        context,
        "quality-control.specification.activated",
        "BatchSpecification",
        context.specificationId,
        {
          formulaVersionId: specification.formula_version_id,
          formulaBundleHash: specification.formula_bundle_hash
        }
      );
    });
    return (await this.findSpecification(context.tenantId, context.specificationId))!;
  }

  async retireSpecification(
    context: Parameters<QualityControlStore["retireSpecification"]>[0]
  ): Promise<BatchSpecification> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        { id: string }[]
      >`select id from quality_control.batch_specifications where tenant_id = ${context.tenantId} and id = ${context.specificationId} and status = 'ACTIVE' for update`;
      if (!rows[0])
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_NOT_EDITABLE",
          "Only an ACTIVE specification may be retired."
        );
      await transaction`update quality_control.batch_specifications set status = 'RETIRED', retired_by_user_id = ${context.actorUserId}, retired_at = now(), updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.specificationId}`;
      await audit(
        transaction,
        context,
        "quality-control.specification.retired",
        "BatchSpecification",
        context.specificationId
      );
    });
    return (await this.findSpecification(context.tenantId, context.specificationId))!;
  }

  async createInspection(
    context: Parameters<QualityControlStore["createInspection"]>[0]
  ): Promise<BatchInspection> {
    const id = await this.sql.begin(async (transaction) => {
      const batch = await this.lockEligibleBatch(transaction, context.tenantId, context.batchId);
      await this.assertNonTerminal(transaction, context.tenantId, context.batchId);
      const specifications = await transaction<
        SpecificationRow[]
      >`select * from quality_control.batch_specifications where tenant_id = ${context.tenantId} and id = ${context.specificationId} and status = 'ACTIVE' for share`;
      const specification = specifications[0];
      if (
        !specification ||
        specification.formula_version_id !== batch.formula_version_id ||
        specification.formula_bundle_hash !== batch.formula_bundle_hash
      )
        throw new QualityControlProblem(
          409,
          "QC_SPECIFICATION_FORMULA_MISMATCH",
          "Active specification does not match the Batch FormulaVersion and Bundle Hash."
        );
      if (await this.currentInspectionRow(transaction, context.tenantId, context.batchId))
        throw new QualityControlProblem(
          409,
          "QC_REINSPECTION_CONFLICT",
          "Batch already has an effective inspection."
        );
      const rows = await transaction<
        { id: string }[]
      >`insert into quality_control.batch_inspections (tenant_id, inspection_number, batch_id, specification_id, sample_reference, notes, created_by_user_id) values (${context.tenantId}, ${`QC-${batch.batch_number}-I1`}, ${context.batchId}, ${context.specificationId}, ${context.sampleReference ?? null}, ${context.notes ?? null}, ${context.actorUserId}) returning id`;
      await audit(
        transaction,
        context,
        "quality-control.inspection.created",
        "BatchInspection",
        rows[0].id,
        { batchId: context.batchId, specificationId: context.specificationId }
      );
      return rows[0].id;
    });
    return (await this.findInspection(context.tenantId, id))!;
  }

  async findInspection(
    tenantId: string,
    inspectionId: string
  ): Promise<BatchInspection | undefined> {
    const rows = await this.sql<
      InspectionRow[]
    >`select * from quality_control.batch_inspections where tenant_id = ${tenantId} and id = ${inspectionId}`;
    return rows[0] ? hydrateInspection(this.sql, rows[0]) : undefined;
  }

  async updateInspection(
    context: Parameters<QualityControlStore["updateInspection"]>[0]
  ): Promise<BatchInspection> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        InspectionRow[]
      >`select * from quality_control.batch_inspections where tenant_id = ${context.tenantId} and id = ${context.inspectionId} and status = 'DRAFT' for update`;
      if (!rows[0])
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_NOT_EDITABLE",
          "Only a DRAFT inspection is editable."
        );
      const sample =
        context.sampleReference === undefined ? rows[0].sample_reference : context.sampleReference;
      const notes = context.notes === undefined ? rows[0].notes : context.notes;
      if (sample === rows[0].sample_reference && notes === rows[0].notes) return;
      await transaction`update quality_control.batch_inspections set sample_reference = ${sample}, notes = ${notes}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.inspectionId}`;
      await audit(
        transaction,
        context,
        "quality-control.inspection.updated",
        "BatchInspection",
        context.inspectionId
      );
    });
    return (await this.findInspection(context.tenantId, context.inspectionId))!;
  }

  async replaceInspectionResults(
    context: Parameters<QualityControlStore["replaceInspectionResults"]>[0]
  ): Promise<BatchInspection> {
    await this.sql.begin(async (transaction) => {
      const inspections = await transaction<
        InspectionRow[]
      >`select * from quality_control.batch_inspections where tenant_id = ${context.tenantId} and id = ${context.inspectionId} and status = 'DRAFT' for update`;
      const inspection = inspections[0];
      if (!inspection)
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_NOT_EDITABLE",
          "Only a DRAFT inspection accepts results."
        );
      const items = await transaction<
        ItemRow[]
      >`select item.* from quality_control.batch_specification_items item where item.tenant_id = ${context.tenantId} and item.specification_id = ${inspection.specification_id} order by item_order`;
      const byId = new Map(items.map((value) => [value.id, value]));
      if (
        new Set(context.results.map((value) => value.specificationItemId)).size !==
        context.results.length
      )
        throw new QualityControlProblem(
          400,
          "QC_INSPECTION_RESULT_INVALID",
          "Each specification item may have one result."
        );
      await transaction`delete from quality_control.batch_inspection_results where tenant_id = ${context.tenantId} and inspection_id = ${context.inspectionId}`;
      for (const value of context.results) {
        const specificationItem = byId.get(value.specificationItemId);
        if (!specificationItem || specificationItem.check_type !== value.checkType)
          throw new QualityControlProblem(
            400,
            "QC_INSPECTION_RESULT_INVALID",
            "Result does not match its specification item."
          );
        await this.insertInspectionResult(transaction, context, specificationItem, value);
      }
      await audit(
        transaction,
        context,
        "quality-control.inspection.updated",
        "BatchInspection",
        context.inspectionId,
        { resultCount: context.results.length }
      );
    });
    return (await this.findInspection(context.tenantId, context.inspectionId))!;
  }

  async finalizeInspection(
    context: Parameters<QualityControlStore["finalizeInspection"]>[0]
  ): Promise<BatchInspection> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        InspectionRow[]
      >`select * from quality_control.batch_inspections where tenant_id = ${context.tenantId} and id = ${context.inspectionId} for update`;
      const inspection = rows[0];
      if (!inspection)
        throw new QualityControlProblem(
          404,
          "QC_INSPECTION_NOT_FOUND",
          "QC inspection was not found."
        );
      if (inspection.status === "FINAL")
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_ALREADY_FINAL",
          "Inspection is already FINAL."
        );
      if (inspection.status !== "DRAFT")
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_NOT_FINALIZABLE",
          "Inspection is not finalizable."
        );
      await this.lockEligibleBatch(transaction, context.tenantId, inspection.batch_id);
      await this.assertNonTerminal(transaction, context.tenantId, inspection.batch_id);
      const items = await transaction<
        ItemRow[]
      >`select * from quality_control.batch_specification_items where tenant_id = ${context.tenantId} and specification_id = ${inspection.specification_id} order by item_order`;
      const results = await transaction<
        ResultRow[]
      >`select * from quality_control.batch_inspection_results where tenant_id = ${context.tenantId} and inspection_id = ${context.inspectionId} for update`;
      if (
        items.length === 0 ||
        results.length !== items.length ||
        new Set(results.map((value) => value.specification_item_id)).size !== items.length
      )
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_INCOMPLETE",
          "Exactly one result is required for every specification item."
        );
      const byResult = new Map(results.map((value) => [value.specification_item_id, value]));
      const judgements: QualityJudgement[] = [];
      for (const specificationItem of items) {
        const value = byResult.get(specificationItem.id);
        if (!value)
          throw new QualityControlProblem(
            409,
            "QC_INSPECTION_INCOMPLETE",
            "Inspection is incomplete."
          );
        const computed = this.computeJudgement(specificationItem, value);
        judgements.push(computed);
        if (value.judgement !== computed)
          await transaction`update quality_control.batch_inspection_results set judgement = ${computed}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${value.id}`;
      }
      const outcome = inspectionOutcome(judgements);
      await transaction`update quality_control.batch_inspections set status = 'FINAL', outcome = ${outcome}, finalized_by_user_id = ${context.actorUserId}, finalized_at = now(), updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.inspectionId}`;
      await audit(
        transaction,
        context,
        "quality-control.inspection.finalized",
        "BatchInspection",
        context.inspectionId,
        { batchId: inspection.batch_id, outcome }
      );
    });
    return (await this.findInspection(context.tenantId, context.inspectionId))!;
  }

  async cancelInspection(
    context: Parameters<QualityControlStore["cancelInspection"]>[0]
  ): Promise<BatchInspection> {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        InspectionRow[]
      >`select * from quality_control.batch_inspections where tenant_id = ${context.tenantId} and id = ${context.inspectionId} and status = 'DRAFT' for update`;
      if (!rows[0])
        throw new QualityControlProblem(
          409,
          "QC_INSPECTION_NOT_EDITABLE",
          "Only a DRAFT inspection may be cancelled."
        );
      await transaction`update quality_control.batch_inspections set status = 'CANCELLED', cancelled_by_user_id = ${context.actorUserId}, cancelled_at = now(), updated_at = now() where tenant_id = ${context.tenantId} and id = ${context.inspectionId}`;
      await audit(
        transaction,
        context,
        "quality-control.inspection.cancelled",
        "BatchInspection",
        context.inspectionId,
        { batchId: rows[0].batch_id }
      );
    });
    return (await this.findInspection(context.tenantId, context.inspectionId))!;
  }

  async createReinspection(
    context: Parameters<QualityControlStore["createReinspection"]>[0]
  ): Promise<BatchInspection> {
    const id = await this.sql.begin(async (transaction) => {
      const sources = await transaction<
        InspectionRow[]
      >`select * from quality_control.batch_inspections where tenant_id = ${context.tenantId} and id = ${context.inspectionId} and status = 'FINAL' for share`;
      const source = sources[0];
      if (!source)
        throw new QualityControlProblem(
          409,
          "QC_REINSPECTION_CONFLICT",
          "Reinspection requires a FINAL inspection."
        );
      const batch = await this.lockEligibleBatch(transaction, context.tenantId, source.batch_id);
      await this.assertNonTerminal(transaction, context.tenantId, batch.batch_id);
      const current = await this.currentInspectionRow(
        transaction,
        context.tenantId,
        source.batch_id
      );
      if (!current || current.id !== source.id)
        throw new QualityControlProblem(
          409,
          "QC_REINSPECTION_CONFLICT",
          "Reinspection must supersede the current FINAL inspection."
        );
      const counts = await transaction<
        { count: number }[]
      >`select count(*)::int as count from quality_control.batch_inspections where tenant_id = ${context.tenantId} and batch_id = ${source.batch_id}`;
      const rows = await transaction<
        { id: string }[]
      >`insert into quality_control.batch_inspections (tenant_id, inspection_number, batch_id, specification_id, supersedes_inspection_id, retest_reason, created_by_user_id) values (${context.tenantId}, ${`QC-${batch.batch_number}-R${counts[0].count}`}, ${source.batch_id}, ${source.specification_id}, ${source.id}, ${context.retestReason}, ${context.actorUserId}) returning id`;
      await audit(
        transaction,
        context,
        "quality-control.inspection.reinspection-created",
        "BatchInspection",
        rows[0].id,
        { batchId: source.batch_id, supersedesInspectionId: source.id }
      );
      return rows[0].id;
    });
    return (await this.findInspection(context.tenantId, id))!;
  }

  holdBatch(
    context: Parameters<QualityControlStore["holdBatch"]>[0]
  ): Promise<BatchReleaseDecision> {
    return this.decide(context, "HOLD");
  }
  releaseBatch(
    context: Parameters<QualityControlStore["releaseBatch"]>[0]
  ): Promise<BatchReleaseDecision> {
    return this.decide(context, "RELEASED");
  }
  rejectBatch(
    context: Parameters<QualityControlStore["rejectBatch"]>[0]
  ): Promise<BatchReleaseDecision> {
    return this.decide(context, "REJECTED");
  }

  async resolveCurrentDisposition(
    tenantId: string,
    batchId: string
  ): Promise<Awaited<ReturnType<QualityControlStore["resolveCurrentDisposition"]>>> {
    const batch = await this.findBatchForQuality(tenantId, batchId);
    if (!batch || batch.actualOutputMassMg === null)
      throw new QualityControlProblem(404, "QC_BATCH_NOT_FOUND", "Production Batch was not found.");
    const effectiveDecision = await this.currentDecision(this.sql, tenantId, batchId);
    const effectiveInspection = await this.currentInspection(this.sql, tenantId, batchId);
    return {
      disposition: effectiveDecision?.decision ?? "PENDING_QC",
      effectiveDecisionId: effectiveDecision?.id ?? null,
      effectiveInspectionId: effectiveInspection?.id ?? null,
      releaseReadinessAssessmentId: effectiveDecision?.releaseReadinessAssessmentId ?? null,
      batchId,
      productionOrderId: batch.productionOrderId,
      formulaVersionId: batch.formulaVersionId,
      formulaBundleHash: batch.formulaBundleHash,
      actualOutputMassMg: batch.actualOutputMassMg
    };
  }

  private async decide(
    context: QualityCommandContext & { batchId: string; reason?: string },
    next: "HOLD" | "RELEASED" | "REJECTED"
  ): Promise<BatchReleaseDecision> {
    const id = await this.sql
      .begin(async (transaction) => {
        const batch = await this.lockEligibleBatch(transaction, context.tenantId, context.batchId);
        const current = await this.currentDecisionRow(
          transaction,
          context.tenantId,
          context.batchId
        );
        if (current?.decision === "RELEASED" || current?.decision === "REJECTED")
          throw new QualityControlProblem(
            409,
            "QC_RELEASE_ALREADY_TERMINAL",
            "Batch already has a terminal disposition."
          );
        let basisInspectionId: string | null = null;
        let readinessAssessmentId: string | null = null;
        if (next === "RELEASED" || next === "REJECTED") {
          const inspection = await this.currentInspectionRow(
            transaction,
            context.tenantId,
            context.batchId
          );
          if (!inspection || inspection.status !== "FINAL")
            throw new QualityControlProblem(
              409,
              next === "RELEASED" ? "QC_RELEASE_REQUIRES_PASS" : "QC_REJECT_REQUIRES_FAIL",
              "A current FINAL inspection is required."
            );
          basisInspectionId = inspection.id;
          if (next === "RELEASED") {
            const readiness = await this.readiness.resolveCurrentForFormulaInTransaction(
              transaction,
              {
                tenantId: context.tenantId,
                formulaVersionId: batch.formula_version_id,
                formulaBundleHash: batch.formula_bundle_hash
              }
            );
            readinessAssessmentId = requireReleaseEligibility(inspection, readiness).assessmentId;
          } else if (inspection.outcome !== "FAIL") {
            throw new QualityControlProblem(
              409,
              "QC_REJECT_REQUIRES_FAIL",
              "Reject requires a current FAIL inspection."
            );
          }
        }
        const rows = await transaction<{ id: string }[]>`
        insert into quality_control.batch_release_decisions (
          tenant_id, batch_id, decision, basis_inspection_id, release_readiness_assessment_id,
          supersedes_decision_id, reason, decided_by_user_id
        ) values (
          ${context.tenantId}, ${context.batchId}, ${next}, ${basisInspectionId}, ${readinessAssessmentId},
          ${current?.id ?? null}, ${context.reason ?? null}, ${context.actorUserId}
        ) returning id
      `;
        await audit(
          transaction,
          context,
          next === "HOLD"
            ? "quality-control.batch.held"
            : next === "RELEASED"
              ? "quality-control.batch.released"
              : "quality-control.batch.rejected",
          "ProductionBatch",
          context.batchId,
          {
            decisionId: rows[0].id,
            basisInspectionId,
            releaseReadinessAssessmentId: readinessAssessmentId
          }
        );
        return rows[0].id;
      })
      .catch((error: unknown) => {
        if (error instanceof QualityControlProblem) throw error;
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "23505"
        )
          throw new QualityControlProblem(
            409,
            "QC_DECISION_CONFLICT",
            "A concurrent Batch disposition already committed."
          );
        throw error;
      });
    const rows = await this.sql<
      DecisionRow[]
    >`select * from quality_control.batch_release_decisions where tenant_id = ${context.tenantId} and id = ${id}`;
    return decision(rows[0]);
  }

  private async findBatchWith(
    sql: Executor,
    tenantId: string,
    batchId: string
  ): Promise<QualityBatchReference | undefined> {
    const rows = await sql<BatchRow[]>`
      select batch.id as batch_id, batch.tenant_id, batch.batch_number, batch.production_order_id,
        production_order.status as production_order_status, batch.formula_version_id, batch.formula_bundle_hash,
        batch.release_readiness_assessment_id, batch.start_readiness_assessment_id,
        batch.target_mass_mg, batch.actual_output_mass_mg, batch.completed_at, batch.aborted_at
      from production.production_batches batch
      join production.production_orders production_order
        on production_order.tenant_id = batch.tenant_id and production_order.id = batch.production_order_id
      where batch.tenant_id = ${tenantId} and batch.id = ${batchId}
        and production_order.status = 'COMPLETED'
        and batch.completed_at is not null
        and batch.aborted_at is null
        and batch.actual_output_mass_mg > 0
    `;
    if (!rows[0]) return undefined;
    const allocations = await sql<AllocationRow[]>`
      select material_id, inventory_lot_id, inventory_location_id, allocated_mass_mg,
        inventory_consumption_movement_id
      from production.production_material_allocations
      where tenant_id = ${tenantId} and production_order_id = ${rows[0].production_order_id}
      order by id
    `;
    return {
      batchId: rows[0].batch_id,
      tenantId: rows[0].tenant_id,
      batchNumber: rows[0].batch_number,
      productionOrderId: rows[0].production_order_id,
      productionOrderStatus: rows[0].production_order_status,
      formulaVersionId: rows[0].formula_version_id,
      formulaBundleHash: rows[0].formula_bundle_hash,
      releaseReadinessAssessmentId: rows[0].release_readiness_assessment_id,
      startReadinessAssessmentId: rows[0].start_readiness_assessment_id,
      targetMassMg: quantity(rows[0].target_mass_mg),
      actualOutputMassMg:
        rows[0].actual_output_mass_mg === null ? null : quantity(rows[0].actual_output_mass_mg),
      completedAt: rows[0].completed_at,
      abortedAt: rows[0].aborted_at,
      allocations: allocations
        .filter((value): value is AllocationRow & { inventory_consumption_movement_id: string } =>
          Boolean(value.inventory_consumption_movement_id)
        )
        .map((value) => ({
          materialId: value.material_id,
          inventoryLotId: value.inventory_lot_id,
          inventoryLocationId: value.inventory_location_id,
          consumedMassMg: quantity(value.allocated_mass_mg),
          inventoryConsumptionMovementId: value.inventory_consumption_movement_id
        }))
    };
  }

  private async lockEligibleBatch(
    sql: TransactionSql,
    tenantId: string,
    batchId: string
  ): Promise<BatchRow> {
    const rows = await sql<BatchRow[]>`
      select batch.id as batch_id, batch.tenant_id, batch.batch_number, batch.production_order_id,
        production_order.status as production_order_status, batch.formula_version_id, batch.formula_bundle_hash,
        batch.release_readiness_assessment_id, batch.start_readiness_assessment_id,
        batch.target_mass_mg, batch.actual_output_mass_mg, batch.completed_at, batch.aborted_at
      from production.production_batches batch
      join production.production_orders production_order
        on production_order.tenant_id = batch.tenant_id and production_order.id = batch.production_order_id
      where batch.tenant_id = ${tenantId} and batch.id = ${batchId}
      for update of batch
    `;
    const batch = rows[0];
    if (!batch)
      throw new QualityControlProblem(404, "QC_BATCH_NOT_FOUND", "Production Batch was not found.");
    if (batch.aborted_at)
      throw new QualityControlProblem(409, "QC_BATCH_ABORTED", "Aborted Batch cannot enter QC.");
    if (
      batch.production_order_status !== "COMPLETED" ||
      !batch.completed_at ||
      batch.actual_output_mass_mg === null ||
      BigInt(batch.actual_output_mass_mg) <= 0n
    )
      throw new QualityControlProblem(
        409,
        "QC_BATCH_NOT_COMPLETED",
        "Only a completed physical Batch may enter QC."
      );
    return batch;
  }

  private async assertNonTerminal(sql: Executor, tenantId: string, batchId: string): Promise<void> {
    const current = await this.currentDecisionRow(sql, tenantId, batchId);
    if (current?.decision === "RELEASED" || current?.decision === "REJECTED")
      throw new QualityControlProblem(
        409,
        "QC_BATCH_ALREADY_TERMINAL",
        "Batch has a terminal QC disposition."
      );
  }

  private async currentInspectionRow(
    sql: Executor,
    tenantId: string,
    batchId: string
  ): Promise<InspectionRow | undefined> {
    const rows = await sql<InspectionRow[]>`
      select inspection.* from quality_control.batch_inspections inspection
      where inspection.tenant_id = ${tenantId} and inspection.batch_id = ${batchId}
        and inspection.status <> 'CANCELLED'
        and not exists (
          select 1 from quality_control.batch_inspections successor
          where successor.tenant_id = inspection.tenant_id
            and successor.supersedes_inspection_id = inspection.id
            and successor.status <> 'CANCELLED'
        )
      order by inspection.created_at desc, inspection.id limit 2
    `;
    if (rows.length > 1)
      throw new QualityControlProblem(
        409,
        "QC_REINSPECTION_CONFLICT",
        "Inspection lineage is ambiguous."
      );
    return rows[0];
  }

  private async currentInspection(
    sql: Executor,
    tenantId: string,
    batchId: string
  ): Promise<BatchInspection | null> {
    const row = await this.currentInspectionRow(sql, tenantId, batchId);
    return row ? hydrateInspection(sql, row) : null;
  }

  private async currentDecisionRow(
    sql: Executor,
    tenantId: string,
    batchId: string
  ): Promise<DecisionRow | undefined> {
    const rows = await sql<DecisionRow[]>`
      select current.* from quality_control.batch_release_decisions current
      where current.tenant_id = ${tenantId} and current.batch_id = ${batchId}
        and not exists (
          select 1 from quality_control.batch_release_decisions successor
          where successor.tenant_id = current.tenant_id and successor.supersedes_decision_id = current.id
        )
      order by current.decided_at desc, current.id limit 2
    `;
    if (rows.length > 1)
      throw new QualityControlProblem(
        409,
        "QC_DECISION_CONFLICT",
        "Batch decision lineage is ambiguous."
      );
    return rows[0];
  }

  private async currentDecision(
    sql: Executor,
    tenantId: string,
    batchId: string
  ): Promise<BatchReleaseDecision | null> {
    const row = await this.currentDecisionRow(sql, tenantId, batchId);
    return row ? decision(row) : null;
  }

  private async lockDraftSpecification(
    sql: TransactionSql,
    tenantId: string,
    id: string
  ): Promise<SpecificationRow> {
    const rows = await sql<
      SpecificationRow[]
    >`select * from quality_control.batch_specifications where tenant_id = ${tenantId} and id = ${id} and status = 'DRAFT' for update`;
    if (!rows[0])
      throw new QualityControlProblem(
        409,
        "QC_SPECIFICATION_NOT_EDITABLE",
        "Only a DRAFT specification is editable."
      );
    return rows[0];
  }

  private async insertSpecificationItem(
    sql: TransactionSql,
    context: QualityCommandContext & { specificationId: string },
    value: SpecificationItemInput
  ): Promise<void> {
    await sql`
      insert into quality_control.batch_specification_items (
        tenant_id, specification_id, item_order, check_key, name, check_type, unit_code,
        min_value, max_value, expected_boolean, acceptance_criteria_text, method_reference
      ) values (
        ${context.tenantId}, ${context.specificationId}, ${value.itemOrder}, ${value.checkKey}, ${value.name}, ${value.checkType},
        ${value.unitCode ?? null}, ${value.minValue ?? null}, ${value.maxValue ?? null}, ${value.expectedBoolean ?? null},
        ${value.acceptanceCriteriaText ?? null}, ${value.methodReference ?? null}
      )
    `;
  }

  private async insertInspectionResult(
    sql: TransactionSql,
    context: QualityCommandContext & { inspectionId: string },
    specificationItem: ItemRow,
    value: InspectionResultInput
  ): Promise<void> {
    const judgement =
      value.checkType === "NUMERIC_RANGE"
        ? numericRangeJudgement({
            observed: value.observedNumericValue,
            min: decimal(specificationItem.min_value),
            max: decimal(specificationItem.max_value)
          })
        : value.checkType === "BOOLEAN"
          ? value.observedBooleanValue === specificationItem.expected_boolean
            ? "PASS"
            : "FAIL"
          : value.judgement;
    await sql`
      insert into quality_control.batch_inspection_results (
        tenant_id, inspection_id, specification_item_id, observed_numeric_value,
        observed_boolean_value, observed_text, judgement, measured_by_user_id, notes
      ) values (
        ${context.tenantId}, ${context.inspectionId}, ${value.specificationItemId},
        ${value.checkType === "NUMERIC_RANGE" ? value.observedNumericValue : null},
        ${value.checkType === "BOOLEAN" ? value.observedBooleanValue : null},
        ${value.checkType === "QUALITATIVE" ? value.observedText : null},
        ${judgement}, ${context.actorUserId}, ${value.notes ?? null}
      )
    `;
  }

  private computeJudgement(specificationItem: ItemRow, value: ResultRow): QualityJudgement {
    if (specificationItem.check_type === "NUMERIC_RANGE") {
      if (value.observed_numeric_value === null)
        throw new QualityControlProblem(
          400,
          "QC_INSPECTION_RESULT_INVALID",
          "Numeric observation is required."
        );
      return numericRangeJudgement({
        observed: String(value.observed_numeric_value),
        min: decimal(specificationItem.min_value),
        max: decimal(specificationItem.max_value)
      });
    }
    if (specificationItem.check_type === "BOOLEAN") {
      if (value.observed_boolean_value === null)
        throw new QualityControlProblem(
          400,
          "QC_INSPECTION_RESULT_INVALID",
          "Boolean observation is required."
        );
      return value.observed_boolean_value === specificationItem.expected_boolean ? "PASS" : "FAIL";
    }
    if (!value.observed_text?.trim())
      throw new QualityControlProblem(
        400,
        "QC_INSPECTION_RESULT_INVALID",
        "Qualitative observation is required."
      );
    return value.judgement;
  }
}

export function createPostgresQualityControlStore(sql: Sql): QualityControlStore {
  return new PostgresQualityControlStore(sql);
}
