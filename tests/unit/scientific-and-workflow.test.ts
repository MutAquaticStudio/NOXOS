import { describe, expect, it } from "vitest";
import {
  HttpWorkflowLauncher,
  launchWorkflowProbe,
  UnavailableWorkflowLauncher
} from "@nox-os/platform";
import {
  MockScientificAdapter,
  NoxOeScientificAdapter,
  UnavailableScientificAdapter
} from "@nox-os/scientific";
import {
  processFoundationWorkflowMessage,
  VercelQueueWorkflowLauncher
} from "../../apps/nox-os/workflows/vercel-queue";

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

  it("keeps an unavailable NØX-OE sidecar off the core critical path", async () => {
    const adapter = new NoxOeScientificAdapter({
      endpoint: "https://nox-oe.internal.invalid",
      internalToken: "test-only",
      request: async () =>
        new Response(JSON.stringify({ state: "UNAVAILABLE", code: "MODEL_UNAVAILABLE" }))
    });
    await expect(adapter.evaluate({ canonical_smiles: "CCO" })).resolves.toEqual({
      state: "UNAVAILABLE",
      reason: "MODEL_UNAVAILABLE"
    });
  });

  it("accepts a durable provider enqueue without pretending asynchronous work is complete", async () => {
    const launcher = new HttpWorkflowLauncher({
      endpoint: "https://workflow.example.invalid/probe",
      request: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          context: { workflowId: string; correlationId: string };
        };
        return new Response(
          JSON.stringify({
            id: payload.context.workflowId,
            state: "QUEUED",
            correlationId: payload.context.correlationId
          }),
          { status: 200 }
        );
      }
    });

    await expect(launchWorkflowProbe(launcher)).resolves.toMatchObject({
      state: "QUEUED"
    });
    await expect(launchWorkflowProbe(new UnavailableWorkflowLauncher())).rejects.toThrow(
      /rejected by the durable execution provider/
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

    await expect(launchWorkflowProbe(retryingLauncher)).resolves.toMatchObject({
      state: "COMPLETED"
    });
    expect(calls).toBe(2);
  });

  it("pins Vercel Queue publication to the internal port and preserves idempotency", async () => {
    const publications: Array<{
      topic: string;
      payload: unknown;
      idempotencyKey?: string;
    }> = [];
    const launcher = new VercelQueueWorkflowLauncher({
      send: async (topic, payload, options) => {
        publications.push({ topic, payload, idempotencyKey: options?.idempotencyKey });
        return { messageId: "message-1" };
      }
    });
    const identity = {
      correlationId: "correlation_123",
      workflowId: "workflow_123",
      idempotencyKey: "idempotency_123"
    };

    await launchWorkflowProbe(launcher, identity);
    await launchWorkflowProbe(launcher, identity);

    expect(publications).toHaveLength(2);
    expect(publications.map((item) => item.topic)).toEqual([
      "nox-foundation-workflow",
      "nox-foundation-workflow"
    ]);
    expect(publications.map((item) => item.idempotencyKey)).toEqual([
      "idempotency_123",
      "idempotency_123"
    ]);
    expect(publications[0]?.payload).toMatchObject({
      workflowType: "nox.foundation.diagnostic",
      context: identity
    });
  });

  it("re-authorizes current state and records one correlated durable completion", async () => {
    const message = {
      workflowType: "nox.foundation.diagnostic",
      input: { purpose: "cloud-foundation-acceptance" },
      context: {
        workflowId: "workflow_123",
        scope: { type: "GLOBAL" as const },
        actor: { type: "SYSTEM" as const },
        correlationId: "correlation_123",
        idempotencyKey: "idempotency_123"
      }
    };
    const completions: unknown[] = [];
    const options = {
      currentEnvironment: "staging",
      diagnosticsEnabled: "true",
      async recordCompletion(completion: unknown) {
        completions.push(completion);
      }
    };

    await processFoundationWorkflowMessage(message, { deliveryCount: 1 }, options);

    expect(completions).toEqual([
      {
        workflowId: "workflow_123",
        correlationId: "correlation_123",
        idempotencyKey: "idempotency_123",
        deliveryCount: 1
      }
    ]);
    await expect(
      processFoundationWorkflowMessage(
        message,
        { deliveryCount: 1 },
        {
          ...options,
          diagnosticsEnabled: "false"
        }
      )
    ).rejects.toThrow(/revalidated/);
  });
});
