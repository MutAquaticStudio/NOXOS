import { QueueClient } from "@vercel/queue";
import { requiredServerValue } from "@nox-os/config";
import {
  createRuntimeDatabase,
  probeDatabase,
  recordWorkflowProbeCompletion
} from "@nox-os/database";
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
    const databaseProbe = await probeDatabase(workflowDatabase, "nox_workflow_runtime");
    if (!databaseProbe.healthy || databaseProbe.role !== "nox_workflow_runtime") {
      throw new Error("Workflow runtime database role probe failed.");
    }
    await processFoundationWorkflowMessage(message, metadata, {
      currentEnvironment: process.env.NOX_ENV,
      diagnosticsEnabled: process.env.NOX_FOUNDATION_DIAGNOSTICS_ENABLED,
      recordCompletion: (completion) => recordWorkflowProbeCompletion(workflowDatabase, completion)
    });
    console.log("STAGING_WORKFLOW_DATABASE_CURRENT_USER=nox_workflow_runtime");
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
