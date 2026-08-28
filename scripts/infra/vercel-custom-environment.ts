type FetchResponse = Pick<Response, "ok" | "status" | "json" | "text">;
type FetchImplementation = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export type VercelCustomEnvironment = {
  id?: string;
  slug?: string;
};

export type ReconcileVercelEnvironmentInput = {
  token: string;
  organizationId: string;
  projectId: string;
  slug: string;
  description: string;
  fetchImplementation?: FetchImplementation;
};

function endpoint(projectId: string, organizationId: string): string {
  const url = new URL(
    `/v9/projects/${encodeURIComponent(projectId)}/custom-environments`,
    "https://api.vercel.com"
  );
  url.searchParams.set("teamId", organizationId);
  return url.toString();
}

function environmentsFrom(payload: unknown): VercelCustomEnvironment[] {
  if (Array.isArray(payload)) {
    return payload as VercelCustomEnvironment[];
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["environments", "customEnvironments"]) {
      if (Array.isArray(record[key])) {
        return record[key] as VercelCustomEnvironment[];
      }
    }
  }
  throw new Error("Vercel custom-environment listing returned an unsupported response shape.");
}

export function selectCustomEnvironment(
  environments: VercelCustomEnvironment[],
  slug: string
): VercelCustomEnvironment | undefined {
  const matches = environments.filter((environment) => environment.slug === slug);
  if (matches.length > 1) {
    throw new Error(`Vercel custom environment ${slug} is ambiguous; reconciliation stopped.`);
  }
  return matches[0];
}

async function responseJson(response: FetchResponse, operation: string): Promise<unknown> {
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`Vercel ${operation} failed with HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

export async function reconcileVercelCustomEnvironment(
  input: ReconcileVercelEnvironmentInput
): Promise<{ created: boolean; environment: VercelCustomEnvironment }> {
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  const url = endpoint(input.projectId, input.organizationId);
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json"
  };

  const list = async () =>
    environmentsFrom(
      await responseJson(await fetchImplementation(url, { headers }), "custom-environment read")
    );

  const existing = selectCustomEnvironment(await list(), input.slug);
  if (existing) {
    return { created: false, environment: existing };
  }

  await responseJson(
    await fetchImplementation(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ slug: input.slug, description: input.description })
    }),
    "custom-environment create"
  );

  const created = selectCustomEnvironment(await list(), input.slug);
  if (!created) {
    throw new Error(`Vercel did not return the newly created custom environment ${input.slug}.`);
  }
  return { created: true, environment: created };
}
