import { createHash } from "node:crypto";
import { REFERENCE_FORMULA_MASS_MG, type CompositionKind, type MassMg } from "./contracts.js";

export type FormulaBundleHashLine = {
  materialId: string;
  normalizedMassMg: MassMg;
  snapshotHash: string;
};

export function computeFormulaBundleHash(
  compositionKind: CompositionKind,
  lines: readonly FormulaBundleHashLine[]
): string {
  const canonicalLines = [...lines]
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
    .map((line) => ({
      materialId: line.materialId,
      normalizedMassMg: line.normalizedMassMg,
      snapshotHash: line.snapshotHash
    }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        compositionKind,
        referenceFormulaMassMg: REFERENCE_FORMULA_MASS_MG,
        lines: canonicalLines
      })
    )
    .digest("hex");
}

/**
 * The orchestration seam is approved; a PostgreSQL implementation is blocked
 * until the canonical formula_frozen_snapshots schema is supplied.
 */
export interface FormulaFreezeStore {
  transaction<T>(operation: (store: FormulaFreezeStore) => Promise<T>): Promise<T>;
  persistFrozenSnapshotBundle(input: {
    formulaVersionId: string;
    bundleHash: string;
    lines: readonly FormulaBundleHashLine[];
  }): Promise<void>;
  markFormulaVersionFrozen(formulaVersionId: string, bundleHash: string): Promise<void>;
}
