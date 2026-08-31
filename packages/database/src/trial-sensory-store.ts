import type { Sql, TransactionSql } from "postgres";
import type {
  SensoryDelta,
  SensoryEvaluation,
  Trial,
  TrialSensoryStore
} from "@nox-os/trial-sensory";

type SqlExecutor = Sql | TransactionSql;

type TrialRow = {
  id: string;
  tenant_id: string;
  formula_version_id: string;
  formula_bundle_hash: string;
  composition_kind: Trial["compositionKind"];
  taxonomy_source: Trial["taxonomySource"];
  taxonomy_version: Trial["taxonomyVersion"];
  preparation_mode: Trial["preparation"]["preparationMode"];
  application_key: string;
  dosage_pct: number | string;
  carrier_or_base_reference: string | null;
  target_mass_mg: bigint | string;
  scaling_policy_version: Trial["scalingPolicyVersion"];
  status: Trial["status"];
  created_by_user_id: string;
  prepared_by_user_id: string | null;
  cancelled_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  prepared_at: Date | null;
  cancelled_at: Date | null;
};

type TrialLineRow = {
  material_id: string;
  line_order: number;
  scaled_mass_mg: bigint | string;
  material_snapshot_hash: string;
};

type EvaluationRow = {
  id: string;
  tenant_id: string;
  trial_id: string;
  status: SensoryEvaluation["status"];
  evaluation_medium: SensoryEvaluation["context"]["evaluationMedium"];
  sample_age_minutes: number;
  temperature_c: number | string | null;
  humidity_pct: number | string | null;
  evaluation_text: string;
  diagnostic_note: string | null;
  decision: SensoryEvaluation["decision"];
  evaluated_by_user_id: string;
  finalized_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
};

type DeltaRow = {
  phase: SensoryDelta["phase"];
  assignment_type: SensoryDelta["assignmentType"];
  taxonomy_term: string;
  proposed_delta: number | null;
  confirmed_delta: number | null;
  proposal_confidence: number | string | null;
  interpreter_version: string | null;
  confirmed_at: Date | null;
};

async function loadTrial(
  sql: SqlExecutor,
  tenantId: string,
  trialId: string
): Promise<Trial | undefined> {
  const rows = await sql<TrialRow[]>`
    select id, tenant_id, formula_version_id, formula_bundle_hash, composition_kind,
           taxonomy_source, taxonomy_version, preparation_mode, application_key,
           dosage_pct, carrier_or_base_reference, target_mass_mg, scaling_policy_version,
           status, created_by_user_id, prepared_by_user_id, cancelled_by_user_id,
           created_at, updated_at, prepared_at, cancelled_at
    from trial_sensory.trials
    where tenant_id = ${tenantId} and id = ${trialId}
  `;
  if (!rows[0]) return undefined;
  const lineRows = await sql<TrialLineRow[]>`
    select material_id, line_order, scaled_mass_mg, material_snapshot_hash
    from trial_sensory.trial_lines
    where tenant_id = ${tenantId} and trial_id = ${trialId}
    order by line_order
  `;
  const row = rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    formulaVersionId: row.formula_version_id,
    formulaBundleHash: row.formula_bundle_hash,
    compositionKind: row.composition_kind,
    taxonomySource: row.taxonomy_source,
    taxonomyVersion: row.taxonomy_version,
    preparation: {
      preparationMode: row.preparation_mode,
      applicationKey: row.application_key,
      dosagePct: Number(row.dosage_pct),
      carrierOrBaseReference: row.carrier_or_base_reference,
      targetMassMg: String(row.target_mass_mg)
    },
    scalingPolicyVersion: row.scaling_policy_version,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    preparedByUserId: row.prepared_by_user_id,
    cancelledByUserId: row.cancelled_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    preparedAt: row.prepared_at,
    cancelledAt: row.cancelled_at,
    lines: lineRows.map((line) => ({
      materialId: line.material_id,
      lineOrder: line.line_order,
      scaledMassMg: String(line.scaled_mass_mg),
      materialSnapshotHash: line.material_snapshot_hash
    }))
  };
}

async function loadEvaluation(
  sql: SqlExecutor,
  tenantId: string,
  trialId: string,
  evaluationId: string
): Promise<SensoryEvaluation | undefined> {
  const rows = await sql<EvaluationRow[]>`
    select id, tenant_id, trial_id, status, evaluation_medium, sample_age_minutes,
           temperature_c, humidity_pct, evaluation_text, diagnostic_note, decision,
           evaluated_by_user_id, finalized_by_user_id, created_at, updated_at, finalized_at
    from trial_sensory.sensory_evaluations
    where tenant_id = ${tenantId} and trial_id = ${trialId} and id = ${evaluationId}
  `;
  if (!rows[0]) return undefined;
  const deltaRows = await sql<DeltaRow[]>`
    select phase, assignment_type, taxonomy_term, proposed_delta, confirmed_delta,
           proposal_confidence, interpreter_version, confirmed_at
    from trial_sensory.sensory_deltas
    where tenant_id = ${tenantId} and evaluation_id = ${evaluationId}
    order by phase, assignment_type, taxonomy_term
  `;
  const row = rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    trialId: row.trial_id,
    status: row.status,
    context: {
      evaluationMedium: row.evaluation_medium,
      sampleAgeMinutes: row.sample_age_minutes,
      temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
      humidityPct: row.humidity_pct == null ? null : Number(row.humidity_pct)
    },
    evaluationText: row.evaluation_text,
    diagnosticNote: row.diagnostic_note,
    decision: row.decision,
    evaluatedByUserId: row.evaluated_by_user_id,
    finalizedByUserId: row.finalized_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    deltas: deltaRows.map((delta) => ({
      phase: delta.phase,
      assignmentType: delta.assignment_type,
      taxonomyTerm: delta.taxonomy_term,
      proposedDelta: delta.proposed_delta,
      confirmedDelta: delta.confirmed_delta,
      proposalConfidence:
        delta.proposal_confidence == null ? null : Number(delta.proposal_confidence),
      interpreterVersion: delta.interpreter_version,
      confirmedAt: delta.confirmed_at
    }))
  };
}

async function audit(
  sql: SqlExecutor,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }
): Promise<void> {
  await sql`
    insert into platform.audit_events (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      request_id, correlation_id, metadata
    ) values (
      ${input.tenantId}, ${input.actorUserId}, ${input.action}, ${input.resourceType},
      ${input.resourceId}, ${input.requestId}, ${input.correlationId},
      ${sql.json(input.metadata ?? {})}
    )
  `;
}

class PostgresTrialSensoryStore implements TrialSensoryStore {
  constructor(private readonly sql: Sql) {}

  async createTrial(input: Parameters<TrialSensoryStore["createTrial"]>[0]): Promise<Trial> {
    const id = await this.sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        insert into trial_sensory.trials (
          tenant_id, formula_version_id, formula_bundle_hash, composition_kind,
          taxonomy_source, taxonomy_version, preparation_mode, application_key,
          dosage_pct, carrier_or_base_reference, target_mass_mg, scaling_policy_version,
          created_by_user_id
        ) values (
          ${input.tenantId}, ${input.formulaVersionId}, ${input.formulaBundleHash},
          ${input.compositionKind}, ${input.taxonomySource}, ${input.taxonomyVersion},
          ${input.preparation.preparationMode}, ${input.preparation.applicationKey},
          ${input.preparation.dosagePct}, ${input.preparation.carrierOrBaseReference ?? null},
          ${input.preparation.targetMassMg}, ${input.scalingPolicyVersion}, ${input.actorUserId}
        ) returning id
      `;
      await audit(tx, {
        ...input,
        action: "trial.created",
        resourceType: "Trial",
        resourceId: rows[0].id,
        metadata: { formulaVersionId: input.formulaVersionId }
      });
      return rows[0].id;
    });
    return (await loadTrial(this.sql, input.tenantId, id))!;
  }

  async listTrials(tenantId: string): Promise<Trial[]> {
    const rows = await this.sql<{ id: string }[]>`
      select id from trial_sensory.trials
      where tenant_id = ${tenantId}
      order by updated_at desc, id
    `;
    return (await Promise.all(rows.map((row) => loadTrial(this.sql, tenantId, row.id)))).filter(
      (value): value is Trial => Boolean(value)
    );
  }

  findTrial(tenantId: string, trialId: string): Promise<Trial | undefined> {
    return loadTrial(this.sql, tenantId, trialId);
  }

  async prepareTrial(
    input: Parameters<TrialSensoryStore["prepareTrial"]>[0]
  ): Promise<Trial | undefined> {
    const changed = await this.sql.begin(async (tx) => {
      const locked = await tx<{ status: string }[]>`
        select status from trial_sensory.trials
        where tenant_id = ${input.tenantId} and id = ${input.trialId}
          and formula_version_id = ${input.formulaVersionId}
        for update
      `;
      if (locked[0]?.status !== "DRAFT") return false;
      for (const line of input.lines) {
        await tx`
          insert into trial_sensory.trial_lines (
            tenant_id, trial_id, formula_version_id, material_id, line_order,
            scaled_mass_mg, material_snapshot_hash
          ) values (
            ${input.tenantId}, ${input.trialId}, ${input.formulaVersionId},
            ${line.materialId}, ${line.lineOrder}, ${line.scaledMassMg},
            ${line.materialSnapshotHash}
          )
        `;
      }
      const rows = await tx<{ id: string }[]>`
        update trial_sensory.trials set
          status = 'PREPARED', prepared_by_user_id = ${input.actorUserId},
          prepared_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.trialId} and status = 'DRAFT'
        returning id
      `;
      if (!rows[0]) return false;
      await audit(tx, {
        ...input,
        action: "trial.prepared",
        resourceType: "Trial",
        resourceId: input.trialId,
        metadata: { formulaVersionId: input.formulaVersionId, targetMassMg: input.targetMassMg }
      });
      return true;
    });
    return changed ? loadTrial(this.sql, input.tenantId, input.trialId) : undefined;
  }

  async cancelTrial(
    input: Parameters<TrialSensoryStore["cancelTrial"]>[0]
  ): Promise<Trial | undefined> {
    const changed = await this.sql.begin(async (tx) => {
      const rows = await tx<{ formula_version_id: string }[]>`
        update trial_sensory.trials set
          status = 'CANCELLED', cancelled_by_user_id = ${input.actorUserId},
          cancelled_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and id = ${input.trialId}
          and status in ('DRAFT', 'PREPARED')
        returning formula_version_id
      `;
      if (!rows[0]) return false;
      await audit(tx, {
        ...input,
        action: "trial.cancelled",
        resourceType: "Trial",
        resourceId: input.trialId,
        metadata: { formulaVersionId: rows[0].formula_version_id }
      });
      return true;
    });
    return changed ? loadTrial(this.sql, input.tenantId, input.trialId) : undefined;
  }

  async createEvaluation(
    input: Parameters<TrialSensoryStore["createEvaluation"]>[0]
  ): Promise<SensoryEvaluation> {
    const id = await this.sql.begin(async (tx) => {
      const trials = await tx<{ formula_version_id: string }[]>`
        select formula_version_id from trial_sensory.trials
        where tenant_id = ${input.tenantId} and id = ${input.trialId}
      `;
      const rows = await tx<{ id: string }[]>`
        insert into trial_sensory.sensory_evaluations (
          tenant_id, trial_id, evaluation_medium, sample_age_minutes,
          temperature_c, humidity_pct, evaluation_text, diagnostic_note, evaluated_by_user_id
        ) values (
          ${input.tenantId}, ${input.trialId}, ${input.context.evaluationMedium},
          ${input.context.sampleAgeMinutes}, ${input.context.temperatureC ?? null},
          ${input.context.humidityPct ?? null}, ${input.evaluationText},
          ${input.diagnosticNote}, ${input.actorUserId}
        ) returning id
      `;
      await audit(tx, {
        ...input,
        action: "evaluation.created",
        resourceType: "SensoryEvaluation",
        resourceId: rows[0].id,
        metadata: {
          trialId: input.trialId,
          formulaVersionId: trials[0]?.formula_version_id ?? null
        }
      });
      return rows[0].id;
    });
    return (await loadEvaluation(this.sql, input.tenantId, input.trialId, id))!;
  }

  findEvaluation(
    tenantId: string,
    trialId: string,
    evaluationId: string
  ): Promise<SensoryEvaluation | undefined> {
    return loadEvaluation(this.sql, tenantId, trialId, evaluationId);
  }

  async findEvaluationForTrial(
    tenantId: string,
    trialId: string
  ): Promise<SensoryEvaluation | undefined> {
    const rows = await this.sql<{ id: string }[]>`
      select id from trial_sensory.sensory_evaluations
      where tenant_id = ${tenantId} and trial_id = ${trialId}
    `;
    return rows[0] ? loadEvaluation(this.sql, tenantId, trialId, rows[0].id) : undefined;
  }

  async updateDraftEvaluation(
    input: Parameters<TrialSensoryStore["updateDraftEvaluation"]>[0]
  ): Promise<SensoryEvaluation | undefined> {
    const changed = await this.sql.begin(async (tx) => {
      const trials = await tx<{ formula_version_id: string }[]>`
        select formula_version_id from trial_sensory.trials
        where tenant_id = ${input.tenantId} and id = ${input.trialId}
      `;
      const rows = await tx<{ id: string }[]>`
        update trial_sensory.sensory_evaluations set
          evaluation_medium = ${input.context.evaluationMedium},
          sample_age_minutes = ${input.context.sampleAgeMinutes},
          temperature_c = ${input.context.temperatureC ?? null},
          humidity_pct = ${input.context.humidityPct ?? null},
          evaluation_text = ${input.evaluationText}, diagnostic_note = ${input.diagnosticNote},
          updated_at = now()
        where tenant_id = ${input.tenantId} and trial_id = ${input.trialId}
          and id = ${input.evaluationId} and status = 'DRAFT'
        returning id
      `;
      if (!rows[0]) return false;
      await tx`
        delete from trial_sensory.sensory_deltas
        where tenant_id = ${input.tenantId} and evaluation_id = ${input.evaluationId}
      `;
      await this.insertDeltas(tx, input);
      await audit(tx, {
        ...input,
        action: "evaluation.updated",
        resourceType: "SensoryEvaluation",
        resourceId: input.evaluationId,
        metadata: {
          trialId: input.trialId,
          formulaVersionId: trials[0]?.formula_version_id ?? null,
          deltaCount: input.deltas.length
        }
      });
      return true;
    });
    return changed
      ? loadEvaluation(this.sql, input.tenantId, input.trialId, input.evaluationId)
      : undefined;
  }

  async finalizeEvaluation(
    input: Parameters<TrialSensoryStore["finalizeEvaluation"]>[0]
  ): Promise<SensoryEvaluation | undefined> {
    const changed = await this.sql.begin(async (tx) => {
      const locked = await tx<{ status: string; formula_version_id: string }[]>`
        select evaluation.status, trial.formula_version_id
        from trial_sensory.sensory_evaluations as evaluation
        join trial_sensory.trials as trial
          on trial.tenant_id = evaluation.tenant_id and trial.id = evaluation.trial_id
        where evaluation.tenant_id = ${input.tenantId}
          and evaluation.trial_id = ${input.trialId}
          and evaluation.id = ${input.evaluationId}
        for update
      `;
      if (locked[0]?.status !== "DRAFT") return false;
      await tx`
        delete from trial_sensory.sensory_deltas
        where tenant_id = ${input.tenantId} and evaluation_id = ${input.evaluationId}
      `;
      await this.insertDeltas(tx, input, true);
      const rows = await tx<{ id: string }[]>`
        update trial_sensory.sensory_evaluations set
          status = 'FINAL', decision = ${input.decision},
          finalized_by_user_id = ${input.actorUserId}, finalized_at = now(), updated_at = now()
        where tenant_id = ${input.tenantId} and trial_id = ${input.trialId}
          and id = ${input.evaluationId} and status = 'DRAFT'
        returning id
      `;
      if (!rows[0]) return false;
      await audit(tx, {
        ...input,
        action: "evaluation.finalized",
        resourceType: "SensoryEvaluation",
        resourceId: input.evaluationId,
        metadata: {
          trialId: input.trialId,
          formulaVersionId: locked[0].formula_version_id,
          decision: input.decision
        }
      });
      return true;
    });
    return changed
      ? loadEvaluation(this.sql, input.tenantId, input.trialId, input.evaluationId)
      : undefined;
  }

  recordAudit(input: Parameters<TrialSensoryStore["recordAudit"]>[0]): Promise<void> {
    return audit(this.sql, input);
  }

  private async insertDeltas(
    tx: TransactionSql,
    input: {
      tenantId: string;
      evaluationId: string;
      deltas: Parameters<TrialSensoryStore["updateDraftEvaluation"]>[0]["deltas"];
    },
    confirmed = false
  ): Promise<void> {
    for (const delta of input.deltas) {
      await tx`
        insert into trial_sensory.sensory_deltas (
          tenant_id, evaluation_id, phase, assignment_type, taxonomy_term,
          proposed_delta, confirmed_delta, proposal_confidence, interpreter_version, confirmed_at
        ) values (
          ${input.tenantId}, ${input.evaluationId}, ${delta.phase}, ${delta.assignmentType},
          ${delta.taxonomyTerm}, ${delta.proposedDelta ?? null}, ${delta.confirmedDelta ?? null},
          ${delta.proposalConfidence ?? null}, ${delta.interpreterVersion ?? null},
          ${confirmed || delta.confirmedDelta != null ? new Date() : null}
        )
      `;
    }
  }
}

export function createPostgresTrialSensoryStore(sql: Sql): TrialSensoryStore {
  return new PostgresTrialSensoryStore(sql);
}
