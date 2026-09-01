import { describe, expect, it, vi } from "vitest";
import {
  TrialSensoryApplication,
  TrialSensoryProblem,
  type TrialInventoryPort
} from "@nox-os/trial-sensory";
import { InMemoryTrialSensoryStore } from "../helpers/in-memory-trial-sensory-store";
import { G5_IDS, g5FrozenFormula } from "../helpers/g5-formula-fixture";

const command = {
  tenantId: G5_IDS.tenantA,
  actorUserId: G5_IDS.actorA,
  requestId: "req_g7_trial",
  correlationId: "corr_g7_trial"
};

function fixture() {
  const formula = g5FrozenFormula();
  const store = new InMemoryTrialSensoryStore();
  const reserve = vi.fn<TrialInventoryPort["reserve"]>(async (input) => ({
    trialId: input.trialId,
    reservations: input.allocations.map((item) => ({
      reservationId: crypto.randomUUID(),
      materialId: item.materialId,
      lotId: item.lotId,
      locationId: item.locationId,
      quantityMg: item.quantityMg,
      status: "ACTIVE"
    }))
  }));
  const inventory: TrialInventoryPort = {
    async listAvailability(input) {
      return {
        trialId: input.trialId,
        requirements: input.requirements,
        allocations: [],
        activeReservations: []
      };
    },
    reserve,
    async releaseDraftTrialReservations() {}
  };
  const application = new TrialSensoryApplication(
    store,
    {
      async findFrozenFormulaVersion(tenantId, formulaVersionId) {
        return tenantId === formula.tenantId && formulaVersionId === formula.formulaVersionId
          ? structuredClone(formula)
          : undefined;
      }
    },
    inventory
  );
  return { application, reserve };
}

describe("Gate 7 Trial inventory seam", () => {
  it("derives the exact plan without consuming or reserving on Trial creation", async () => {
    const target = fixture();
    const trial = await target.application.createTrial(command, {
      formulaVersionId: G5_IDS.version,
      preparationMode: "CONCENTRATE",
      applicationKey: "fine-fragrance",
      dosagePct: 20,
      carrierOrBaseReference: null,
      targetMassMg: "10000"
    });
    const plan = await target.application.preparationPlan(command.tenantId, trial.id);
    expect(plan.requirements.reduce((sum, item) => sum + BigInt(item.requiredMassMg), 0n)).toBe(
      10000n
    );
    expect(target.reserve).not.toHaveBeenCalled();
    expect(trial.status).toBe("DRAFT");
  });

  it("accepts split-lot allocations only when every Material aggregate is exact", async () => {
    const target = fixture();
    const trial = await target.application.createTrial(command, {
      formulaVersionId: G5_IDS.version,
      preparationMode: "CONCENTRATE",
      applicationKey: "fine-fragrance",
      dosagePct: 20,
      carrierOrBaseReference: null,
      targetMassMg: "10000"
    });
    const plan = await target.application.preparationPlan(command.tenantId, trial.id);
    const first = plan.requirements[0];
    await expect(
      target.application.reserveInventory(command, trial.id, {
        operationKey: "bad-allocation",
        allocations: [
          {
            materialId: first.materialId,
            lotId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            quantityMg: first.requiredMassMg
          }
        ]
      })
    ).rejects.toMatchObject({
      code: "TRIAL_INVENTORY_ALLOCATION_MISMATCH"
    } satisfies Partial<TrialSensoryProblem>);

    const allocations = plan.requirements.flatMap((item, index) => {
      if (index !== 0 || BigInt(item.requiredMassMg) < 2n)
        return [
          {
            materialId: item.materialId,
            lotId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            quantityMg: item.requiredMassMg
          }
        ];
      const firstPart = (BigInt(item.requiredMassMg) - 1n).toString();
      return [
        {
          materialId: item.materialId,
          lotId: crypto.randomUUID(),
          locationId: crypto.randomUUID(),
          quantityMg: firstPart
        },
        {
          materialId: item.materialId,
          lotId: crypto.randomUUID(),
          locationId: crypto.randomUUID(),
          quantityMg: "1"
        }
      ];
    });
    await target.application.reserveInventory(command, trial.id, {
      operationKey: "exact-split",
      allocations
    });
    expect(target.reserve).toHaveBeenCalledOnce();
  });
});
