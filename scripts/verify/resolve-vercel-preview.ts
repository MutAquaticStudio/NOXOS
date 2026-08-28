import { fileURLToPath } from "node:url";
import {
  normalizeVercelDeploymentUrl,
  verifyVercelDeployment,
  type VercelDeployment
} from "./vercel-deployment";

type DeploymentList = { deployments?: VercelDeployment[] };

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " must be supplied through the protected cloud environment.");
  }
  return value;
}

export function authenticatedPreviewUrl(deployment: VercelDeployment): string {
  if (!deployment.url) {
    throw new Error("Authenticated Vercel Preview deployment does not include a URL.");
  }
  return normalizeVercelDeploymentUrl(deployment.url);
}

export function readyPreviewDeployment(
  payload: DeploymentList,
  sourceSha: string,
  projectId: string
): VercelDeployment | undefined {
  return payload.deployments?.find(
    (candidate) =>
      candidate.meta?.githubCommitSha === sourceSha &&
      (candidate.projectId ?? candidate.project?.id) === projectId &&
      candidate.target === null &&
      Boolean(candidate.url) &&
      (candidate.readyState === "READY" || candidate.state === "READY")
  );
}

export async function resolveVercelPreview(
  raw: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
  sleep: (milliseconds: number) => Promise<void> = async (milliseconds) =>
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<string> {
  const sourceSha = required(raw, "EXPECTED_SOURCE_SHA");
  const projectId = required(raw, "VERCEL_PROJECT_ID");
  const token = required(raw, "VERCEL_TOKEN");
  const repository = required(raw, "EXPECTED_GIT_REPOSITORY");
  const gitRef = required(raw, "EXPECTED_GIT_REF");
  const [organization, repositoryName, ...unexpected] = repository.split("/");
  if (!organization || !repositoryName || unexpected.length > 0) {
    throw new Error("EXPECTED_GIT_REPOSITORY must be an owner/repository pair.");
  }
  const query = new URL("https://api.vercel.com/v6/deployments");
  query.searchParams.set("projectId", projectId);
  query.searchParams.set("meta-githubCommitSha", sourceSha);
  if (raw.VERCEL_ORG_ID) {
    query.searchParams.set("teamId", raw.VERCEL_ORG_ID);
  }

  for (let attempt = 1; attempt <= 18; attempt += 1) {
    const response = await request(query, {
      headers: { authorization: "Bearer " + token }
    });
    if (!response.ok) {
      throw new Error("Vercel Preview lookup failed without exposing provider details.");
    }
    const payload = (await response.json()) as DeploymentList;
    const deployment = readyPreviewDeployment(payload, sourceSha, projectId);
    if (deployment) {
      return await verifyVercelDeployment(
        {
          organizationId: raw.VERCEL_ORG_ID,
          projectId,
          sourceSha,
          target: "preview",
          token,
          gitSource: {
            organization,
            repository: repositoryName,
            ref: gitRef
          }
        },
        authenticatedPreviewUrl(deployment),
        request
      );
    }
    if (attempt < 18) {
      await sleep(10_000);
    }
  }

  throw new Error(
    "No ready authenticated Vercel Preview deployment exists for the expected source SHA."
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const previewUrl = await resolveVercelPreview();
  console.log("PREVIEW_DEPLOY_URL=" + previewUrl);
}
