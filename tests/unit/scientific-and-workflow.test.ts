import { describe, expect, it } from "vitest";
import {
  HttpWorkflowLauncher,
  probeWorkflowRoundTrip,
  UnavailableWorkflowLauncher
} from "@nox-os/platform";
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

  it("requires a real completed provider response for the workflow probe", async () => {
    const launcher = new HttpWorkflowLauncher({
      endpoint: "https://workflow.example.invalid/probe",
      request: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          context: { workflowId: string; correlationId: string };
        };
        return new Response(
          JSON.stringify({
            id: payload.context.workflowId,
            state: "COMPLETED",
            correlationId: payload.context.correlationId
          }),
          { status: 200 }
        );
      }
    });

    await expect(probeWorkflowRoundTrip(launcher)).resolves.toMatchObject({
      state: "COMPLETED"
    });
    await expect(probeWorkflowRoundTrip(new UnavailableWorkflowLauncher())).rejects.toThrow(
      /did not complete successfully/
    );
  });

  it("retries transient provider failures with the same workflow idempotency key", async () => {
    let calls = 0;
    const retryingLauncher = new HttpWorkflowLauncher({
      endpoint: "https://workflow.example.invalid/probe",
      maxAttempts: 2,
      sleep: async () => undefined,
      request: async (_input, init) => {
        calls += 1;
        if (calls === 1) {
          return new Response("temporarily unavailable", { status: 503 });
        }
        const payload = JSON.parse(String(init?.body)) as {
          context: { workflowId: string; correlationId: string; idempotencyKey: string };
        };
        expect(init?.headers).toMatchObject({ "idempotency-key": payload.context.idempotencyKey });
        return new Response(
          JSON.stringify({
            id: payload.context.workflowId,
            state: "COMPLETED",
            correlationId: payload.context.correlationId
          }),
          { status: 200 }
        );
      }
    });

    await expect(probeWorkflowRoundTrip(retryingLauncher)).resolves.toMatchObject({
      state: "COMPLETED"
    });
    expect(calls).toBe(2);
  });
});
