import { QueueClient } from "@vercel/queue";
import { requiredServerValue } from "@nox-os/config";
import { createRuntimeDatabase, recordWorkflowProbeCompletion } from "@nox-os/database";
import {
  FOUNDATION_WORKFLOW_REGION,
  PermanentFoundationWorkflowError,
  processFoundationWorkflowMessage
} from "../../workflows/vercel-queue.js";

const workflowDatabase = createRuntimeDatabase({
  connectionUrl: requiredServerValue(process.env, "NOX_WORKFLOW_DATABASE_URL"),
  applicationName: "nox-os-workflow",
  expectedRole: "nox_workflow_runtime"
});
const queue = new QueueClient({ region: FOUNDATION_WORKFLOW_REGION });

export default queue.handleNodeCallback(
  async (message, metadata) => {
    await processFoundationWorkflowMessage(message, metadata, {
      currentEnvironment: process.env.NOX_ENV,
      diagnosticsEnabled: process.env.NOX_FOUNDATION_DIAGNOSTICS_ENABLED,
      recordCompletion: (completion) => recordWorkflowProbeCompletion(workflowDatabase, completion)
    });
  },
  {
    visibilityTimeoutSeconds: 60,
    retry(error, metadata) {
      if (error instanceof PermanentFoundationWorkflowError) {
        return { acknowledge: true };
      }
      return { afterSeconds: Math.min(30, 2 ** metadata.deliveryCount) };
    }
  }
);
