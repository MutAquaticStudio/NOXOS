import type { MaterialIntelligenceSnapshot } from "@nox-os/material-intelligence";
import {
  REFERENCE_FORMULA_MASS_MG,
  positiveMassMgSchema,
  type MassMg,
  type ResolvedFormulaLine
} from "./contracts.js";

export class DesignStudioMassError extends Error {
  constructor(
    readonly code:
      "INVALID_MASS" | "FORMULA_TOTAL_INVALID" | "DILUTION_RESOLUTION_FAILED" | "DUPLICATE_MATERIAL"
  ) {
    super(code);
  }
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value)) throw new DesignStudioMassError("DILUTION_RESOLUTION_FAILED");
  const [coefficient, exponentText] = String(value).toLowerCase().split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = BigInt((whole || "0") + fraction);
  const scale = fraction.length - exponent;
  const numerator = (negative ? -digits : digits) * (scale < 0 ? powerOfTen(-scale) : 1n);
  return { numerator, denominator: scale > 0 ? powerOfTen(scale) : 1n };
}

export function resolveMaterialLineMass(
  snapshot: MaterialIntelligenceSnapshot,
  normalizedMassMg: MassMg
): ResolvedFormulaLine {
  const parsedMass = positiveMassMgSchema.safeParse(normalizedMassMg);
  if (!parsedMass.success) throw new DesignStudioMassError("INVALID_MASS");
  const lineMass = BigInt(normalizedMassMg);

  if (snapshot.material.materialType !== "DILUTION") {
    if (snapshot.concentrate) throw new DesignStudioMassError("DILUTION_RESOLUTION_FAILED");
    return {
      materialId: snapshot.material.id,
      normalizedMassMg,
      activeAromaticMassMg: normalizedMassMg,
      carrierSolventMassMg: "0",
      materialSnapshot: snapshot
    };
  }

  const concentrate = snapshot.concentrate;
  if (
    !concentrate ||
    snapshot.components.length > 0 ||
    concentrate.sourceMaterialId === snapshot.material.id ||
    concentrate.concentrationPct <= 0 ||
    concentrate.concentrationPct >= 100 ||
    (!concentrate.solventMaterialId && !concentrate.solventCustomName)
  ) {
    throw new DesignStudioMassError("DILUTION_RESOLUTION_FAILED");
  }

  const concentration = decimalFraction(concentrate.concentrationPct);
  const active = (lineMass * concentration.numerator) / (concentration.denominator * BigInt(100));
  const carrier = lineMass - active;
  return {
    materialId: snapshot.material.id,
    normalizedMassMg,
    activeAromaticMassMg: active.toString(),
    carrierSolventMassMg: carrier.toString(),
    solventType: concentrate.solventCustomName ?? concentrate.solventMaterialId ?? undefined,
    materialSnapshot: snapshot
  };
}

export function formatMassMg(value: MassMg): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new DesignStudioMassError("INVALID_MASS");
  let remaining = BigInt(value);
  const kilograms = remaining / 1_000_000n;
  remaining %= 1_000_000n;
  const grams = remaining / 1_000n;
  const milligrams = remaining % 1_000n;
  if (kilograms > 0n) {
    return `${kilograms} kg${grams > 0n ? ` ${grams} g` : ""}${
      milligrams > 0n ? ` ${milligrams} mg` : ""
    }`;
  }
  if (grams > 0n) return `${grams} g${milligrams > 0n ? ` ${milligrams} mg` : ""}`;
  return `${milligrams} mg`;
}

export type ScalableFormulaLine = { materialId: string; normalizedMassMg: MassMg };
export type ScaledFormulaLine = { materialId: string; scaledMassMg: MassMg };

export function scaleFormulaMasses(
  lines: readonly ScalableFormulaLine[],
  targetMassMg: MassMg
): ScaledFormulaLine[] {
  if (!positiveMassMgSchema.safeParse(targetMassMg).success) {
    throw new DesignStudioMassError("INVALID_MASS");
  }
  const target = BigInt(targetMassMg);
  const seen = new Set<string>();
  let referenceTotal = 0n;
  const allocations = lines.map((line, originalIndex) => {
    if (seen.has(line.materialId)) throw new DesignStudioMassError("DUPLICATE_MATERIAL");
    seen.add(line.materialId);
    if (!positiveMassMgSchema.safeParse(line.normalizedMassMg).success) {
      throw new DesignStudioMassError("INVALID_MASS");
    }
    const mass = BigInt(line.normalizedMassMg);
    referenceTotal += mass;
    const numerator = mass * target;
    return {
      materialId: line.materialId,
      originalIndex,
      floor: numerator / BigInt(REFERENCE_FORMULA_MASS_MG),
      remainder: numerator % BigInt(REFERENCE_FORMULA_MASS_MG)
    };
  });
  if (referenceTotal !== BigInt(REFERENCE_FORMULA_MASS_MG)) {
    throw new DesignStudioMassError("FORMULA_TOTAL_INVALID");
  }
  let residual = target - allocations.reduce((total, line) => total + line.floor, 0n);
  const byRemainder = [...allocations].sort((left, right) =>
    left.remainder === right.remainder
      ? left.materialId.localeCompare(right.materialId)
      : left.remainder > right.remainder
        ? -1
        : 1
  );
  for (const allocation of byRemainder) {
    if (residual === 0n) break;
    allocation.floor += 1n;
    residual -= 1n;
  }
  return allocations
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((line) => ({ materialId: line.materialId, scaledMassMg: line.floor.toString() }));
}

export type WeighableResolution = {
  code: "BELOW_WEIGHABLE_RESOLUTION";
  materialId: string;
  scaledMassMg: MassMg;
  resolutionMg: MassMg;
};

export function findBelowWeighableResolution(
  lines: readonly ScaledFormulaLine[],
  resolutionMg: MassMg = "1"
): WeighableResolution[] {
  const resolution = BigInt(positiveMassMgSchema.parse(resolutionMg));
  return lines
    .filter((line) => BigInt(line.scaledMassMg) < resolution)
    .map((line) => ({
      code: "BELOW_WEIGHABLE_RESOLUTION",
      materialId: line.materialId,
      scaledMassMg: line.scaledMassMg,
      resolutionMg
    }));
}
