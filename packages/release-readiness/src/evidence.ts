import type { RegulatoryMaterialEvidence } from "./contracts.js";

type CurrentRegulatoryProjection = {
  displayName: string;
  materialType: string;
  approvalStatus: string;
  sourceMaterialUpdatedAt: string;
  ifraRestricted: boolean;
  ifraCat4MaxPct: string | number | null;
  ifraLimits: Record<string, string | number | boolean | null>;
  ifraAmendment: string | null;
  ifraSourceReference: string | null;
  sourceReference: string | null;
  euAllergens: readonly unknown[];
};

export function tenantSafeCurrentRegulatoryProjection(input: {
  tenantAccessible: boolean;
  frozenDisplayName: string;
  frozenMaterialType: string;
  current?: CurrentRegulatoryProjection;
}): Pick<
  RegulatoryMaterialEvidence,
  | "displayName"
  | "materialType"
  | "approvalStatus"
  | "currentSourceMaterialUpdatedAt"
  | "ifraRestricted"
  | "ifraCat4MaxPct"
  | "ifraLimits"
  | "ifraAmendment"
  | "ifraSourceReference"
  | "sourceReference"
  | "euAllergens"
> {
  if (!input.tenantAccessible || !input.current) {
    return {
      displayName: input.frozenDisplayName,
      materialType: input.frozenMaterialType,
      approvalStatus: "INACCESSIBLE",
      currentSourceMaterialUpdatedAt: "UNAVAILABLE",
      ifraRestricted: false,
      ifraCat4MaxPct: null,
      ifraLimits: {},
      ifraAmendment: null,
      ifraSourceReference: null,
      sourceReference: null,
      euAllergens: []
    };
  }
  return {
    displayName: input.current.displayName,
    materialType: input.current.materialType,
    approvalStatus: input.current.approvalStatus,
    currentSourceMaterialUpdatedAt: input.current.sourceMaterialUpdatedAt,
    ifraRestricted: input.current.ifraRestricted,
    ifraCat4MaxPct: input.current.ifraCat4MaxPct,
    ifraLimits: input.current.ifraLimits,
    ifraAmendment: input.current.ifraAmendment,
    ifraSourceReference: input.current.ifraSourceReference,
    sourceReference: input.current.sourceReference,
    euAllergens: input.current.euAllergens
  };
}
