import { OsmoTaxonomyRegistry } from "@nox-os/material-intelligence";
import type { AccordTaxonomyTarget } from "./contracts.js";

const registry = new OsmoTaxonomyRegistry();

export function isCanonicalTaxonomyTarget(target: AccordTaxonomyTarget): boolean {
  try {
    registry.validate([
      {
        taxonomyVersion: "1.2",
        assignmentType: target.assignmentType,
        taxonomyTerm: target.taxonomyTerm,
        intensity: null
      }
    ]);
    return true;
  } catch {
    return false;
  }
}

export function taxonomyTargetKey(target: AccordTaxonomyTarget): string {
  return `${target.assignmentType}:${target.taxonomyTerm}`;
}
