export type VercelDeployment = {
  id?: string;
  meta?: {
    githubCommitSha?: string;
    githubCommitOrg?: string;
    githubCommitRepo?: string;
    githubCommitRef?: string;
  };
  projectId?: string;
  project?: { id?: string };
  readyState?: string;
  state?: string;
  target?: string | null;
  customEnvironmentId?: string | null;
  url?: string;
  gitSource?: {
    type?: string;
    org?: string;
    repo?: string;
    ref?: string | null;
    sha?: string;
  };
};

export type ExpectedGitSource = {
  organization: string;
  repository: string;
  ref: string;
};

export type ExpectedVercelDeployment = {
  organizationId?: string;
  projectId: string;
  sourceSha: string;
  target: "preview" | "staging" | "production";
  token: string;
  customEnvironmentId?: string;
  gitSource?: ExpectedGitSource;
};

export function normalizeVercelDeploymentUrl(value: string): string {
  const url = new URL(value.startsWith("https://") ? value : "https://" + value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".vercel.app") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Deployment verification accepts only a generated Vercel HTTPS deployment URL."
    );
  }
  return url.toString().replace(/\/$/, "");
}

function isReady(deployment: VercelDeployment): boolean {
  return deployment.readyState === "READY" || deployment.state === "READY";
}

function targetMatches(deployment: VercelDeployment, expected: ExpectedVercelDeployment): boolean {
  // Vercel represents its generated Preview environment with an explicit null target;
  // do not accept an arbitrary custom environment as Preview.
  if (expected.target === "preview") {
    return deployment.target === null && !deployment.customEnvironmentId;
  }
  if (expected.target === "staging") {
    if (expected.customEnvironmentId) {
      return deployment.customEnvironmentId === expected.customEnvironmentId;
    }
    // The current deployment lookup omits customEnvironmentId and uses a null target for a
    // custom-environment deployment. Callers must pair this shape with Vercel's
    // --environment=staging listing before accepting it as Staging evidence.
    return (
      deployment.target === "staging" ||
      (deployment.target === null && !deployment.customEnvironmentId)
    );
  }
  return deployment.target === expected.target;
}

function deploymentProjectId(deployment: VercelDeployment): string | undefined {
  return deployment.projectId ?? deployment.project?.id;
}

function gitSourceMatches(
  deployment: VercelDeployment,
  expected: ExpectedGitSource | undefined,
  sourceSha: string
): boolean {
  if (!expected) {
    return true;
  }

  const actual = deployment.gitSource;
  const gitSourceMatches =
    actual?.type === "github" &&
    actual.org === expected.organization &&
    actual.repo === expected.repository &&
    actual.ref === expected.ref &&
    actual.sha === sourceSha;
  const metadataMatches =
    deployment.meta?.githubCommitOrg === expected.organization &&
    deployment.meta?.githubCommitRepo === expected.repository &&
    deployment.meta?.githubCommitRef === expected.ref &&
    deployment.meta?.githubCommitSha === sourceSha;

  // Vercel may include a partial gitSource object alongside complete GitHub
  // metadata. A partial source object is not an authority that can erase an
  // independently complete, exact provider provenance record.
  return gitSourceMatches || metadataMatches;
}

export function assertExpectedVercelDeployment(
  deployment: VercelDeployment,
  expected: ExpectedVercelDeployment,
  deploymentUrl: string
): string {
  const normalizedUrl = normalizeVercelDeploymentUrl(deploymentUrl);
  if (
    !isReady(deployment) ||
    !targetMatches(deployment, expected) ||
    deploymentProjectId(deployment) !== expected.projectId ||
    deployment.meta?.githubCommitSha !== expected.sourceSha ||
    !gitSourceMatches(deployment, expected.gitSource, expected.sourceSha) ||
    !deployment.url ||
    normalizeVercelDeploymentUrl(deployment.url) !== normalizedUrl
  ) {
    throw new Error(
      "Authenticated Vercel deployment does not match the expected project, target, or source SHA."
    );
  }
  return normalizedUrl;
}

export async function verifyVercelDeployment(
  expected: ExpectedVercelDeployment,
  deploymentUrl: string,
  request: typeof fetch = fetch
): Promise<string> {
  const normalizedUrl = normalizeVercelDeploymentUrl(deploymentUrl);
  const endpoint = new URL(
    "/v13/deployments/" + encodeURIComponent(new URL(normalizedUrl).hostname),
    "https://api.vercel.com"
  );
  if (expected.organizationId) {
    endpoint.searchParams.set("teamId", expected.organizationId);
  }
  if (expected.gitSource) {
    endpoint.searchParams.set("withGitRepoInfo", "true");
  }
  const response = await request(endpoint, {
    headers: { authorization: "Bearer " + expected.token }
  });
  if (!response.ok) {
    throw new Error(
      "Authenticated Vercel deployment lookup failed without exposing provider details."
    );
  }
  return assertExpectedVercelDeployment(
    (await response.json()) as VercelDeployment,
    expected,
    normalizedUrl
  );
}
