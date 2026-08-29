import type { Sql, TransactionSql } from "postgres";
import type {
  ChangeRequestStatus,
  ChemicalEntityRecord,
  ComponentRole,
  IdentifierType,
  MaterialAggregate,
  MaterialChangeProposal,
  MaterialChangeRequestRecord,
  MaterialComponentRecord,
  MaterialConcentrateRecord,
  MaterialIdentifierRecord,
  MaterialOdorAssignmentRecord,
  MaterialPropertiesRecord,
  MaterialReadScope,
  MaterialRecord,
  MaterialSearchInput,
  MaterialStore,
  ReviewAuthority
} from "@nox-os/material-intelligence";

type SqlExecutor = Sql | TransactionSql;
type MaterialRow = {
  id: string;
  tenant_id: string | null;
  scope: MaterialRecord["scope"];
  visibility: MaterialRecord["visibility"];
  display_name: string;
  normalized_display_name: string;
  material_type: MaterialRecord["materialType"];
  approval_status: MaterialRecord["approvalStatus"];
  note_classification: MaterialRecord["noteClassification"];
  chemical_entity_id: string | null;
  contributor_user_id: string;
  approved_by_user_id: string | null;
  approved_by_authority: ReviewAuthority | null;
  created_at: Date;
  updated_at: Date;
};
type ChemicalRow = {
  id: string;
  canonical_name: string;
  canonical_smiles: string | null;
  isomeric_smiles: string | null;
  inchikey: string | null;
  molecular_formula: string | null;
  molecular_weight: number | null;
  structure_status: ChemicalEntityRecord["structureStatus"];
  structure_source_reference: string | null;
  created_at: Date;
  updated_at: Date;
};
type IdentifierRow = {
  material_id: string;
  identifier_type: IdentifierType;
  value: string;
  normalized_value: string;
};
type PropertiesRow = {
  material_id: string;
  appearance: string | null;
  assay: string | null;
  fcc_listed: boolean | null;
  specific_gravity: MaterialPropertiesRecord["specificGravity"];
  pounds_per_gallon: MaterialPropertiesRecord["poundsPerGallon"];
  refractive_index: MaterialPropertiesRecord["refractiveIndex"];
  boiling_point: MaterialPropertiesRecord["boilingPoint"];
  acid_value: MaterialPropertiesRecord["acidValue"];
  vapor_pressure: MaterialPropertiesRecord["vaporPressure"];
  flash_point: MaterialPropertiesRecord["flashPoint"];
  logp_ow: MaterialPropertiesRecord["logpOw"];
  shelf_life: string | null;
  storage: string | null;
  source_reference: string | null;
  ifra_cat4_max_pct: number | null;
  ifra_amendment: string | null;
  ifra_source_reference: string | null;
  created_at: Date;
  updated_at: Date;
};
type OdorRow = {
  material_id: string;
  taxonomy_version: string;
  assignment_type: MaterialOdorAssignmentRecord["assignmentType"];
  taxonomy_term: string;
  intensity: number | null;
};
type ConcentrateRow = {
  material_id: string;
  source_material_id: string;
  concentration_pct: number;
  solvent_material_id: string | null;
  solvent_custom_name: string | null;
};
type ComponentRow = {
  material_id: string;
  component_material_id: string;
  percentage: number | null;
  role: ComponentRole;
};
type ChangeRow = {
  id: string;
  material_id: string;
  tenant_id: string | null;
  requested_by_user_id: string;
  request_type: MaterialChangeRequestRecord["requestType"];
  proposed_patch: MaterialChangeProposal;
  status: ChangeRequestStatus;
  reviewed_by_user_id: string | null;
  reviewed_by_authority: ReviewAuthority | null;
  decision_note: string | null;
  created_at: Date;
  updated_at: Date;
};

function material(row: MaterialRow): MaterialRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scope: row.scope,
    visibility: row.visibility,
    displayName: row.display_name,
    normalizedDisplayName: row.normalized_display_name,
    materialType: row.material_type,
    approvalStatus: row.approval_status,
    noteClassification: row.note_classification,
    chemicalEntityId: row.chemical_entity_id,
    contributorUserId: row.contributor_user_id,
    approvedByUserId: row.approved_by_user_id,
    approvedByAuthority: row.approved_by_authority,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function chemical(row: ChemicalRow): ChemicalEntityRecord {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    canonicalSmiles: row.canonical_smiles,
    isomericSmiles: row.isomeric_smiles,
    inchikey: row.inchikey,
    molecularFormula: row.molecular_formula,
    molecularWeight: row.molecular_weight,
    structureStatus: row.structure_status,
    structureSourceReference: row.structure_source_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function identifier(row: IdentifierRow): MaterialIdentifierRecord {
  return {
    materialId: row.material_id,
    identifierType: row.identifier_type,
    value: row.value,
    normalizedValue: row.normalized_value
  };
}
function properties(row: PropertiesRow): MaterialPropertiesRecord {
  return {
    materialId: row.material_id,
    appearance: row.appearance,
    assay: row.assay,
    fccListed: row.fcc_listed,
    specificGravity: row.specific_gravity,
    poundsPerGallon: row.pounds_per_gallon,
    refractiveIndex: row.refractive_index,
    boilingPoint: row.boiling_point,
    acidValue: row.acid_value,
    vaporPressure: row.vapor_pressure,
    flashPoint: row.flash_point,
    logpOw: row.logp_ow,
    shelfLife: row.shelf_life,
    storage: row.storage,
    sourceReference: row.source_reference,
    ifraCat4MaxPct: row.ifra_cat4_max_pct,
    ifraAmendment: row.ifra_amendment,
    ifraSourceReference: row.ifra_source_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function odor(row: OdorRow): MaterialOdorAssignmentRecord {
  return {
    materialId: row.material_id,
    taxonomyVersion: row.taxonomy_version,
    assignmentType: row.assignment_type,
    taxonomyTerm: row.taxonomy_term,
    intensity: row.intensity
  };
}
function concentrate(row: ConcentrateRow): MaterialConcentrateRecord {
  return {
    materialId: row.material_id,
    sourceMaterialId: row.source_material_id,
    concentrationPct: row.concentration_pct,
    solventMaterialId: row.solvent_material_id,
    solventCustomName: row.solvent_custom_name
  };
}
function component(row: ComponentRow): MaterialComponentRecord {
  return {
    materialId: row.material_id,
    componentMaterialId: row.component_material_id,
    percentage: row.percentage,
    role: row.role
  };
}
function change(row: ChangeRow): MaterialChangeRequestRecord {
  return {
    id: row.id,
    materialId: row.material_id,
    tenantId: row.tenant_id,
    requestedByUserId: row.requested_by_user_id,
    requestType: row.request_type,
    proposedPatch: row.proposed_patch,
    status: row.status,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedByAuthority: row.reviewed_by_authority,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const materialColumns =
  "id, tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority, created_at, updated_at";
const chemicalColumns =
  "id, canonical_name, canonical_smiles, isomeric_smiles, inchikey, molecular_formula, molecular_weight, structure_status, structure_source_reference, created_at, updated_at";
const propertiesColumns =
  "material_id, appearance, assay, fcc_listed, specific_gravity, pounds_per_gallon, refractive_index, boiling_point, acid_value, vapor_pressure, flash_point, logp_ow, shelf_life, storage, source_reference, ifra_cat4_max_pct, ifra_amendment, ifra_source_reference, created_at, updated_at";
const changeColumns =
  "id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at";

class PostgresMaterialStore implements MaterialStore {
  constructor(private readonly sql: SqlExecutor) {}
  async transaction<T>(operation: (store: MaterialStore) => Promise<T>): Promise<T> {
    if ("begin" in this.sql)
      return (await this.sql.begin(async (transaction) =>
        operation(new PostgresMaterialStore(transaction))
      )) as T;
    return operation(this);
  }
  async insertChemicalEntity(
    input: Omit<ChemicalEntityRecord, "createdAt" | "updatedAt">
  ): Promise<ChemicalEntityRecord> {
    const rows = await this.sql<
      ChemicalRow[]
    >`insert into material_intelligence.chemical_entities (id, canonical_name, canonical_smiles, isomeric_smiles, inchikey, molecular_formula, molecular_weight, structure_status, structure_source_reference) values (${input.id}, ${input.canonicalName}, ${input.canonicalSmiles}, ${input.isomericSmiles}, ${input.inchikey}, ${input.molecularFormula}, ${input.molecularWeight}, ${input.structureStatus}, ${input.structureSourceReference}) returning id, canonical_name, canonical_smiles, isomeric_smiles, inchikey, molecular_formula, molecular_weight, structure_status, structure_source_reference, created_at, updated_at`;
    return chemical(rows[0]);
  }
  async findMaterialById(materialId: string): Promise<MaterialRecord | undefined> {
    const rows = await this.sql<
      MaterialRow[]
    >`select id, tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority, created_at, updated_at from material_intelligence.materials where id = ${materialId}`;
    return rows[0] ? material(rows[0]) : undefined;
  }
  async findMaterialAggregate(
    materialId: string,
    includeChemicalEntity = false
  ): Promise<MaterialAggregate | undefined> {
    const root = await this.findMaterialById(materialId);
    if (!root) return undefined;
    const [identifierRows, propertyRows, odorRows, concentrateRows, componentRows, chemicalRows] =
      await Promise.all([
        this.sql<
          IdentifierRow[]
        >`select material_id, identifier_type, value, normalized_value from material_intelligence.material_identifiers where material_id = ${materialId} order by identifier_type, normalized_value`,
        this.sql<
          PropertiesRow[]
        >`select material_id, appearance, assay, fcc_listed, specific_gravity, pounds_per_gallon, refractive_index, boiling_point, acid_value, vapor_pressure, flash_point, logp_ow, shelf_life, storage, source_reference, ifra_cat4_max_pct, ifra_amendment, ifra_source_reference, created_at, updated_at from material_intelligence.material_properties where material_id = ${materialId}`,
        this.sql<
          OdorRow[]
        >`select material_id, taxonomy_version, assignment_type, taxonomy_term, intensity from material_intelligence.material_odor_assignments where material_id = ${materialId} order by taxonomy_version, assignment_type, taxonomy_term`,
        this.sql<
          ConcentrateRow[]
        >`select material_id, source_material_id, concentration_pct, solvent_material_id, solvent_custom_name from material_intelligence.material_concentrates where material_id = ${materialId}`,
        this.sql<
          ComponentRow[]
        >`select material_id, component_material_id, percentage, role from material_intelligence.material_components where material_id = ${materialId} order by component_material_id`,
        includeChemicalEntity && root.chemicalEntityId
          ? this.sql<
              ChemicalRow[]
            >`select id, canonical_name, canonical_smiles, isomeric_smiles, inchikey, molecular_formula, molecular_weight, structure_status, structure_source_reference, created_at, updated_at from material_intelligence.chemical_entities where id = ${root.chemicalEntityId}`
          : Promise.resolve([] as ChemicalRow[])
      ]);
    return {
      material: root,
      identifiers: identifierRows.map(identifier),
      properties: propertyRows[0] ? properties(propertyRows[0]) : null,
      odorAssignments: odorRows.map(odor),
      concentrate: concentrateRows[0] ? concentrate(concentrateRows[0]) : null,
      components: componentRows.map(component),
      chemicalEntity: chemicalRows[0] ? chemical(chemicalRows[0]) : null
    };
  }
  async findMaterialsByIdentifier(
    type: IdentifierType,
    normalizedValue: string
  ): Promise<MaterialRecord[]> {
    const rows = await this.sql<
      MaterialRow[]
    >`select m.id, m.tenant_id, m.scope, m.visibility, m.display_name, m.normalized_display_name, m.material_type, m.approval_status, m.note_classification, m.chemical_entity_id, m.contributor_user_id, m.approved_by_user_id, m.approved_by_authority, m.created_at, m.updated_at from material_intelligence.materials as m join material_intelligence.material_identifiers as i on i.material_id = m.id where i.identifier_type = ${type} and i.normalized_value = ${normalizedValue} order by m.id`;
    return rows.map(material);
  }
  async findMaterialsByNormalizedDisplayName(normalizedName: string): Promise<MaterialRecord[]> {
    const rows = await this.sql<
      MaterialRow[]
    >`select id, tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority, created_at, updated_at from material_intelligence.materials where normalized_display_name = ${normalizedName} order by id`;
    return rows.map(material);
  }
  async searchMaterials(
    input: MaterialSearchInput,
    scope: MaterialReadScope
  ): Promise<MaterialAggregate[]> {
    const term = input.query ? "%" + input.query.replace(/[%_]/g, "\\$&") + "%" : null;
    const taxonomyFilters = input.taxonomyFilters ?? [];
    const rows = await this.sql<MaterialRow[]>`
      select m.id, m.tenant_id, m.scope, m.visibility, m.display_name, m.normalized_display_name, m.material_type, m.approval_status, m.note_classification, m.chemical_entity_id, m.contributor_user_id, m.approved_by_user_id, m.approved_by_authority, m.created_at, m.updated_at
      from material_intelligence.materials as m
      where (
        ${scope.platformAuthority} = true or m.scope = 'PLATFORM' or m.tenant_id = ${scope.tenantId ?? null}
        or (m.visibility = 'SHARED' and m.approval_status = 'APPROVED')
      )
      and (${input.materialType ?? null}::text is null or m.material_type = ${input.materialType ?? null})
      and (${input.approvalStatus ?? null}::text is null or m.approval_status = ${input.approvalStatus ?? null})
      and (${input.scope ?? null}::text is null or m.scope = ${input.scope ?? null})
      and (${input.visibility ?? null}::text is null or m.visibility = ${input.visibility ?? null})
      and (${input.noteClassification ?? null}::text is null or m.note_classification = ${input.noteClassification ?? null})
      and (${term}::text is null or m.display_name ilike ${term} escape '\\' or exists (select 1 from material_intelligence.material_identifiers as i where i.material_id = m.id and i.value ilike ${term} escape '\\'))
      and (
        ${taxonomyFilters.length} = 0 or not exists (
          select 1 from jsonb_to_recordset(${this.sql.json(taxonomyFilters)}::jsonb) as f(assignment_type text, taxonomy_term text, taxonomy_version text)
          where not exists (select 1 from material_intelligence.material_odor_assignments as o where o.material_id = m.id and o.assignment_type = f.assignment_type and o.taxonomy_term = f.taxonomy_term and (f.taxonomy_version is null or o.taxonomy_version = f.taxonomy_version))
        )
      )
      order by m.normalized_display_name, m.id limit ${input.limit} offset ${input.offset}
    `;
    return Promise.all(
      rows.map((row) =>
        this.findMaterialAggregate(row.id, false).then((item) => {
          if (!item) throw new Error("Material disappeared during search.");
          return item;
        })
      )
    );
  }
  async insertMaterial(
    input: Omit<MaterialRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialRecord> {
    const rows = await this.sql<
      MaterialRow[]
    >`insert into material_intelligence.materials (tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority) values (${input.tenantId}, ${input.scope}, ${input.visibility}, ${input.displayName}, ${input.normalizedDisplayName}, ${input.materialType}, ${input.approvalStatus}, ${input.noteClassification}, ${input.chemicalEntityId}, ${input.contributorUserId}, ${input.approvedByUserId}, ${input.approvedByAuthority}) returning id, tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority, created_at, updated_at`;
    return material(rows[0]);
  }
  async touchMaterial(materialId: string): Promise<void> {
    await this
      .sql`update material_intelligence.materials set updated_at = now() where id = ${materialId}`;
  }
  async updateMaterial(
    materialId: string,
    update: Partial<
      Pick<
        MaterialRecord,
        | "displayName"
        | "normalizedDisplayName"
        | "visibility"
        | "noteClassification"
        | "approvalStatus"
        | "approvedByUserId"
        | "approvedByAuthority"
      >
    >
  ): Promise<MaterialRecord | undefined> {
    const rows = await this.sql<
      MaterialRow[]
    >`update material_intelligence.materials set display_name = case when ${update.displayName === undefined} then display_name else ${update.displayName ?? null} end, normalized_display_name = case when ${update.normalizedDisplayName === undefined} then normalized_display_name else ${update.normalizedDisplayName ?? null} end, visibility = case when ${update.visibility === undefined} then visibility else ${update.visibility ?? null} end, note_classification = case when ${update.noteClassification === undefined} then note_classification else ${update.noteClassification ?? null} end, approval_status = case when ${update.approvalStatus === undefined} then approval_status else ${update.approvalStatus ?? null} end, approved_by_user_id = case when ${update.approvedByUserId === undefined} then approved_by_user_id else ${update.approvedByUserId ?? null} end, approved_by_authority = case when ${update.approvedByAuthority === undefined} then approved_by_authority else ${update.approvedByAuthority ?? null} end, updated_at = now() where id = ${materialId} returning id, tenant_id, scope, visibility, display_name, normalized_display_name, material_type, approval_status, note_classification, chemical_entity_id, contributor_user_id, approved_by_user_id, approved_by_authority, created_at, updated_at`;
    return rows[0] ? material(rows[0]) : undefined;
  }
  async replaceIdentifiers(
    materialId: string,
    values: readonly MaterialIdentifierRecord[]
  ): Promise<void> {
    await this
      .sql`delete from material_intelligence.material_identifiers where material_id = ${materialId}`;
    for (const value of values)
      await this
        .sql`insert into material_intelligence.material_identifiers (material_id, identifier_type, value, normalized_value) values (${materialId}, ${value.identifierType}, ${value.value}, ${value.normalizedValue})`;
  }
  async upsertProperties(
    value: Omit<MaterialPropertiesRecord, "createdAt" | "updatedAt">
  ): Promise<void> {
    await this
      .sql`insert into material_intelligence.material_properties (material_id, appearance, assay, fcc_listed, specific_gravity, pounds_per_gallon, refractive_index, boiling_point, acid_value, vapor_pressure, flash_point, logp_ow, shelf_life, storage, source_reference, ifra_cat4_max_pct, ifra_amendment, ifra_source_reference) values (${value.materialId}, ${value.appearance}, ${value.assay}, ${value.fccListed}, ${this.sql.json(value.specificGravity)}, ${this.sql.json(value.poundsPerGallon)}, ${this.sql.json(value.refractiveIndex)}, ${this.sql.json(value.boilingPoint)}, ${this.sql.json(value.acidValue)}, ${this.sql.json(value.vaporPressure)}, ${this.sql.json(value.flashPoint)}, ${this.sql.json(value.logpOw)}, ${value.shelfLife}, ${value.storage}, ${value.sourceReference}, ${value.ifraCat4MaxPct}, ${value.ifraAmendment}, ${value.ifraSourceReference}) on conflict (material_id) do update set appearance = excluded.appearance, assay = excluded.assay, fcc_listed = excluded.fcc_listed, specific_gravity = excluded.specific_gravity, pounds_per_gallon = excluded.pounds_per_gallon, refractive_index = excluded.refractive_index, boiling_point = excluded.boiling_point, acid_value = excluded.acid_value, vapor_pressure = excluded.vapor_pressure, flash_point = excluded.flash_point, logp_ow = excluded.logp_ow, shelf_life = excluded.shelf_life, storage = excluded.storage, source_reference = excluded.source_reference, ifra_cat4_max_pct = excluded.ifra_cat4_max_pct, ifra_amendment = excluded.ifra_amendment, ifra_source_reference = excluded.ifra_source_reference, updated_at = now()`;
  }
  async replaceOdorAssignments(
    materialId: string,
    values: readonly MaterialOdorAssignmentRecord[]
  ): Promise<void> {
    await this
      .sql`delete from material_intelligence.material_odor_assignments where material_id = ${materialId}`;
    for (const value of values)
      await this
        .sql`insert into material_intelligence.material_odor_assignments (material_id, taxonomy_version, assignment_type, taxonomy_term, intensity) values (${materialId}, ${value.taxonomyVersion}, ${value.assignmentType}, ${value.taxonomyTerm}, ${value.intensity})`;
  }
  async replaceConcentrate(
    materialId: string,
    value: MaterialConcentrateRecord | null
  ): Promise<void> {
    await this
      .sql`delete from material_intelligence.material_concentrates where material_id = ${materialId}`;
    if (value)
      await this
        .sql`insert into material_intelligence.material_concentrates (material_id, source_material_id, concentration_pct, solvent_material_id, solvent_custom_name) values (${materialId}, ${value.sourceMaterialId}, ${value.concentrationPct}, ${value.solventMaterialId}, ${value.solventCustomName})`;
  }
  async replaceComponents(
    materialId: string,
    values: readonly MaterialComponentRecord[]
  ): Promise<void> {
    await this
      .sql`delete from material_intelligence.material_components where material_id = ${materialId}`;
    for (const value of values)
      await this
        .sql`insert into material_intelligence.material_components (material_id, component_material_id, percentage, role) values (${materialId}, ${value.componentMaterialId}, ${value.percentage}, ${value.role})`;
  }
  async insertChangeRequest(
    input: Omit<MaterialChangeRequestRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialChangeRequestRecord> {
    const rows = await this.sql<
      ChangeRow[]
    >`insert into material_intelligence.material_change_requests (material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note) values (${input.materialId}, ${input.tenantId}, ${input.requestedByUserId}, ${input.requestType}, ${this.sql.json(input.proposedPatch)}, ${input.status}, ${input.reviewedByUserId}, ${input.reviewedByAuthority}, ${input.decisionNote}) returning id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at`;
    return change(rows[0]);
  }
  async findChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined> {
    const rows = await this.sql<
      ChangeRow[]
    >`select id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at from material_intelligence.material_change_requests where id = ${requestId}`;
    return rows[0] ? change(rows[0]) : undefined;
  }
  async lockChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined> {
    const rows = await this.sql<
      ChangeRow[]
    >`select id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at from material_intelligence.material_change_requests where id = ${requestId} for update`;
    return rows[0] ? change(rows[0]) : undefined;
  }
  async listChangeRequests(
    scope: MaterialReadScope,
    status?: ChangeRequestStatus
  ): Promise<MaterialChangeRequestRecord[]> {
    const rows = await this.sql<
      ChangeRow[]
    >`select id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at from material_intelligence.material_change_requests where (${scope.platformAuthority} = true or tenant_id = ${scope.tenantId ?? null}) and (${status ?? null}::text is null or status = ${status ?? null}) order by created_at, id`;
    return rows.map(change);
  }
  async resolveChangeRequest(input: {
    requestId: string;
    status: Extract<ChangeRequestStatus, "APPROVED" | "REJECTED">;
    reviewedByUserId: string;
    reviewedByAuthority: ReviewAuthority;
    decisionNote: string | null;
  }): Promise<MaterialChangeRequestRecord | undefined> {
    const rows = await this.sql<
      ChangeRow[]
    >`update material_intelligence.material_change_requests set status = ${input.status}, reviewed_by_user_id = ${input.reviewedByUserId}, reviewed_by_authority = ${input.reviewedByAuthority}, decision_note = ${input.decisionNote}, updated_at = now() where id = ${input.requestId} and status = 'PENDING_REVIEW' returning id, material_id, tenant_id, requested_by_user_id, request_type, proposed_patch, status, reviewed_by_user_id, reviewed_by_authority, decision_note, created_at, updated_at`;
    return rows[0] ? change(rows[0]) : undefined;
  }
  async insertAuditEvent(input: {
    tenantId?: string | null;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    await this
      .sql`insert into platform.audit_events (tenant_id, actor_user_id, action, resource_type, resource_id, request_id, correlation_id, metadata) values (${input.tenantId ?? null}, ${input.actorUserId}, ${input.action}, ${input.resourceType}, ${input.resourceId ?? null}, ${input.requestId}, ${input.correlationId}, ${this.sql.json(input.metadata ?? {})})`;
  }
}
export function createPostgresMaterialStore(sql: Sql): MaterialStore {
  return new PostgresMaterialStore(sql);
}
