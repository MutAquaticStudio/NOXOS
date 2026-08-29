import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  AuthenticatedRequestContext,
  ErrorCode,
  ModuleDefinition,
  PlatformPermission,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import osmoV12 from "../../../taxonomy/osmo/1.2.json";

export const MATERIAL_MODULE_ID = "material-intelligence";
export const MATERIAL_ENTITLEMENT = "module.material-intelligence";
export const MATERIAL_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const materialTypeSchema = z.enum(["SINGLE_MOLECULE", "NATURAL", "MIXTURE", "DILUTION"]);
export type MaterialType = z.infer<typeof materialTypeSchema>;
export const materialScopeSchema = z.enum(["PLATFORM", "TENANT"]);
export type MaterialScope = z.infer<typeof materialScopeSchema>;
export const materialVisibilitySchema = z.enum(["PRIVATE", "SHARED"]);
export type MaterialVisibility = z.infer<typeof materialVisibilitySchema>;
export const materialApprovalStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED"]);
export type MaterialApprovalStatus = z.infer<typeof materialApprovalStatusSchema>;
export const noteClassificationSchema = z.enum(["TOP", "MID", "BASE"]);
export type NoteClassification = z.infer<typeof noteClassificationSchema>;
export const identifierTypeSchema = z.enum(["CAS", "FEMA", "INCI"]);
export type IdentifierType = z.infer<typeof identifierTypeSchema>;
export const odorAssignmentTypeSchema = z.enum([
  "GRAND_FAMILY",
  "SUBFAMILY",
  "DESCRIPTOR",
  "TEXTURE",
  "SENSATION"
]);
export type OdorAssignmentType = z.infer<typeof odorAssignmentTypeSchema>;
export const componentRoleSchema = z.enum(["COMPONENT", "TRACE"]);
export type ComponentRole = z.infer<typeof componentRoleSchema>;
export const changeRequestTypeSchema = z.enum([
  "CREATE",
  "IDENTITY",
  "PHYSICAL",
  "OLFACTIVE",
  "DILUTION",
  "COMPONENTS",
  "GENERAL"
]);
export type ChangeRequestType = z.infer<typeof changeRequestTypeSchema>;
export const changeRequestStatusSchema = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]);
export type ChangeRequestStatus = z.infer<typeof changeRequestStatusSchema>;
export const reviewAuthoritySchema = z.enum(["TENANT", "PLATFORM"]);
export type ReviewAuthority = z.infer<typeof reviewAuthoritySchema>;

export const MATERIAL_PERMISSIONS = {
  read: "module.material-intelligence.material.read",
  create: "module.material-intelligence.material.create",
  requestChange: "module.material-intelligence.material.request-change",
  approve: "module.material-intelligence.material.approve",
  share: "module.material-intelligence.material.share"
} as const;
export const MATERIAL_PLATFORM_PERMISSIONS = {
  referenceRead: "module.material-intelligence.reference.read",
  referenceManage: "module.material-intelligence.reference.manage",
  reviewApprove: "module.material-intelligence.review.approve"
} as const satisfies Record<string, PlatformPermission>;

export type JsonObject = Record<string, string | number | boolean | null>;
export type ChemicalEntityRecord = {
  id: string;
  canonicalName: string;
  canonicalSmiles: string | null;
  isomericSmiles: string | null;
  inchikey: string | null;
  molecularFormula: string | null;
  molecularWeight: number | null;
  structureStatus: "UNVERIFIED" | "VERIFIED";
  structureSourceReference: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type MaterialRecord = {
  id: string;
  tenantId: string | null;
  scope: MaterialScope;
  visibility: MaterialVisibility;
  displayName: string;
  normalizedDisplayName: string;
  materialType: MaterialType;
  approvalStatus: MaterialApprovalStatus;
  noteClassification: NoteClassification | null;
  chemicalEntityId: string | null;
  contributorUserId: string;
  approvedByUserId: string | null;
  approvedByAuthority: ReviewAuthority | null;
  createdAt: Date;
  updatedAt: Date;
};
export type MaterialIdentifierRecord = {
  materialId: string;
  identifierType: IdentifierType;
  value: string;
  normalizedValue: string;
};
export type MaterialPropertiesRecord = {
  materialId: string;
  appearance: string | null;
  assay: string | null;
  fccListed: boolean | null;
  specificGravity: JsonObject | null;
  poundsPerGallon: JsonObject | null;
  refractiveIndex: JsonObject | null;
  boilingPoint: JsonObject | null;
  acidValue: JsonObject | null;
  vaporPressure: JsonObject | null;
  flashPoint: JsonObject | null;
  logpOw: JsonObject | null;
  shelfLife: string | null;
  storage: string | null;
  sourceReference: string | null;
  ifraCat4MaxPct: number | null;
  ifraAmendment: string | null;
  ifraSourceReference: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type MaterialOdorAssignmentRecord = {
  materialId: string;
  taxonomyVersion: string;
  assignmentType: OdorAssignmentType;
  taxonomyTerm: string;
  intensity: number | null;
};
export type MaterialConcentrateRecord = {
  materialId: string;
  sourceMaterialId: string;
  concentrationPct: number;
  solventMaterialId: string | null;
  solventCustomName: string | null;
};
export type MaterialComponentRecord = {
  materialId: string;
  componentMaterialId: string;
  percentage: number | null;
  role: ComponentRole;
};
export type MaterialChangeRequestRecord = {
  id: string;
  materialId: string;
  tenantId: string | null;
  requestedByUserId: string;
  requestType: ChangeRequestType;
  proposedPatch: MaterialChangeProposal;
  status: ChangeRequestStatus;
  reviewedByUserId: string | null;
  reviewedByAuthority: ReviewAuthority | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type MaterialAggregate = {
  material: MaterialRecord;
  identifiers: readonly MaterialIdentifierRecord[];
  properties: MaterialPropertiesRecord | null;
  odorAssignments: readonly MaterialOdorAssignmentRecord[];
  concentrate: MaterialConcentrateRecord | null;
  components: readonly MaterialComponentRecord[];
  chemicalEntity: ChemicalEntityRecord | null;
};
export type MaterialSearchInput = {
  query?: string;
  materialType?: MaterialType;
  approvalStatus?: MaterialApprovalStatus;
  scope?: MaterialScope;
  visibility?: MaterialVisibility;
  noteClassification?: NoteClassification;
  taxonomyFilters?: readonly {
    assignmentType: OdorAssignmentType;
    taxonomyTerm: string;
    taxonomyVersion?: string;
  }[];
  limit: number;
  offset: number;
};
export type MaterialReadScope = { tenantId?: string; platformAuthority: boolean };

export type MaterialStore = {
  transaction<T>(operation: (store: MaterialStore) => Promise<T>): Promise<T>;
  insertChemicalEntity(
    input: Omit<ChemicalEntityRecord, "createdAt" | "updatedAt">
  ): Promise<ChemicalEntityRecord>;
  findMaterialAggregate(
    materialId: string,
    includeChemicalEntity?: boolean
  ): Promise<MaterialAggregate | undefined>;
  findMaterialById(materialId: string): Promise<MaterialRecord | undefined>;
  findMaterialsByIdentifier(
    type: IdentifierType,
    normalizedValue: string
  ): Promise<MaterialRecord[]>;
  findMaterialsByNormalizedDisplayName(normalizedName: string): Promise<MaterialRecord[]>;
  searchMaterials(
    input: MaterialSearchInput,
    scope: MaterialReadScope
  ): Promise<MaterialAggregate[]>;
  insertMaterial(
    input: Omit<MaterialRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialRecord>;
  touchMaterial(materialId: string): Promise<void>;
  updateMaterial(
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
  ): Promise<MaterialRecord | undefined>;
  replaceIdentifiers(
    materialId: string,
    identifiers: readonly MaterialIdentifierRecord[]
  ): Promise<void>;
  upsertProperties(
    properties: Omit<MaterialPropertiesRecord, "createdAt" | "updatedAt">
  ): Promise<void>;
  replaceOdorAssignments(
    materialId: string,
    assignments: readonly MaterialOdorAssignmentRecord[]
  ): Promise<void>;
  replaceConcentrate(
    materialId: string,
    concentrate: MaterialConcentrateRecord | null
  ): Promise<void>;
  replaceComponents(
    materialId: string,
    components: readonly MaterialComponentRecord[]
  ): Promise<void>;
  insertChangeRequest(
    input: Omit<MaterialChangeRequestRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<MaterialChangeRequestRecord>;
  findChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined>;
  lockChangeRequest(requestId: string): Promise<MaterialChangeRequestRecord | undefined>;
  listChangeRequests(
    scope: MaterialReadScope,
    status?: ChangeRequestStatus
  ): Promise<MaterialChangeRequestRecord[]>;
  resolveChangeRequest(input: {
    requestId: string;
    status: Extract<ChangeRequestStatus, "APPROVED" | "REJECTED">;
    reviewedByUserId: string;
    reviewedByAuthority: ReviewAuthority;
    decisionNote: string | null;
  }): Promise<MaterialChangeRequestRecord | undefined>;
  insertAuditEvent(input: {
    tenantId?: string | null;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    requestId: string;
    correlationId: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void>;
};

export type TaxonomyData = {
  GRAND_FAMILIES: readonly string[];
  SUBFAMILIES: readonly string[];
  DESCRIPTORS: readonly string[];
  TEXTURES: readonly string[];
  SENSATIONS: readonly string[];
  SUB_TO_GRAND: Readonly<Record<string, string>>;
};
export class MaterialProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
  }
}

const nonEmptyText = z.string().trim().min(1).max(240);
const nullableText = z.string().trim().min(1).max(1000).nullable().optional();
const measurementSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);
const identifierInputSchema = z.object({
  identifierType: identifierTypeSchema,
  value: nonEmptyText
});
const odorAssignmentInputSchema = z.object({
  taxonomyVersion: z.string().trim().min(1).max(40),
  assignmentType: odorAssignmentTypeSchema,
  taxonomyTerm: nonEmptyText,
  intensity: z.number().int().min(1).max(10).nullable().optional()
});
const concentrateInputSchema = z
  .object({
    sourceMaterialId: z.string().uuid(),
    concentrationPct: z.number().gt(0).lt(100),
    solventMaterialId: z.string().uuid().nullable().optional(),
    solventCustomName: nonEmptyText.nullable().optional()
  })
  .refine((value) => value.solventMaterialId || value.solventCustomName, {
    message: "A dilution requires a solvent."
  });
const componentInputSchema = z.object({
  componentMaterialId: z.string().uuid(),
  percentage: z.number().min(0).max(100).nullable().optional(),
  role: componentRoleSchema.default("COMPONENT")
});
const propertiesInputSchema = z.object({
  appearance: nullableText,
  assay: nullableText,
  fccListed: z.boolean().nullable().optional(),
  specificGravity: measurementSchema.nullable().optional(),
  poundsPerGallon: measurementSchema.nullable().optional(),
  refractiveIndex: measurementSchema.nullable().optional(),
  boilingPoint: measurementSchema.nullable().optional(),
  acidValue: measurementSchema.nullable().optional(),
  vaporPressure: measurementSchema.nullable().optional(),
  flashPoint: measurementSchema.nullable().optional(),
  logpOw: measurementSchema.nullable().optional(),
  shelfLife: nullableText,
  storage: nullableText,
  sourceReference: nullableText,
  ifraCat4MaxPct: z.number().min(0).max(100).nullable().optional(),
  ifraAmendment: nullableText,
  ifraSourceReference: nullableText
});
const materialSubmissionSchema = z.object({
  displayName: nonEmptyText,
  materialType: materialTypeSchema,
  visibility: materialVisibilitySchema.default("PRIVATE"),
  noteClassification: noteClassificationSchema.nullable().optional(),
  identifiers: z.array(identifierInputSchema).max(12).default([]),
  properties: propertiesInputSchema.optional(),
  odorAssignments: z.array(odorAssignmentInputSchema).max(80).default([]),
  concentrate: concentrateInputSchema.nullable().optional(),
  components: z.array(componentInputSchema).max(200).default([])
});
const changeProposalSchema = z.discriminatedUnion("requestType", [
  z.object({ requestType: z.literal("CREATE"), submission: materialSubmissionSchema }),
  z
    .object({
      requestType: z.literal("IDENTITY"),
      displayName: nonEmptyText.optional(),
      identifiers: z.array(identifierInputSchema).max(12).optional()
    })
    .refine((value) => value.displayName !== undefined || value.identifiers !== undefined),
  z.object({ requestType: z.literal("PHYSICAL"), properties: propertiesInputSchema }),
  z
    .object({
      requestType: z.literal("OLFACTIVE"),
      noteClassification: noteClassificationSchema.nullable().optional(),
      odorAssignments: z.array(odorAssignmentInputSchema).max(80).optional()
    })
    .refine(
      (value) => value.noteClassification !== undefined || value.odorAssignments !== undefined
    ),
  z.object({ requestType: z.literal("DILUTION"), concentrate: concentrateInputSchema }),
  z.object({
    requestType: z.literal("COMPONENTS"),
    components: z.array(componentInputSchema).max(200)
  }),
  z
    .object({
      requestType: z.literal("GENERAL"),
      displayName: nonEmptyText.optional(),
      visibility: materialVisibilitySchema.optional(),
      noteClassification: noteClassificationSchema.nullable().optional()
    })
    .refine((value) => Object.keys(value).length > 1)
]);
export type MaterialSubmission = z.infer<typeof materialSubmissionSchema>;
export type MaterialChangeProposal = z.infer<typeof changeProposalSchema>;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
export function normalizeIdentifier(type: IdentifierType, value: string): string {
  const trimmed = value.trim();
  return type === "INCI"
    ? trimmed.replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : type === "FEMA"
      ? trimmed.toLocaleUpperCase("en-US")
      : trimmed;
}
export type IdentityResolution =
  | { kind: "EXACT_MATCH"; materialId: string; matchedBy: IdentifierType | "DISPLAY_NAME" }
  | {
      kind: "POSSIBLE_MATCH";
      materialIds: readonly string[];
      matchedBy: IdentifierType | "DISPLAY_NAME";
    }
  | { kind: "NO_MATCH" };
export async function resolveMaterialIdentity(
  store: Pick<MaterialStore, "findMaterialsByIdentifier" | "findMaterialsByNormalizedDisplayName">,
  input: Pick<MaterialSubmission, "displayName" | "identifiers">
): Promise<IdentityResolution> {
  for (const type of ["CAS", "FEMA", "INCI"] as const) {
    const identifier = input.identifiers.find((item) => item.identifierType === type);
    if (!identifier) continue;
    const matches = await store.findMaterialsByIdentifier(
      type,
      normalizeIdentifier(type, identifier.value)
    );
    if (matches.length === 1)
      return { kind: "EXACT_MATCH", materialId: matches[0].id, matchedBy: type };
    if (matches.length > 1)
      return {
        kind: "POSSIBLE_MATCH",
        materialIds: matches.map((item) => item.id),
        matchedBy: type
      };
  }
  const matches = await store.findMaterialsByNormalizedDisplayName(
    normalizeDisplayName(input.displayName)
  );
  return matches.length === 1
    ? { kind: "EXACT_MATCH", materialId: matches[0].id, matchedBy: "DISPLAY_NAME" }
    : matches.length > 1
      ? {
          kind: "POSSIBLE_MATCH",
          materialIds: matches.map((item) => item.id),
          matchedBy: "DISPLAY_NAME"
        }
      : { kind: "NO_MATCH" };
}

export class OsmoTaxonomyRegistry {
  constructor(
    private readonly versions: Readonly<Record<string, TaxonomyData>> = { "1.2": osmoV12 }
  ) {}
  metadata(version: string) {
    const taxonomy = this.versions[version];
    if (!taxonomy)
      throw new MaterialProblem(400, "INVALID_TAXONOMY_TERM", "Taxonomy version is unavailable.");
    return {
      version,
      grandFamilies: taxonomy.GRAND_FAMILIES.length,
      subfamilies: taxonomy.SUBFAMILIES.length
    };
  }
  validate(assignments: readonly Omit<MaterialOdorAssignmentRecord, "materialId">[]): void {
    const grouped = new Map<string, Omit<MaterialOdorAssignmentRecord, "materialId">[]>();
    for (const assignment of assignments) {
      const list = grouped.get(assignment.taxonomyVersion) ?? [];
      list.push(assignment);
      grouped.set(assignment.taxonomyVersion, list);
      const taxonomy = this.versions[assignment.taxonomyVersion];
      if (!taxonomy || !termsFor(taxonomy, assignment.assignmentType).has(assignment.taxonomyTerm))
        throw new MaterialProblem(
          400,
          "INVALID_TAXONOMY_TERM",
          "Taxonomy term is not canonical for its version and type."
        );
      if (
        assignment.intensity !== null &&
        (!Number.isInteger(assignment.intensity) ||
          assignment.intensity < 1 ||
          assignment.intensity > 10)
      )
        throw new MaterialProblem(
          400,
          "VALIDATION_FAILED",
          "Odor intensity must be between 1 and 10."
        );
    }
    for (const [version, values] of grouped) {
      const taxonomy = this.versions[version];
      const grandFamilies = values
        .filter((item) => item.assignmentType === "GRAND_FAMILY")
        .map((item) => item.taxonomyTerm);
      if (grandFamilies.length !== 1) continue;
      for (const subfamily of values.filter((item) => item.assignmentType === "SUBFAMILY"))
        if (taxonomy.SUB_TO_GRAND[subfamily.taxonomyTerm] !== grandFamilies[0])
          throw new MaterialProblem(
            400,
            "INVALID_TAXONOMY_TERM",
            "Subfamily does not belong to the selected Grand Family."
          );
    }
  }
}
function termsFor(taxonomy: TaxonomyData, type: OdorAssignmentType): ReadonlySet<string> {
  return new Set(
    type === "GRAND_FAMILY"
      ? taxonomy.GRAND_FAMILIES
      : type === "SUBFAMILY"
        ? taxonomy.SUBFAMILIES
        : type === "DESCRIPTOR"
          ? taxonomy.DESCRIPTORS
          : type === "TEXTURE"
            ? taxonomy.TEXTURES
            : taxonomy.SENSATIONS
  );
}

export function validateMaterialAggregate(
  aggregate: Pick<MaterialAggregate, "material" | "odorAssignments" | "concentrate" | "components">,
  taxonomy: OsmoTaxonomyRegistry
): void {
  const { material, concentrate, components } = aggregate;
  if (material.scope === "PLATFORM" && material.tenantId !== null)
    throw invalid("Platform Material cannot carry a tenant.");
  if (material.scope === "TENANT" && material.tenantId === null)
    throw invalid("Tenant Material requires a tenant.");
  if (material.materialType !== "SINGLE_MOLECULE" && material.chemicalEntityId !== null)
    throw invalid("Only SINGLE_MOLECULE may directly reference ChemicalEntity.");
  if (material.materialType === "DILUTION" && !concentrate)
    throw invalid("DILUTION requires a concentrate relation.");
  if (material.materialType !== "DILUTION" && concentrate)
    throw invalid("Only DILUTION may have a concentrate relation.");
  if (material.materialType === "DILUTION" && components.length > 0)
    throw invalid("DILUTION cannot use composition components.");
  if (!["NATURAL", "MIXTURE"].includes(material.materialType) && components.length > 0)
    throw invalid("Only NATURAL and MIXTURE may have components.");
  if (
    concentrate &&
    (concentrate.materialId === concentrate.sourceMaterialId ||
      !(concentrate.concentrationPct > 0 && concentrate.concentrationPct < 100))
  )
    throw invalid("Dilution concentrate is invalid.");
  if (concentrate && !concentrate.solventMaterialId && !concentrate.solventCustomName)
    throw invalid("Dilution requires a solvent.");
  if (components.some((item) => item.materialId === item.componentMaterialId))
    throw invalid("A Material cannot component-reference itself.");
  if (components.reduce((sum, item) => sum + (item.percentage ?? 0), 0) > 100)
    throw new MaterialProblem(
      400,
      "INVALID_COMPONENT_TOTAL",
      "Known component percentages cannot exceed 100."
    );
  if (
    material.visibility === "SHARED" &&
    material.scope === "TENANT" &&
    material.approvalStatus !== "APPROVED"
  )
    throw invalid("Only approved tenant Materials may be shared.");
  taxonomy.validate(aggregate.odorAssignments);
}
function invalid(message: string): MaterialProblem {
  return new MaterialProblem(400, "INVALID_MATERIAL_TYPE_OPERATION", message);
}
export function canReadMaterial(
  context: { tenantId?: string; platformAuthority: boolean },
  material: MaterialRecord
): boolean {
  return (
    context.platformAuthority ||
    material.scope === "PLATFORM" ||
    context.tenantId === material.tenantId ||
    (material.visibility === "SHARED" && material.approvalStatus === "APPROVED")
  );
}
/** Downstream eligibility is derived from access plus approval; it is never persisted. */
export function isMaterialEligibleForDownstream(
  context: MaterialReadScope,
  material: MaterialRecord
): boolean {
  return canReadMaterial(context, material) && material.approvalStatus === "APPROVED";
}

export type MaterialTenantDetail = {
  id: string;
  tenantId: string | null;
  scope: MaterialScope;
  visibility: MaterialVisibility;
  displayName: string;
  materialType: MaterialType;
  approvalStatus: MaterialApprovalStatus;
  noteClassification: NoteClassification | null;
  contributor: { tenantId: string | null; userId?: string };
  approval: { authority: ReviewAuthority | null; approvedByUserId?: string };
  identifiers: readonly MaterialIdentifierRecord[];
  properties: Omit<MaterialPropertiesRecord, "materialId" | "createdAt" | "updatedAt"> | null;
  odorAssignments: readonly MaterialOdorAssignmentRecord[];
  concentrate: MaterialConcentrateRecord | null;
  components: readonly MaterialComponentRecord[];
};
export function toTenantMaterialDetail(
  aggregate: MaterialAggregate,
  viewer: MaterialReadScope
): MaterialTenantDetail {
  const ownTenant = viewer.tenantId === aggregate.material.tenantId;
  const maySeeUser = ownTenant || viewer.platformAuthority;
  const { material, properties } = aggregate;
  return {
    id: material.id,
    tenantId: material.tenantId,
    scope: material.scope,
    visibility: material.visibility,
    displayName: material.displayName,
    materialType: material.materialType,
    approvalStatus: material.approvalStatus,
    noteClassification: material.noteClassification,
    contributor: {
      tenantId: material.tenantId,
      ...(maySeeUser ? { userId: material.contributorUserId } : {})
    },
    approval: {
      authority: material.approvedByAuthority,
      ...(maySeeUser ? { approvedByUserId: material.approvedByUserId ?? undefined } : {})
    },
    identifiers: aggregate.identifiers.map((item) => ({ ...item })),
    properties: properties ? stripProperties(properties) : null,
    odorAssignments: aggregate.odorAssignments.map((item) => ({ ...item })),
    concentrate: aggregate.concentrate ? { ...aggregate.concentrate } : null,
    components: aggregate.components.map((item) => ({ ...item }))
  };
}
function stripProperties(
  properties: MaterialPropertiesRecord
): Omit<MaterialPropertiesRecord, "materialId" | "createdAt" | "updatedAt"> {
  const {
    materialId: _materialId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...safe
  } = properties;
  return safe;
}

export type MaterialIntelligenceSnapshot = {
  schemaVersion: typeof MATERIAL_SNAPSHOT_SCHEMA_VERSION;
  capturedAt: string;
  sourceMaterialUpdatedAt: string;
  snapshotHash: string;
  material: Pick<
    MaterialRecord,
    | "id"
    | "displayName"
    | "materialType"
    | "approvalStatus"
    | "scope"
    | "visibility"
    | "noteClassification"
  >;
  identifiers: Record<IdentifierType, readonly string[]>;
  properties: MaterialTenantDetail["properties"];
  odorAssignments: readonly Omit<MaterialOdorAssignmentRecord, "materialId">[];
  concentrate: Omit<MaterialConcentrateRecord, "materialId"> | null;
  components: readonly Omit<MaterialComponentRecord, "materialId">[];
  scientificInternal?: {
    chemicalEntity: Omit<ChemicalEntityRecord, "id" | "canonicalName" | "createdAt" | "updatedAt">;
  };
};
export function buildMaterialSnapshot(
  aggregate: MaterialAggregate,
  includeScientificInternal: boolean
): MaterialIntelligenceSnapshot {
  const identifiers = {
    CAS: aggregate.identifiers
      .filter((item) => item.identifierType === "CAS")
      .map((item) => item.value)
      .sort(),
    FEMA: aggregate.identifiers
      .filter((item) => item.identifierType === "FEMA")
      .map((item) => item.value)
      .sort(),
    INCI: aggregate.identifiers
      .filter((item) => item.identifierType === "INCI")
      .map((item) => item.value)
      .sort()
  } satisfies Record<IdentifierType, readonly string[]>;
  const semantic = {
    schemaVersion: MATERIAL_SNAPSHOT_SCHEMA_VERSION,
    material: {
      id: aggregate.material.id,
      displayName: aggregate.material.displayName,
      materialType: aggregate.material.materialType,
      approvalStatus: aggregate.material.approvalStatus,
      scope: aggregate.material.scope,
      visibility: aggregate.material.visibility,
      noteClassification: aggregate.material.noteClassification
    },
    identifiers,
    properties: aggregate.properties ? stripProperties(aggregate.properties) : null,
    odorAssignments: aggregate.odorAssignments
      .map(({ materialId: _materialId, ...item }) => item)
      .sort(stableCompare),
    concentrate: aggregate.concentrate ? withoutMaterialId(aggregate.concentrate) : null,
    components: aggregate.components.map(withoutMaterialId).sort(stableCompare),
    scientificInternal:
      includeScientificInternal && aggregate.chemicalEntity
        ? { chemicalEntity: withoutChemicalIdentity(aggregate.chemicalEntity) }
        : undefined
  };
  const snapshotHash = createHash("sha256").update(canonicalJson(semantic)).digest("hex");
  return {
    ...semantic,
    capturedAt: new Date().toISOString(),
    sourceMaterialUpdatedAt: aggregate.material.updatedAt.toISOString(),
    snapshotHash
  };
}
export function toTenantSnapshot(
  snapshot: MaterialIntelligenceSnapshot
): Omit<MaterialIntelligenceSnapshot, "scientificInternal"> {
  const { scientificInternal: _scientificInternal, ...tenantSnapshot } = snapshot;
  return tenantSnapshot;
}
function withoutMaterialId<T extends { materialId: string }>(value: T): Omit<T, "materialId"> {
  const { materialId: _materialId, ...rest } = value;
  return rest;
}
function withoutChemicalIdentity(
  value: ChemicalEntityRecord
): Omit<ChemicalEntityRecord, "id" | "canonicalName" | "createdAt" | "updatedAt"> {
  const {
    id: _id,
    canonicalName: _name,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = value;
  return rest;
}
function stableCompare(left: object, right: object): number {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map(
          (key) =>
            JSON.stringify(key) + ":" + canonicalJson((value as Record<string, unknown>)[key])
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export type TgscReferenceCandidate = {
  cas: string;
  displayName: string;
  sourceReference: string;
  fields: Readonly<Record<string, string>>;
};
export interface TgscReferenceAdapter {
  lookupByCas(cas: string): Promise<TgscReferenceCandidate | { kind: "NOT_FOUND" }>;
}
export type MaterialApiOptions = {
  store: MaterialStore;
  authorization: {
    authenticated(request: ApiRequest): Promise<AuthenticatedRequestContext>;
    tenantContext(request: ApiRequest): Promise<TenantRequestContext>;
  };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
  taxonomy?: OsmoTaxonomyRegistry;
};

export class MaterialIntelligenceApi {
  private readonly taxonomy: OsmoTaxonomyRegistry;
  constructor(private readonly options: MaterialApiOptions) {
    this.taxonomy = options.taxonomy ?? new OsmoTaxonomyRegistry();
  }
  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/materials",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.read);
        const parsed = parseQuery(searchInputSchema, request);
        const input: MaterialSearchInput = {
          ...parsed,
          taxonomyFilters: parsed.taxonomyTerm
            ? [
                {
                  assignmentType: parsed.taxonomyAssignmentType!,
                  taxonomyTerm: parsed.taxonomyTerm,
                  taxonomyVersion: parsed.taxonomyVersion
                }
              ]
            : []
        };
        const materials = await this.options.store.searchMaterials(input, {
          tenantId: context.tenant.tenantId,
          platformAuthority: false
        });
        return {
          status: 200,
          body: {
            materials: materials.map((item) =>
              toTenantMaterialDetail(item, {
                tenantId: context.tenant.tenantId,
                platformAuthority: false
              })
            )
          }
        };
      })
    );
    registrar.get(
      "/materials/:materialId",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.read);
        const aggregate = await this.requireReadable(routeUuid(request, "materialId"), {
          tenantId: context.tenant.tenantId,
          platformAuthority: false
        });
        return {
          status: 200,
          body: {
            material: toTenantMaterialDetail(aggregate, {
              tenantId: context.tenant.tenantId,
              platformAuthority: false
            })
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/materials",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.create);
        const submission = parseBody(materialSubmissionSchema, request);
        if (submission.visibility === "SHARED")
          throw new MaterialProblem(
            400,
            "INVALID_MATERIAL_TYPE_OPERATION",
            "New tenant Materials begin PRIVATE until approved and explicitly shared."
          );
        const created = await this.createTenantMaterial(context, submission);
        return {
          status: 201,
          body: {
            material: toTenantMaterialDetail(created.aggregate, {
              tenantId: context.tenant.tenantId,
              platformAuthority: false
            }),
            changeRequestId: created.changeRequest.id,
            identityResolution: created.identityResolution
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/materials/:materialId/change-requests",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.requestChange);
        const materialId = routeUuid(request, "materialId");
        const aggregate = await this.requireReadable(materialId, {
          tenantId: context.tenant.tenantId,
          platformAuthority: false
        });
        if (
          aggregate.material.scope === "TENANT" &&
          aggregate.material.tenantId !== context.tenant.tenantId
        )
          throw notFound();
        const proposal = parseBody(changeProposalSchema, request);
        if (proposal.requestType === "CREATE")
          throw new MaterialProblem(
            400,
            "VALIDATION_FAILED",
            "CREATE is reserved for initial Material creation."
          );
        if (proposal.requestType === "GENERAL" && proposal.visibility === "SHARED")
          this.requireModule(context, MATERIAL_PERMISSIONS.share);
        validateProposalAgainstAggregate(aggregate, proposal, this.taxonomy);
        const changeRequest = await this.options.store.transaction(async (store) => {
          const change = await store.insertChangeRequest({
            materialId,
            tenantId: context.tenant.tenantId,
            requestedByUserId: context.actor.userId,
            requestType: proposal.requestType,
            proposedPatch: proposal,
            status: "PENDING_REVIEW",
            reviewedByUserId: null,
            reviewedByAuthority: null,
            decisionNote: null
          });
          await audit(
            store,
            context,
            "module.material-intelligence.change.submit",
            "material_change_request",
            change.id,
            aggregate.material.tenantId
          );
          return change;
        });
        return { status: 201, body: { changeRequest: changeRequestPayload(changeRequest) } };
      })
    );
    registrar.get(
      "/material-change-requests",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.requestChange);
        const status = parseQuery(
          z.object({ status: changeRequestStatusSchema.optional() }),
          request
        ).status;
        const changes = await this.options.store.listChangeRequests(
          { tenantId: context.tenant.tenantId, platformAuthority: false },
          status
        );
        return { status: 200, body: { changeRequests: changes.map(changeRequestPayload) } };
      })
    );
    registrar.get(
      "/material-change-requests/:requestId",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.requestChange);
        const change = await this.options.store.findChangeRequest(routeUuid(request, "requestId"));
        if (!change || (change.tenantId && change.tenantId !== context.tenant.tenantId))
          throw notFound();
        return { status: 200, body: { changeRequest: changeRequestPayload(change) } };
      })
    );
    registrar.register(
      "POST",
      "/material-change-requests/:requestId/approve",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.approve);
        const change = await this.resolve(
          routeUuid(request, "requestId"),
          "APPROVED",
          context,
          parseBody(decisionSchema, request).decisionNote ?? null,
          "TENANT"
        );
        return { status: 200, body: { changeRequest: changeRequestPayload(change) } };
      })
    );
    registrar.register(
      "POST",
      "/material-change-requests/:requestId/reject",
      this.handle(async (request) => {
        const context = await this.tenant(request, MATERIAL_PERMISSIONS.approve);
        const change = await this.resolve(
          routeUuid(request, "requestId"),
          "REJECTED",
          context,
          parseBody(decisionSchema, request).decisionNote ?? null,
          "TENANT"
        );
        return { status: 200, body: { changeRequest: changeRequestPayload(change) } };
      })
    );
    registrar.get(
      "/platform/material-intelligence/review",
      this.handle(async (request) => {
        const context = await this.platform(request, MATERIAL_PLATFORM_PERMISSIONS.referenceRead);
        const changes = await this.options.store.listChangeRequests(
          { platformAuthority: true },
          parseQuery(z.object({ status: changeRequestStatusSchema.optional() }), request).status
        );
        return {
          status: 200,
          body: { changeRequests: changes.map(changeRequestPayload), actorId: context.actor.userId }
        };
      })
    );
    registrar.get(
      "/platform/material-intelligence/review/:requestId",
      this.handle(async (request) => {
        await this.platform(request, MATERIAL_PLATFORM_PERMISSIONS.referenceRead);
        const change = await this.options.store.findChangeRequest(routeUuid(request, "requestId"));
        if (!change) throw notFound();
        const aggregate = await this.options.store.findMaterialAggregate(change.materialId, true);
        if (!aggregate) throw notFound();
        return {
          status: 200,
          body: {
            changeRequest: changeRequestPayload(change),
            material: toReviewMaterialDetail(aggregate)
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/platform/material-intelligence/review/:requestId/approve",
      this.handle(async (request) => {
        const context = await this.platform(request, MATERIAL_PLATFORM_PERMISSIONS.reviewApprove);
        const change = await this.resolve(
          routeUuid(request, "requestId"),
          "APPROVED",
          context,
          parseBody(decisionSchema, request).decisionNote ?? null,
          "PLATFORM"
        );
        return { status: 200, body: { changeRequest: changeRequestPayload(change) } };
      })
    );
    registrar.register(
      "POST",
      "/platform/material-intelligence/review/:requestId/reject",
      this.handle(async (request) => {
        const context = await this.platform(request, MATERIAL_PLATFORM_PERMISSIONS.reviewApprove);
        const change = await this.resolve(
          routeUuid(request, "requestId"),
          "REJECTED",
          context,
          parseBody(decisionSchema, request).decisionNote ?? null,
          "PLATFORM"
        );
        return { status: 200, body: { changeRequest: changeRequestPayload(change) } };
      })
    );
  }
  async buildSnapshot(
    materialId: string,
    options: { includeScientificInternal: boolean }
  ): Promise<MaterialIntelligenceSnapshot> {
    const aggregate = await this.options.store.findMaterialAggregate(
      materialId,
      options.includeScientificInternal
    );
    if (!aggregate) throw notFound();
    return buildMaterialSnapshot(aggregate, options.includeScientificInternal);
  }
  private async createTenantMaterial(
    context: TenantRequestContext,
    submission: MaterialSubmission
  ) {
    const identityResolution = await resolveMaterialIdentity(this.options.store, submission);
    return this.options.store.transaction(async (store) => {
      const material = await store.insertMaterial({
        tenantId: context.tenant.tenantId,
        scope: "TENANT",
        visibility: "PRIVATE",
        displayName: submission.displayName,
        normalizedDisplayName: normalizeDisplayName(submission.displayName),
        materialType: submission.materialType,
        approvalStatus: "PENDING_REVIEW",
        noteClassification: submission.noteClassification ?? null,
        chemicalEntityId: null,
        contributorUserId: context.actor.userId,
        approvedByUserId: null,
        approvedByAuthority: null
      });
      await replaceAggregateChildren(store, material, submission, this.taxonomy);
      const aggregate = await store.findMaterialAggregate(material.id, true);
      if (!aggregate) throw new Error("Material aggregate was not persisted.");
      validateMaterialAggregate(aggregate, this.taxonomy);
      const changeRequest = await store.insertChangeRequest({
        materialId: material.id,
        tenantId: context.tenant.tenantId,
        requestedByUserId: context.actor.userId,
        requestType: "CREATE",
        proposedPatch: { requestType: "CREATE", submission },
        status: "PENDING_REVIEW",
        reviewedByUserId: null,
        reviewedByAuthority: null,
        decisionNote: null
      });
      await audit(
        store,
        context,
        "module.material-intelligence.material.create",
        "material",
        material.id,
        material.tenantId
      );
      await audit(
        store,
        context,
        "module.material-intelligence.change.submit",
        "material_change_request",
        changeRequest.id,
        material.tenantId
      );
      return { aggregate, changeRequest, identityResolution };
    });
  }
  private async resolve(
    requestId: string,
    status: "APPROVED" | "REJECTED",
    context: TenantRequestContext | AuthenticatedRequestContext,
    decisionNote: string | null,
    authority: ReviewAuthority
  ): Promise<MaterialChangeRequestRecord> {
    return this.options.store.transaction(async (store) => {
      const request = await store.lockChangeRequest(requestId);
      if (!request) throw notFound();
      if (request.status !== "PENDING_REVIEW")
        throw new MaterialProblem(
          409,
          "ALREADY_RESOLVED",
          "Material change request has already been resolved."
        );
      const aggregate = await store.findMaterialAggregate(request.materialId, true);
      if (!aggregate) throw notFound();
      if (authority === "TENANT") {
        const tenant = (context as TenantRequestContext).tenant;
        if (
          aggregate.material.scope !== "TENANT" ||
          aggregate.material.tenantId !== tenant.tenantId
        )
          throw new MaterialProblem(403, "FORBIDDEN", "Tenant review authority is not granted.");
      }
      if (status === "APPROVED") {
        if (
          request.proposedPatch.requestType === "GENERAL" &&
          request.proposedPatch.visibility === "SHARED"
        ) {
          if (authority === "TENANT")
            this.requireModule(context as TenantRequestContext, MATERIAL_PERMISSIONS.share);
          else if (
            !(context as AuthenticatedRequestContext).actor.platformPermissions.includes(
              MATERIAL_PLATFORM_PERMISSIONS.referenceManage
            )
          )
            throw new MaterialProblem(
              403,
              "PLATFORM_ACCESS_DENIED",
              "Platform sharing authority is not granted."
            );
        }
        applyProposal(aggregate, request.proposedPatch, this.taxonomy);
        validateMaterialAggregate(aggregate, this.taxonomy);
        if (request.proposedPatch.requestType === "CREATE") {
          const updated = await store.updateMaterial(aggregate.material.id, {
            approvalStatus: "APPROVED",
            approvedByUserId: context.actor.userId,
            approvedByAuthority: authority
          });
          if (!updated) throw notFound();
        } else
          await persistApprovedProposal(store, aggregate, request.proposedPatch, this.taxonomy);
      }
      const resolved = await store.resolveChangeRequest({
        requestId: request.id,
        status,
        reviewedByUserId: context.actor.userId,
        reviewedByAuthority: authority,
        decisionNote
      });
      if (!resolved) throw notFound();
      await audit(
        store,
        context,
        status === "APPROVED"
          ? "module.material-intelligence.change.approve"
          : "module.material-intelligence.change.reject",
        "material_change_request",
        request.id,
        aggregate.material.tenantId
      );
      if (status === "APPROVED")
        await audit(
          store,
          context,
          "module.material-intelligence.material.approve",
          "material",
          aggregate.material.id,
          aggregate.material.tenantId
        );
      return resolved;
    });
  }
  private async requireReadable(
    materialId: string,
    scope: MaterialReadScope
  ): Promise<MaterialAggregate> {
    const aggregate = await this.options.store.findMaterialAggregate(materialId, false);
    if (!aggregate || !canReadMaterial(scope, aggregate.material)) throw notFound();
    return aggregate;
  }
  private async tenant(request: ApiRequest, permission: string): Promise<TenantRequestContext> {
    const context = await this.options.authorization.tenantContext(request);
    this.requireModule(context, permission);
    return context;
  }
  private async platform(
    request: ApiRequest,
    permission: PlatformPermission
  ): Promise<AuthenticatedRequestContext> {
    const context = await this.options.authorization.authenticated(request);
    if (!context.actor.platformPermissions.includes(permission))
      throw new MaterialProblem(403, "PLATFORM_ACCESS_DENIED", "Platform access is not granted.");
    return context;
  }
  private requireModule(context: TenantRequestContext, permission: string): void {
    const definition = this.options.definitions.find(
      (item) => item.descriptor.id === MATERIAL_MODULE_ID
    );
    if (
      !definition ||
      definition.descriptor.lifecycle === "DISABLED" ||
      definition.descriptor.lifecycle === "DEPRECATED" ||
      !this.options.featureFlags.isEnabled(definition.descriptor.featureFlag) ||
      !context.entitlements.includes(MATERIAL_ENTITLEMENT) ||
      !context.authorization.modulePermissions.includes(permission)
    )
      throw new MaterialProblem(
        403,
        "PERMISSION_DENIED",
        "Material Intelligence access is not granted."
      );
  }
  private handle(handler: (request: ApiRequest) => Promise<ApiResponse>) {
    return async (request: ApiRequest): Promise<ApiResponse> => {
      try {
        return await handler(request);
      } catch (error) {
        if (isProblem(error))
          return {
            status: error.status,
            body: {
              error: {
                code: error.code,
                message: error.message,
                requestId: request.context.requestId
              }
            }
          };
        throw error;
      }
    };
  }
}

function isProblem(value: unknown): value is { status: number; code: ErrorCode; message: string } {
  return Boolean(
    value && typeof value === "object" && "status" in value && "code" in value && "message" in value
  );
}
function parseBody<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const result = schema.safeParse(request.body);
  if (!result.success)
    throw new MaterialProblem(400, "VALIDATION_FAILED", "Request validation failed.");
  return result.data;
}
function parseQuery<T>(schema: z.ZodType<T>, request: ApiRequest): T {
  const result = schema.safeParse(request.query ?? {});
  if (!result.success)
    throw new MaterialProblem(400, "VALIDATION_FAILED", "Request query is invalid.");
  return result.data;
}
function routeUuid(request: ApiRequest, name: string): string {
  const value = request.params?.[name];
  if (!value || !z.string().uuid().safeParse(value).success)
    throw new MaterialProblem(400, "VALIDATION_FAILED", "Request path parameter is invalid.");
  return value;
}
function notFound(): MaterialProblem {
  return new MaterialProblem(404, "NOT_FOUND", "Material resource was not found.");
}
const decisionSchema = z.object({
  decisionNote: z.string().trim().min(1).max(1000).nullable().optional()
});
const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(240).optional(),
    materialType: materialTypeSchema.optional(),
    approvalStatus: materialApprovalStatusSchema.optional(),
    scope: materialScopeSchema.optional(),
    visibility: materialVisibilitySchema.optional(),
    noteClassification: noteClassificationSchema.optional(),
    taxonomyAssignmentType: odorAssignmentTypeSchema.optional(),
    taxonomyTerm: nonEmptyText.optional(),
    taxonomyVersion: z.string().trim().min(1).max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  })
  .refine(
    (value) =>
      (value.taxonomyAssignmentType === undefined && value.taxonomyTerm === undefined) ||
      (value.taxonomyAssignmentType !== undefined && value.taxonomyTerm !== undefined),
    "Taxonomy filtering requires both assignment type and canonical term."
  );
function changeRequestPayload(change: MaterialChangeRequestRecord) {
  return {
    id: change.id,
    materialId: change.materialId,
    tenantId: change.tenantId,
    requestType: change.requestType,
    proposedPatch: change.proposedPatch,
    status: change.status,
    reviewedByAuthority: change.reviewedByAuthority,
    decisionNote: change.decisionNote,
    createdAt: change.createdAt,
    updatedAt: change.updatedAt
  };
}
function toReviewMaterialDetail(aggregate: MaterialAggregate) {
  return {
    ...toTenantMaterialDetail(aggregate, { platformAuthority: true }),
    scientificInternal: aggregate.chemicalEntity
      ? withoutChemicalIdentity(aggregate.chemicalEntity)
      : null
  };
}
async function audit(
  store: MaterialStore,
  context: TenantRequestContext | AuthenticatedRequestContext,
  action: string,
  resourceType: string,
  resourceId: string,
  tenantId: string | null
) {
  await store.insertAuditEvent({
    tenantId,
    actorUserId: context.actor.userId,
    action,
    resourceType,
    resourceId,
    requestId: context.requestId,
    correlationId: context.correlationId
  });
}
function inputIdentifiers(
  materialId: string,
  values: readonly z.infer<typeof identifierInputSchema>[]
): MaterialIdentifierRecord[] {
  return values.map((item) => ({
    materialId,
    identifierType: item.identifierType,
    value: item.value,
    normalizedValue: normalizeIdentifier(item.identifierType, item.value)
  }));
}
function inputOdors(
  materialId: string,
  values: readonly z.infer<typeof odorAssignmentInputSchema>[]
): MaterialOdorAssignmentRecord[] {
  return values.map((item) => ({
    materialId,
    taxonomyVersion: item.taxonomyVersion,
    assignmentType: item.assignmentType,
    taxonomyTerm: item.taxonomyTerm,
    intensity: item.intensity ?? null
  }));
}
function inputConcentrate(
  materialId: string,
  value: z.infer<typeof concentrateInputSchema> | null | undefined
): MaterialConcentrateRecord | null {
  return value
    ? {
        materialId,
        sourceMaterialId: value.sourceMaterialId,
        concentrationPct: value.concentrationPct,
        solventMaterialId: value.solventMaterialId ?? null,
        solventCustomName: value.solventCustomName ?? null
      }
    : null;
}
function inputComponents(
  materialId: string,
  values: readonly z.infer<typeof componentInputSchema>[]
): MaterialComponentRecord[] {
  return values.map((item) => ({
    materialId,
    componentMaterialId: item.componentMaterialId,
    percentage: item.percentage ?? null,
    role: item.role
  }));
}
function inputProperties(
  materialId: string,
  input: z.infer<typeof propertiesInputSchema>
): Omit<MaterialPropertiesRecord, "createdAt" | "updatedAt"> {
  return {
    materialId,
    appearance: input.appearance ?? null,
    assay: input.assay ?? null,
    fccListed: input.fccListed ?? null,
    specificGravity: input.specificGravity ?? null,
    poundsPerGallon: input.poundsPerGallon ?? null,
    refractiveIndex: input.refractiveIndex ?? null,
    boilingPoint: input.boilingPoint ?? null,
    acidValue: input.acidValue ?? null,
    vaporPressure: input.vaporPressure ?? null,
    flashPoint: input.flashPoint ?? null,
    logpOw: input.logpOw ?? null,
    shelfLife: input.shelfLife ?? null,
    storage: input.storage ?? null,
    sourceReference: input.sourceReference ?? null,
    ifraCat4MaxPct: input.ifraCat4MaxPct ?? null,
    ifraAmendment: input.ifraAmendment ?? null,
    ifraSourceReference: input.ifraSourceReference ?? null
  };
}
async function replaceAggregateChildren(
  store: MaterialStore,
  material: MaterialRecord,
  submission: MaterialSubmission,
  taxonomy: OsmoTaxonomyRegistry
): Promise<void> {
  const odorAssignments = inputOdors(material.id, submission.odorAssignments);
  const concentrate = inputConcentrate(material.id, submission.concentrate);
  const components = inputComponents(material.id, submission.components);
  validateMaterialAggregate({ material, odorAssignments, concentrate, components }, taxonomy);
  await store.replaceIdentifiers(
    material.id,
    inputIdentifiers(material.id, submission.identifiers)
  );
  if (submission.properties)
    await store.upsertProperties(inputProperties(material.id, submission.properties));
  await store.replaceOdorAssignments(material.id, odorAssignments);
  await store.replaceConcentrate(material.id, concentrate);
  await store.replaceComponents(material.id, components);
  await store.touchMaterial(material.id);
}
function validateProposalAgainstAggregate(
  aggregate: MaterialAggregate,
  proposal: MaterialChangeProposal,
  taxonomy: OsmoTaxonomyRegistry
): void {
  const next = structuredClone(aggregate) as MaterialAggregate;
  applyProposal(next, proposal, taxonomy);
  validateMaterialAggregate(next, taxonomy);
}
function applyProposal(
  aggregate: MaterialAggregate,
  proposal: MaterialChangeProposal,
  taxonomy: OsmoTaxonomyRegistry
): void {
  if (proposal.requestType === "CREATE") return;
  if (proposal.requestType === "IDENTITY") {
    if (proposal.displayName) {
      aggregate.material.displayName = proposal.displayName;
      aggregate.material.normalizedDisplayName = normalizeDisplayName(proposal.displayName);
    }
    if (proposal.identifiers)
      aggregate.identifiers = inputIdentifiers(aggregate.material.id, proposal.identifiers);
  }
  if (proposal.requestType === "PHYSICAL")
    aggregate.properties = {
      ...inputProperties(aggregate.material.id, proposal.properties),
      createdAt: aggregate.properties?.createdAt ?? new Date(0),
      updatedAt: aggregate.properties?.updatedAt ?? new Date(0)
    };
  if (proposal.requestType === "OLFACTIVE") {
    if (proposal.noteClassification !== undefined)
      aggregate.material.noteClassification = proposal.noteClassification;
    if (proposal.odorAssignments)
      aggregate.odorAssignments = inputOdors(aggregate.material.id, proposal.odorAssignments);
  }
  if (proposal.requestType === "DILUTION")
    aggregate.concentrate = inputConcentrate(aggregate.material.id, proposal.concentrate);
  if (proposal.requestType === "COMPONENTS")
    aggregate.components = inputComponents(aggregate.material.id, proposal.components);
  if (proposal.requestType === "GENERAL") {
    if (proposal.displayName) {
      aggregate.material.displayName = proposal.displayName;
      aggregate.material.normalizedDisplayName = normalizeDisplayName(proposal.displayName);
    }
    if (proposal.visibility) aggregate.material.visibility = proposal.visibility;
    if (proposal.noteClassification !== undefined)
      aggregate.material.noteClassification = proposal.noteClassification;
  }
  validateMaterialAggregate(aggregate, taxonomy);
}
async function persistApprovedProposal(
  store: MaterialStore,
  aggregate: MaterialAggregate,
  proposal: MaterialChangeProposal,
  taxonomy: OsmoTaxonomyRegistry
): Promise<void> {
  applyProposal(aggregate, proposal, taxonomy);
  const material = await store.updateMaterial(aggregate.material.id, {
    displayName: aggregate.material.displayName,
    normalizedDisplayName: aggregate.material.normalizedDisplayName,
    visibility: aggregate.material.visibility,
    noteClassification: aggregate.material.noteClassification
  });
  if (!material) throw notFound();
  if (proposal.requestType === "IDENTITY")
    await store.replaceIdentifiers(material.id, aggregate.identifiers);
  if (proposal.requestType === "PHYSICAL" && aggregate.properties)
    await store.upsertProperties(aggregate.properties);
  if (proposal.requestType === "OLFACTIVE")
    await store.replaceOdorAssignments(material.id, aggregate.odorAssignments);
  if (proposal.requestType === "DILUTION")
    await store.replaceConcentrate(material.id, aggregate.concentrate);
  if (proposal.requestType === "COMPONENTS")
    await store.replaceComponents(material.id, aggregate.components);
  await store.touchMaterial(material.id);
}
export function createMaterialIntelligenceApi(
  options: MaterialApiOptions
): MaterialIntelligenceApi {
  return new MaterialIntelligenceApi(options);
}
