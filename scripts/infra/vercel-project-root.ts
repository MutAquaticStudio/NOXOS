type FetchResponse = Pick<Response, "ok" | "status" | "json" | "text">;
type FetchImplementation = (input: string, init?: RequestInit) => Promise<FetchResponse>;

type VercelProject = {
  id?: string;
  rootDirectory?: string | null;
};

export type ReconcileVercelProjectRootInput = {
  token: string;
  organizationId: string;
  projectId: string;
  rootDirectory: string;
  fetchImplementation?: FetchImplementation;
};

function endpoint(projectId: string, organizationId: string): string {
  const url = new URL(`/v9/projects/${encodeURIComponent(projectId)}`, "https://api.vercel.com");
  url.searchParams.set("teamId", organizationId);
  return url.toString();
}

async function responseJson(response: FetchResponse, operation: string): Promise<VercelProject> {
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`Vercel ${operation} failed with HTTP ${response.status}: ${detail}`);
  }
  return (await response.json()) as VercelProject;
}

function assertExpectedProject(
  project: VercelProject,
  input: ReconcileVercelProjectRootInput
): void {
  if (project.id && project.id !== input.projectId) {
    throw new Error("Vercel project read-back did not match the protected CI project identity.");
  }
  if (project.rootDirectory !== input.rootDirectory) {
    throw new Error(
      "Vercel project root-directory read-back did not match the canonical app root."
    );
  }
}

export async function reconcileVercelProjectRoot(
  input: ReconcileVercelProjectRootInput
): Promise<{ updated: boolean; project: VercelProject }> {
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  const url = endpoint(input.projectId, input.organizationId);
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json"
  };

  const read = async () =>
    responseJson(await fetchImplementation(url, { headers }), "project read");
  const current = await read();
  if (current.rootDirectory === input.rootDirectory) {
    assertExpectedProject(current, input);
    return { updated: false, project: current };
  }

  await responseJson(
    await fetchImplementation(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ rootDirectory: input.rootDirectory })
    }),
    "project root-directory update"
  );

  const reconciled = await read();
  assertExpectedProject(reconciled, input);
  return { updated: true, project: reconciled };
}
