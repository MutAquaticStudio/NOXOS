import { describe, expect, it } from "vitest";
import { UnavailableWorkflowLauncher } from "@nox-os/platform";
import { MockScientificAdapter, UnavailableScientificAdapter } from "@nox-os/scientific";

describe("provider-neutral resilience ports", () => {
  it("degrades science without failing the core foundation", async () => {
    await expect(new UnavailableScientificAdapter().evaluate(undefined)).resolves.toMatchObject({
      state: "UNAVAILABLE"
    });
    await expect(
      new MockScientificAdapter(() => "mock-result").evaluate(undefined)
    ).resolves.toMatchObject({ state: "AVAILABLE", value: "mock-result" });
  });

  it("does not pretend an unconfigured workflow provider has completed work", async () => {
    await expect(
      new UnavailableWorkflowLauncher().start(
        "foundation.probe",
        {},
        {
          workflowId: "workflow_1",
          scope: { type: "GLOBAL" },
          actor: { type: "SYSTEM" },
          correlationId: "corr_1",
          idempotencyKey: "idempotency_1"
        }
      )
    ).resolves.toEqual({ id: "workflow_1", state: "FAILED" });
  });
});
