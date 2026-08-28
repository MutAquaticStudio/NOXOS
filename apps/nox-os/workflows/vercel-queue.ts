import { QueueClient, type MessageMetadata, type SendOptions } from "@vercel/queue";
import type { WorkflowContext, WorkflowHandle, WorkflowLauncher } from "@nox-os/contracts";
import { requireCurrentWorkflowAuthority } from "@nox-os/platform";

export const FOUNDATION_WORKFLOW_TOPIC = "nox-foundation-workflow";
export const FOUNDATION_WORKFLOW_REGION = "syd1";

type QueueSend = <T>(
  topicName: string,
  payload: T,
  options?: SendOptions
) => Promise<{ messageId: string | null }>;

export type FoundationWorkflowMessage<T = unknown> = {
  workflowType: string;
  input: T;
  context: WorkflowContext;
};

export type VercelQueueWorkflowLauncherOptions = {
  send?: QueueSend;
  topic?: string;
  region?: string;
};

export class VercelQueueWorkflowLauncher implements WorkflowLauncher {
  private readonly send: QueueSend;
  private readonly topic: string;

  constructor(options: VercelQueueWorkflowLauncherOptions = {}) {
    this.topic = options.topic ?? FOUNDATION_WORKFLOW_TOPIC;
    this.send =
      options.send ??
      new QueueClient({ region: options.region ?? FOUNDATION_WORKFLOW_REGION }).send;
  }

  async start<T>(
    workflowType: string,
    input: T,
    context: WorkflowContext
  ): Promise<WorkflowHandle> {
    await this.send<FoundationWorkflowMessage<T>>(
      this.topic,
      { workflowType, input, context },
      {
        idempotencyKey: context.idempotencyKey,
        retentionSeconds: 3_600,
        headers: { "x-nox-correlation-id": context.correlationId },
        telemetry: {
          metadata: {
            workflowType,
            scope: context.scope.type
          }
        }
      }
    );

    return {
      id: context.workflowId,
      state: "QUEUED",
      correlationId: context.correlationId
    };
  }
}

export class PermanentFoundationWorkflowError extends Error {}
export class TransientFoundationWorkflowError extends Error {}

type FoundationDiagnosticInput = {
  purpose: "cloud-foundation-acceptance";
  simulateRetry: true;
};

export type FoundationWorkflowProcessorOptions = {
  currentEnvironment: string | undefined;
  diagnosticsEnabled: string | undefined;
  recordCompletion: (completion: {
    workflowId: string;
    correlationId: string;
    idempotencyKey: string;
    deliveryCount: number;
  }) => Promise<void>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

function parseFoundationDiagnosticMessage(
  value: unknown
): FoundationWorkflowMessage<FoundationDiagnosticInput> {
  if (!isObject(value) || value.workflowType !== "nox.foundation.diagnostic") {
    throw new PermanentFoundationWorkflowError("Unsupported foundation workflow message.");
  }
  const input = value.input;
  const context = value.context;
  if (
    !isObject(input) ||
    input.purpose !== "cloud-foundation-acceptance" ||
    input.simulateRetry !== true ||
    !isObject(context) ||
    !isIdentifier(context.workflowId) ||
    !isIdentifier(context.correlationId) ||
    !isIdentifier(context.idempotencyKey) ||
    !isObject(context.scope) ||
    context.scope.type !== "GLOBAL" ||
    !isObject(context.actor) ||
    context.actor.type !== "SYSTEM"
  ) {
    throw new PermanentFoundationWorkflowError("Invalid foundation workflow message.");
  }

  return value as FoundationWorkflowMessage<FoundationDiagnosticInput>;
}

export async function processFoundationWorkflowMessage(
  rawMessage: unknown,
  metadata: Pick<MessageMetadata, "deliveryCount">,
  options: FoundationWorkflowProcessorOptions
): Promise<void> {
  const message = parseFoundationDiagnosticMessage(rawMessage);

  // Queue-time context is never permanent authority. Re-read current deployment
  // configuration and re-authorize the narrow GLOBAL/SYSTEM diagnostic here.
  await requireCurrentWorkflowAuthority(message.context, {
    async revalidate(context) {
      return (
        options.currentEnvironment === "staging" &&
        options.diagnosticsEnabled === "true" &&
        context.scope.type === "GLOBAL" &&
        context.actor.type === "SYSTEM"
      );
    }
  });

  if (metadata.deliveryCount === 1 && message.input.simulateRetry) {
    throw new TransientFoundationWorkflowError(
      "Foundation diagnostic intentionally requested one durable retry."
    );
  }

  await options.recordCompletion({
    workflowId: message.context.workflowId,
    correlationId: message.context.correlationId,
    idempotencyKey: message.context.idempotencyKey,
    deliveryCount: metadata.deliveryCount
  });
}
