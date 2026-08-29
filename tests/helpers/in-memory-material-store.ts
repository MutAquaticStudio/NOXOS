import type {
  ChangeRequestStatus,
  ChemicalEntityRecord,
  IdentifierType,
  MaterialAggregate,
  MaterialChangeRequestRecord,
  MaterialComponentRecord,
  MaterialConcentrateRecord,
  MaterialIdentifierRecord,
  MaterialHistoryEvent,
  MaterialOdorAssignmentRecord,
  MaterialPropertiesRecord,
  MaterialReadScope,
  MaterialRecord,
  MaterialSearchInput,
  MaterialStore,
  ReviewAuthority
} from "@nox-os/material-intelligence";
import { canReadMaterial } from "@nox-os/material-intelligence";

type AuditEntry = MaterialHistoryEvent & {
  tenantId: string | null;
  requestId: string;
  correlationId: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type State = {
  materials: Map<string, MaterialRecord>;
  chemicals: Map<string, ChemicalEntityRecord>;
  identifiers: Map<string, MaterialIdentifierRecord[]>;
  properties: Map<string, MaterialPropertiesRecord>;
  odors: Map<string, MaterialOdorAssignmentRecord[]>;
  concentrates: Map<string, MaterialConcentrateRecord>;
  components: Map<string, MaterialComponentRecord[]>;
  changes: Map<string, MaterialChangeRequestRecord>;
  tenantNames: Map<string, string>;
  userDisplayNames: Map<string, string>;
  audits: AuditEntry[];
  sequence: number;
};

function cloneState(state: State): State {
  return structuredClone(state);
}
function generatedId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
function now(): Date {
  return new Date("2026-08-29T00:00:00.000Z");
}

export class InMemoryMaterialStore implements MaterialStore {
  private state: State = {
    materials: new Map(),
    chemicals: new Map(),
    identifiers: new Map(),
    properties: new Map(),
    odors: new Map(),
    concentrates: new Map(),
    components: new Map(),
    changes: new Map(),
    tenantNames: new Map(),
    userDisplayNames: new Map(),
    audits: [],
    sequence: 1
  };
  private transactionTail: Promise<void> = Promise.resolve();
  private failAudit = false;
  get auditEvents(): readonly AuditEntry[] {
    return this.state.audits;
  }
  setAuditInsertFailure(enabled: boolean): void {
    this.failAudit = enabled;
  }
  setTenantName(tenantId: string, name: string): void {
    this.state.tenantNames.set(tenantId, name);
  }
  setPlatformUserDisplayName(userId: string, displayName: string): void {
    this.state.userDisplayNames.set(userId, displayName);
  }
  async transaction<T>(operation: (store: MaterialStore) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    const snapshot = new InMemoryMaterialStore();
    snapshot.state = cloneState(this.state);
    snapshot.failAudit = this.failAudit;
    try {
      const value = await operation(snapshot);
      this.state = snapshot.state;
      return value;
    } finally {
      release();
    }
  }
  async insertChemicalEntity(
    input: Omit<ChemicalEntityRecord, "createdAt" | "updatedAt">
  ): Promise<ChemicalEntityRecord> {
    const value = { ...input, createdAt: now(), updatedAt: now() };
    this.state.chemicals.set(value.id, value);
    return structuredClone(value);
  }
  async findMaterialById(materialId: string): Promise<MaterialRecord | undefined> {
    const value = this.state.materials.get(materialId);
    return value ? structuredClone(value) : undefined;
  }
  async findMaterialAggregate(
    materialId: string,
    includeChemicalEntity = false
  ): Promise<MaterialAggregate | undefined> {
    const material = await this.findMaterialById(materialId);
    if (!material) return undefined;
    const chemical =
      includeChemicalEntity && material.chemicalEntityId
        ? this.state.chemicals.get(material.chemicalEntityId)
        : undefined;
    return {
      material,
      identifiers: structuredClone(this.state.identifiers.get(materialId) ?? []),
      properties: this.state.properties.get(materialId)
        ? (structuredClone(this.state.properties.get(materialId)) ?? null)
        : null,
      odorAssignments: structuredClone(this.state.odors.get(materialId) ?? []),
      concentrate: this.state.concentrates.get(materialId)
        ? (structuredClone(this.state.concentrates.get(materialId)) ?? null)
        : null,
      components: structuredClone(this.state.components.get(materialId) ?? []),
      chemicalEntity: chemical ? structuredClone(chemical) : null
    };
  }
  async findMaterialsByIdentifier(
    type: IdentifierType,
    normalizedValue: string
  ): Promise<MaterialRecord[]> {
    return Promise.all(
      [...this.state.identifiers.values()]
        .flat()
        .filter(
          (value) => value.identifierType === type && value.normalizedValue === normalizedValue
        )
        .map((value) => this.findMaterialById(value.materialId))
    ).then((items) => items.filter((item): item is MaterialRecord => Boolean(item)));
  }
  async findMaterialsByNormalizedDisplayName(normalizedName: string): Promise<MaterialRecord[]> {
    return [...this.state.materials.values()]
      .filter((item) => item.normalizedDisplayName === normalizedName)
      .map((item) => structuredClone(item));
  }
  async findTenantName(tenantId: string): Promise<string | null> {
    return this.state.tenantNames.get(tenantId) ?? null;
  }
  async findPlatformUserDisplayName(userId: string): Promise<string | null> {
    return this.state.userDisplayNames.get(userId) ?? null;
  }
  async searchMaterials(
    input: MaterialSearchInput,
    scope: MaterialReadScope
  ): Promise<MaterialAggregate[]> {
    const query = input.query?.toLocaleLowerCase("en-US");
    const materials = [...this.state.materials.values()]
      .filter((item) => {
        if (!canReadMaterial(scope, item)) return false;
        if (input.materialType && item.materialType !== input.materialType) return false;
        if (input.approvalStatus && item.approvalStatus !== input.approvalStatus) return false;
        if (input.scope && item.scope !== input.scope) return false;
        if (input.visibility && item.visibility !== input.visibility) return false;
        if (input.noteClassification && item.noteClassification !== input.noteClassification)
          return false;
        if (
          input.view === "MY_TENANT" &&
          !(item.scope === "TENANT" && item.tenantId === scope.tenantId)
        )
          return false;
        if (
          input.view === "SHARED" &&
          !(
            item.scope === "PLATFORM" ||
            (item.scope === "TENANT" &&
              item.visibility === "SHARED" &&
              item.approvalStatus === "APPROVED" &&
              item.tenantId !== scope.tenantId)
          )
        )
          return false;
        if (
          query &&
          !item.displayName.toLocaleLowerCase("en-US").includes(query) &&
          !(this.state.identifiers.get(item.id) ?? []).some((identifier) =>
            identifier.value.toLocaleLowerCase("en-US").includes(query)
          )
        )
          return false;
        return (input.taxonomyFilters ?? []).every((filter) =>
          (this.state.odors.get(item.id) ?? []).some(
            (odor) =>
              odor.assignmentType === filter.assignmentType &&
              odor.taxonomyTerm === filter.taxonomyTerm &&
              (!filter.taxonomyVersion || odor.taxonomyVersion === filter.taxonomyVersion)
          )
        );
      })
      .sort(
        (left, right) =>
          left.normalizedDisplayName.localeCompare(right.normalizedDisplayName) ||
          left.id.localeCompare(right.id)
      )
      .slice(input.offset, input.offset + input.limit);
    return Promise.all(
      materials.map((item) =>
        this.findMaterialAggregate(item.id, false).then((aggregate) => {
          if (!aggregate) throw new Error("Material disappeared.");
          return aggregate;
        })
      )
    );
  }
  async insertMaterial(
    input: Omit<MaterialRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialRecord> {
    const value = {
      ...input,
      id: generatedId(this.state.sequence++),
      createdAt: now(),
      updatedAt: now()
    };
    this.state.materials.set(value.id, value);
    return structuredClone(value);
  }
  async touchMaterial(materialId: string): Promise<void> {
    const existing = this.state.materials.get(materialId);
    if (existing)
      this.state.materials.set(materialId, {
        ...existing,
        updatedAt: new Date(existing.updatedAt.getTime() + 1)
      });
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
    const existing = this.state.materials.get(materialId);
    if (!existing) return undefined;
    const value = { ...existing, ...update, updatedAt: new Date(existing.updatedAt.getTime() + 1) };
    this.state.materials.set(materialId, value);
    return structuredClone(value);
  }
  async replaceIdentifiers(
    materialId: string,
    identifiers: readonly MaterialIdentifierRecord[]
  ): Promise<void> {
    this.state.identifiers.set(materialId, [...structuredClone(identifiers)]);
  }
  async upsertProperties(
    properties: Omit<MaterialPropertiesRecord, "createdAt" | "updatedAt">
  ): Promise<void> {
    const previous = this.state.properties.get(properties.materialId);
    this.state.properties.set(properties.materialId, {
      ...properties,
      createdAt: previous?.createdAt ?? now(),
      updatedAt: now()
    });
  }
  async replaceOdorAssignments(
    materialId: string,
    values: readonly MaterialOdorAssignmentRecord[]
  ): Promise<void> {
    this.state.odors.set(materialId, [...structuredClone(values)]);
  }
  async replaceConcentrate(
    materialId: string,
    value: MaterialConcentrateRecord | null
  ): Promise<void> {
    if (value) this.state.concentrates.set(materialId, structuredClone(value));
    else this.state.concentrates.delete(materialId);
  }
  async replaceComponents(
    materialId: string,
    values: readonly MaterialComponentRecord[]
  ): Promise<void> {
    this.state.components.set(materialId, [...structuredClone(values)]);
  }
  async insertChangeRequest(
    input: Omit<MaterialChangeRequestRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialChangeRequestRecord> {
    const value = {
      ...input,
      id: generatedId(this.state.sequence++),
      createdAt: now(),
      updatedAt: now()
    };
    this.state.changes.set(value.id, value);
    return structuredClone(value);
  }
  async findChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined> {
    const value = this.state.changes.get(requestId);
    return value ? structuredClone(value) : undefined;
  }
  async lockChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined> {
    return this.findChangeRequest(requestId);
  }
  async listChangeRequests(
    scope: MaterialReadScope,
    status?: ChangeRequestStatus
  ): Promise<MaterialChangeRequestRecord[]> {
    return [...this.state.changes.values()]
      .filter(
        (item) =>
          (scope.platformAuthority || item.tenantId === scope.tenantId) &&
          (!status || item.status === status)
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }
  async listMaterialHistory(materialId: string): Promise<MaterialHistoryEvent[]> {
    const changeIds = new Set(
      [...this.state.changes.values()]
        .filter((change) => change.materialId === materialId)
        .map((change) => change.id)
    );
    return this.state.audits
      .filter(
        (event) =>
          event.resourceId === materialId ||
          Boolean(event.resourceId && changeIds.has(event.resourceId))
      )
      .map(({ id, actorUserId, action, resourceType, resourceId, createdAt }) => ({
        id,
        actorUserId,
        action,
        resourceType,
        resourceId,
        createdAt
      }));
  }
  async resolveChangeRequest(input: {
    requestId: string;
    status: Extract<ChangeRequestStatus, "APPROVED" | "REJECTED">;
    reviewedByUserId: string;
    reviewedByAuthority: ReviewAuthority;
    decisionNote: string | null;
  }): Promise<MaterialChangeRequestRecord | undefined> {
    const existing = this.state.changes.get(input.requestId);
    if (!existing || existing.status !== "PENDING_REVIEW") return undefined;
    const value = {
      ...existing,
      status: input.status,
      reviewedByUserId: input.reviewedByUserId,
      reviewedByAuthority: input.reviewedByAuthority,
      decisionNote: input.decisionNote,
      updatedAt: new Date(existing.updatedAt.getTime() + 1)
    };
    this.state.changes.set(value.id, value);
    return structuredClone(value);
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
    if (this.failAudit) throw new Error("controlled audit failure");
    this.state.audits.push({
      id: "audit-" + String(this.state.audits.length + 1),
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      requestId: input.requestId,
      correlationId: input.correlationId,
      metadata: input.metadata,
      createdAt: now()
    });
  }
  async seedMaterial(input: Omit<MaterialRecord, "createdAt" | "updatedAt">): Promise<void> {
    this.state.materials.set(input.id, { ...input, createdAt: now(), updatedAt: now() });
  }
}
