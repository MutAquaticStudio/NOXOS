import {
  RELEASE_READINESS_POLICY_KEY,
  RELEASE_READINESS_POLICY_VERSION,
  type RegulatoryMaterialEvidence,
  type ReleaseAssessmentInput,
  type ReleaseCheckResult,
  type ReleaseReadinessPolicy
} from "./contracts.js";
import { compareActiveExposureToLimit, exactDecimal, exactDecimalText } from "./exact-decimal.js";

function formulaCheck(
  checkKey: string,
  result: ReleaseCheckResult["result"],
  message: string,
  evidence: Record<string, unknown> = {}
): ReleaseCheckResult {
  return { checkKey, subjectType: "FORMULA", materialId: null, result, evidence, message };
}

function materialCheck(
  materialId: string,
  checkKey: string,
  result: ReleaseCheckResult["result"],
  message: string,
  evidence: Record<string, unknown> = {}
): ReleaseCheckResult {
  return { checkKey, subjectType: "MATERIAL", materialId, result, evidence, message };
}

function canonicalCat4Values(material: RegulatoryMaterialEvidence): Array<{
  source: string;
  value: string;
}> {
  const values: Array<{ source: string; value: string }> = [];
  if (material.ifraCat4MaxPct != null) {
    values.push({ source: "ifraCat4MaxPct", value: String(material.ifraCat4MaxPct) });
  }
  for (const [key, raw] of Object.entries(material.ifraLimits)) {
    const canonical = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!["cat4", "category4", "ifracat4maxpct"].includes(canonical)) continue;
    if (typeof raw === "number" || (typeof raw === "string" && raw.trim())) {
      try {
        exactDecimal(raw);
        values.push({ source: `ifraLimits.${key}`, value: String(raw) });
      } catch {
        // Invalid configured evidence is handled as conflicting/unsupported evidence below.
        values.push({ source: `ifraLimits.${key}`, value: "INVALID" });
      }
    }
  }
  return values;
}

function uniqueExactValues(values: readonly { value: string }[]): Set<string> {
  const canonical = new Set<string>();
  for (const item of values) {
    try {
      const parsed = exactDecimal(item.value);
      canonical.add(`${parsed.numerator}/${parsed.denominator}`);
    } catch {
      canonical.add("INVALID");
    }
  }
  return canonical;
}

export class KnownLimitV1Policy implements ReleaseReadinessPolicy {
  readonly key = RELEASE_READINESS_POLICY_KEY;
  readonly version = RELEASE_READINESS_POLICY_VERSION;

  evaluate(input: ReleaseAssessmentInput): ReleaseCheckResult[] {
    const { evidence, profile } = input;
    const checks: ReleaseCheckResult[] = [
      formulaCheck(
        "FORMULA_ELIGIBILITY",
        evidence.formulaStatus === "FROZEN" &&
          evidence.approvalState === "APPROVED" &&
          evidence.compositionKind === "FULL_FORMULA" &&
          /^[a-f0-9]{64}$/.test(evidence.formulaBundleHash) &&
          evidence.formulaLineCount > 0 &&
          evidence.materials.length === evidence.formulaLineCount &&
          new Set(evidence.materials.map((material) => material.materialId)).size ===
            evidence.formulaLineCount
          ? "PASS"
          : "BLOCK",
        "Formula eligibility and immutable bundle lineage were evaluated.",
        {
          formulaVersionId: evidence.formulaVersionId,
          formulaBundleHash: evidence.formulaBundleHash,
          compositionKind: evidence.compositionKind,
          formulaStatus: evidence.formulaStatus,
          approvalState: evidence.approvalState,
          lineCount: evidence.formulaLineCount,
          evidenceMaterialCount: evidence.materials.length
        }
      ),
      formulaCheck(
        "SENSORY_APPROVAL_TRACEABILITY",
        evidence.approvalTrace.verified ? "PASS" : "REVIEW",
        evidence.approvalTrace.verified
          ? "G5 FINAL READY_FOR_APPROVAL evidence is traceable."
          : "Approved Formula lacks verifiable G5 approval traceability.",
        { ...evidence.approvalTrace }
      ),
      formulaCheck(
        "APPLICATION_POLICY_MAPPING",
        profile.applicationKey === "fine-fragrance" ? "PASS" : "REVIEW",
        profile.applicationKey === "fine-fragrance"
          ? "Application maps explicitly to IFRA Category 4 known-limit screening."
          : "Application has no approved V1 policy mapping.",
        {
          applicationKey: profile.applicationKey,
          mappedCategory: profile.applicationKey === "fine-fragrance" ? "CAT4" : null
        }
      )
    ];

    for (const material of evidence.materials) {
      if (!material.tenantAccessible || material.approvalStatus !== "APPROVED") {
        checks.push(
          materialCheck(
            material.materialId,
            "CURRENT_MATERIAL_APPROVAL",
            "BLOCK",
            "Material is no longer approved and tenant-accessible.",
            {
              approvalStatus: material.approvalStatus,
              tenantAccessible: material.tenantAccessible,
              currentSourceMaterialUpdatedAt: material.currentSourceMaterialUpdatedAt
            }
          )
        );
        continue;
      }

      checks.push(
        materialCheck(
          material.materialId,
          "CURRENT_MATERIAL_APPROVAL",
          "PASS",
          "Current Material remains approved and tenant-accessible.",
          {
            approvalStatus: material.approvalStatus,
            currentSourceMaterialUpdatedAt: material.currentSourceMaterialUpdatedAt
          }
        )
      );

      if (profile.applicationKey !== "fine-fragrance") continue;
      const candidates = canonicalCat4Values(material);
      const source = material.ifraSourceReference ?? material.sourceReference;
      checks.push(
        materialCheck(
          material.materialId,
          "REGULATORY_EVIDENCE_COMPLETENESS",
          source && material.ifraAmendment ? "PASS" : "REVIEW",
          source && material.ifraAmendment
            ? "Category 4 restriction status includes source and amendment provenance."
            : "Category 4 restriction status is missing required source or amendment provenance.",
          {
            sourceReference: source,
            ifraAmendment: material.ifraAmendment,
            frozenSourceMaterialUpdatedAt: material.frozenSourceMaterialUpdatedAt,
            currentSourceMaterialUpdatedAt: material.currentSourceMaterialUpdatedAt
          }
        )
      );
      if (material.euAllergens.length > 0) {
        checks.push(
          materialCheck(
            material.materialId,
            "ALLERGEN_POLICY_COVERAGE",
            "REVIEW",
            "Allergen evidence is present but V1 defines no jurisdiction-specific threshold policy.",
            { euAllergens: material.euAllergens }
          )
        );
      }
      const unique = uniqueExactValues(candidates);
      if (unique.size > 1 || unique.has("INVALID")) {
        checks.push(
          materialCheck(
            material.materialId,
            "KNOWN_LIMIT",
            "REVIEW",
            "Conflicting or invalid Category 4 limit evidence requires review.",
            { candidates }
          )
        );
        continue;
      }
      if (candidates.length === 0) {
        checks.push(
          materialCheck(
            material.materialId,
            "KNOWN_LIMIT",
            material.ifraRestricted ? "REVIEW" : "PASS",
            material.ifraRestricted
              ? "Restricted Material has no supported numeric Category 4 limit."
              : "No Category 4 restriction is recorded for this Material.",
            { ifraRestricted: material.ifraRestricted }
          )
        );
        continue;
      }

      const limit = candidates[0].value;
      const comparison = compareActiveExposureToLimit({
        activeAromaticMassMg: material.activeAromaticMassMg,
        referenceFormulaMassMg: evidence.referenceFormulaMassMg,
        dosagePct: profile.dosagePct,
        limitPct: limit
      });
      checks.push(
        materialCheck(
          material.materialId,
          "KNOWN_LIMIT",
          comparison.comparison > 0 ? "BLOCK" : "PASS",
          comparison.comparison > 0
            ? "Finished active aromatic exposure exceeds the Category 4 limit."
            : "Finished active aromatic exposure is at or below the Category 4 limit.",
          {
            activeAromaticMassMg: material.activeAromaticMassMg,
            carrierSolventMassMg: material.carrierSolventMassMg,
            referenceFormulaMassMg: evidence.referenceFormulaMassMg,
            dosagePct: profile.dosagePct,
            finishedActivePct: exactDecimalText(comparison.exposure),
            limitPct: limit,
            limitSources: candidates.map((candidate) => candidate.source)
          }
        )
      );
    }
    return checks;
  }
}
