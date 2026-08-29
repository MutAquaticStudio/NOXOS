import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMaterialSnapshot,
  isMaterialEligibleForDownstream,
  MaterialProblem,
  OsmoTaxonomyRegistry,
  resolveMaterialIdentity,
  toTenantSnapshot,
  validateMaterialAggregate,
  type MaterialAggregate,
  type MaterialRecord
} from "@nox-os/material-intelligence";
import { InMemoryMaterialStore } from "../helpers/in-memory-material-store";

const TAXONOMY = new OsmoTaxonomyRegistry();
const tenantA = "10000000-0000-4000-8000-000000000001";
const userA = "20000000-0000-4000-8000-000000000001";

function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    tenantId: tenantA,
    scope: "TENANT",
    visibility: "PRIVATE",
    displayName: "Vanillin",
    normalizedDisplayName: "vanillin",
    materialType: "SINGLE_MOLECULE",
    approvalStatus: "APPROVED",
    noteClassification: null,
    chemicalEntityId: null,
    contributorUserId: userA,
    approvedByUserId: userA,
    approvedByAuthority: "TENANT",
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    ...overrides
  };
}

function aggregate(overrides: Partial<MaterialAggregate> = {}): MaterialAggregate {
  return {
    material: material(),
    identifiers: [
      {
        materialId: material().id,
        identifierType: "CAS",
        value: "121-33-5",
        normalizedValue: "121-33-5"
      }
    ],
    properties: null,
    odorAssignments: [
      {
        materialId: material().id,
        taxonomyVersion: "1.2",
        assignmentType: "GRAND_FAMILY",
        taxonomyTerm: "Sweet/Balsamic",
        intensity: null
      }
    ],
    concentrate: null,
    components: [],
    chemicalEntity: null,
    ...overrides
  };
}

describe("Material Intelligence domain", () => {
  it("pins the official Osmo v1.2 source-controlled taxonomy and validates every assignment type", () => {
    const source = readFileSync("taxonomy/osmo/1.2.json", "utf8");
    expect(source).toContain("Sweet/Balsamic");
    expect(TAXONOMY.metadata("1.2")).toMatchObject({ grandFamilies: 11, subfamilies: 63 });
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Floral",
          intensity: null
        },
        {
          taxonomyVersion: "1.2",
          assignmentType: "SUBFAMILY",
          taxonomyTerm: "Mimosic",
          intensity: 1
        },
        {
          taxonomyVersion: "1.2",
          assignmentType: "DESCRIPTOR",
          taxonomyTerm: "Jasminy",
          intensity: 10
        },
        {
          taxonomyVersion: "1.2",
          assignmentType: "TEXTURE",
          taxonomyTerm: "Soft/Velvety",
          intensity: null
        },
        {
          taxonomyVersion: "1.2",
          assignmentType: "SENSATION",
          taxonomyTerm: "Warm/Rich",
          intensity: null
        }
      ])
    ).not.toThrow();
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "DESCRIPTOR",
          taxonomyTerm: "invented-term",
          intensity: null
        }
      ])
    ).toThrow(MaterialProblem);
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Woody",
          intensity: null
        },
        {
          taxonomyVersion: "1.2",
          assignmentType: "SUBFAMILY",
          taxonomyTerm: "Mimosic",
          intensity: null
        }
      ])
    ).toThrow(/Subfamily/);
  });

  it("keeps assigned taxonomy versions immutable and enforces intensity bounds", () => {
    const assigned = aggregate();
    validateMaterialAggregate(assigned, TAXONOMY);
    expect(assigned.odorAssignments[0].taxonomyVersion).toBe("1.2");
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Floral",
          intensity: 0
        }
      ])
    ).toThrow();
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Floral",
          intensity: 11
        }
      ])
    ).toThrow();
    expect(() =>
      TAXONOMY.validate([
        {
          taxonomyVersion: "1.2",
          assignmentType: "GRAND_FAMILY",
          taxonomyTerm: "Floral",
          intensity: null
        }
      ])
    ).not.toThrow();
  });

  it("enforces Material type, dilution, and composition boundaries", () => {
    expect(() =>
      validateMaterialAggregate(
        aggregate({
          material: material({
            materialType: "NATURAL",
            chemicalEntityId: "40000000-0000-4000-8000-000000000001"
          })
        }),
        TAXONOMY
      )
    ).toThrow(/SINGLE_MOLECULE/);
    expect(() =>
      validateMaterialAggregate(
        aggregate({ material: material({ materialType: "DILUTION" }) }),
        TAXONOMY
      )
    ).toThrow(/requires a concentrate/);
    const dilution = aggregate({
      material: material({ materialType: "DILUTION" }),
      concentrate: {
        materialId: material().id,
        sourceMaterialId: "30000000-0000-4000-8000-000000000002",
        concentrationPct: 10,
        solventMaterialId: null,
        solventCustomName: "TEC"
      }
    });
    expect(() => validateMaterialAggregate(dilution, TAXONOMY)).not.toThrow();
    expect(() =>
      validateMaterialAggregate(
        {
          ...dilution,
          components: [
            {
              materialId: dilution.material.id,
              componentMaterialId: "30000000-0000-4000-8000-000000000003",
              percentage: 10,
              role: "COMPONENT"
            }
          ]
        },
        TAXONOMY
      )
    ).toThrow(/cannot use composition/);
    const mixture = aggregate({
      material: material({ materialType: "MIXTURE" }),
      components: [
        {
          materialId: material().id,
          componentMaterialId: "30000000-0000-4000-8000-000000000003",
          percentage: 60,
          role: "COMPONENT"
        },
        {
          materialId: material().id,
          componentMaterialId: "30000000-0000-4000-8000-000000000004",
          percentage: 40,
          role: "TRACE"
        }
      ]
    });
    expect(() => validateMaterialAggregate(mixture, TAXONOMY)).not.toThrow();
    expect(() =>
      validateMaterialAggregate(
        {
          ...mixture,
          components: [
            ...mixture.components,
            {
              materialId: mixture.material.id,
              componentMaterialId: "30000000-0000-4000-8000-000000000005",
              percentage: 1,
              role: "COMPONENT"
            }
          ]
        },
        TAXONOMY
      )
    ).toThrow(/exceed 100/);
    expect(() =>
      validateMaterialAggregate(
        {
          ...mixture,
          components: [
            {
              materialId: mixture.material.id,
              componentMaterialId: mixture.material.id,
              percentage: null,
              role: "COMPONENT"
            }
          ]
        },
        TAXONOMY
      )
    ).toThrow(/self/);
  });

  it("derives downstream eligibility from access and APPROVED state without storing another lifecycle flag", () => {
    expect(
      isMaterialEligibleForDownstream({ tenantId: tenantA, platformAuthority: false }, material())
    ).toBe(true);
    expect(
      isMaterialEligibleForDownstream(
        { tenantId: tenantA, platformAuthority: false },
        material({
          approvalStatus: "PENDING_REVIEW",
          approvedByUserId: null,
          approvedByAuthority: null
        })
      )
    ).toBe(false);
  });

  it("resolves identities by CAS, FEMA, INCI, then normalized display name without auto-merging", async () => {
    const store = new InMemoryMaterialStore();
    const records = [
      material({
        id: "30000000-0000-4000-8000-000000000010",
        displayName: "CAS winner",
        normalizedDisplayName: "cas winner"
      }),
      material({
        id: "30000000-0000-4000-8000-000000000011",
        displayName: "FEMA winner",
        normalizedDisplayName: "fema winner"
      })
    ];
    for (const record of records) await store.seedMaterial(record);
    await store.replaceIdentifiers(records[0].id, [
      {
        materialId: records[0].id,
        identifierType: "CAS",
        value: "121-33-5",
        normalizedValue: "121-33-5"
      },
      { materialId: records[0].id, identifierType: "FEMA", value: "0002", normalizedValue: "0002" }
    ]);
    await store.replaceIdentifiers(records[1].id, [
      { materialId: records[1].id, identifierType: "FEMA", value: "0001", normalizedValue: "0001" }
    ]);
    await expect(
      resolveMaterialIdentity(store, {
        displayName: "FEMA winner",
        identifiers: [
          { identifierType: "CAS", value: "121-33-5" },
          { identifierType: "FEMA", value: "0001" }
        ]
      })
    ).resolves.toMatchObject({ kind: "EXACT_MATCH", materialId: records[0].id, matchedBy: "CAS" });
    await store.seedMaterial(
      material({
        id: "30000000-0000-4000-8000-000000000012",
        displayName: "CAS duplicate",
        normalizedDisplayName: "cas duplicate"
      })
    );
    await store.replaceIdentifiers("30000000-0000-4000-8000-000000000012", [
      {
        materialId: "30000000-0000-4000-8000-000000000012",
        identifierType: "CAS",
        value: "121-33-5",
        normalizedValue: "121-33-5"
      }
    ]);
    await expect(
      resolveMaterialIdentity(store, {
        displayName: "New",
        identifiers: [{ identifierType: "CAS", value: "121-33-5" }]
      })
    ).resolves.toMatchObject({ kind: "POSSIBLE_MATCH" });
    expect((await store.findMaterialById(records[0].id))?.id).toBe(records[0].id);
  });

  it("builds deterministic, stable-ID snapshots and excludes ChemicalEntity from tenant serialization", () => {
    const materialWithChemical = material({
      chemicalEntityId: "40000000-0000-4000-8000-000000000001"
    });
    const complete = aggregate({
      material: materialWithChemical,
      chemicalEntity: {
        id: materialWithChemical.chemicalEntityId!,
        canonicalName: "Vanillin",
        canonicalSmiles: "COc1ccc",
        isomericSmiles: null,
        inchikey: "MUQZ",
        molecularFormula: "C8H8O3",
        molecularWeight: 152.15,
        structureStatus: "VERIFIED",
        structureSourceReference: "curated",
        createdAt: materialWithChemical.createdAt,
        updatedAt: materialWithChemical.updatedAt
      }
    });
    const first = buildMaterialSnapshot(complete, true);
    const second = buildMaterialSnapshot(complete, true);
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.material.id).toBe(materialWithChemical.id);
    expect(first.scientificInternal?.chemicalEntity.inchikey).toBe("MUQZ");
    expect(JSON.stringify(toTenantSnapshot(first))).not.toMatch(
      /chemical|smiles|inchikey|molecular/i
    );
    const changed = buildMaterialSnapshot(
      { ...complete, material: { ...complete.material, displayName: "Corrected Vanillin" } },
      true
    );
    expect(changed.snapshotHash).not.toBe(first.snapshotHash);
  });
});
