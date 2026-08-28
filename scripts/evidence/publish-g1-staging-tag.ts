import { fileURLToPath } from "node:url";

function required(raw: Record<string, string | undefined>, name: string): string {
  const value = raw[name];
  if (!value) {
    throw new Error(name + " is required to publish G1 evidence provenance.");
  }
  return value;
}

export function g1StagingTagName(sourceSha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) {
    throw new Error("G1 evidence tag requires a full Git commit SHA.");
  }
  return "g1-staging-accepted-" + sourceSha.toLowerCase();
}

function g1StagingArtifactName(sourceSha: string): string {
  return "g1-staging-evidence-" + sourceSha.toLowerCase();
}

function assertRepository(repository: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository pair.");
  }
}

function assertRunUrl(runUrl: string, repository: string): void {
  const prefix = "https://github.com/" + repository + "/actions/runs/";
  if (!runUrl.startsWith(prefix) || !/^\d+$/.test(runUrl.slice(prefix.length))) {
    throw new Error("GITHUB_RUN_URL must identify a run in the evidence repository.");
  }
}

async function github(
  path: string,
  options: RequestInit,
  raw: Record<string, string | undefined>,
  request: typeof fetch
): Promise<Response> {
  return await request("https://api.github.com" + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + required(raw, "GITHUB_TOKEN"),
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...options.headers
    }
  });
}

async function existingTagTarget(
  repository: string,
  sourceSha: string,
  tagName: string,
  raw: Record<string, string | undefined>,
  request: typeof fetch
): Promise<"MISSING" | "VERIFIED"> {
  const refPath = "/repos/" + repository + "/git/ref/tags/" + encodeURIComponent(tagName);
  const existing = await github(refPath, { method: "GET" }, raw, request);
  if (existing.status === 404) {
    return "MISSING";
  }
  if (!existing.ok) {
    throw new Error("G1 evidence tag lookup failed without exposing provider details.");
  }

  const ref = (await existing.json()) as { object?: { type?: string; sha?: string } };
  if (ref.object?.type !== "tag" || !ref.object.sha) {
    throw new Error("Existing G1 evidence ref is not an annotated tag.");
  }
  const tagResponse = await github(
    "/repos/" + repository + "/git/tags/" + ref.object.sha,
    { method: "GET" },
    raw,
    request
  );
  if (!tagResponse.ok) {
    throw new Error("Existing G1 evidence tag could not be verified.");
  }
  const tag = (await tagResponse.json()) as {
    tag?: string;
    message?: string;
    object?: { type?: string; sha?: string };
  };
  if (tag.object?.type !== "commit" || tag.object.sha !== sourceSha) {
    throw new Error("Existing G1 evidence tag points to a different source commit.");
  }
  const messageLines = new Set(tag.message?.split("\n") ?? []);
  const runLine = [...messageLines].find((line) => line.startsWith("Actions: "));
  if (
    tag.tag !== tagName ||
    !messageLines.has("Source: " + sourceSha) ||
    !messageLines.has("Artifact: " + g1StagingArtifactName(sourceSha)) ||
    !runLine
  ) {
    throw new Error("Existing G1 evidence tag does not preserve its required provenance.");
  }
  assertRunUrl(runLine.slice("Actions: ".length), repository);
  return "VERIFIED";
}

export async function verifyG1StagingTag(
  raw: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch
): Promise<string> {
  const repository = required(raw, "GITHUB_REPOSITORY");
  assertRepository(repository);
  const sourceSha = required(raw, "EXPECTED_STAGING_SHA").toLowerCase();
  const tagName = g1StagingTagName(sourceSha);
  if ((await existingTagTarget(repository, sourceSha, tagName, raw, request)) !== "VERIFIED") {
    throw new Error("The immutable G1 Staging acceptance tag does not exist for this source SHA.");
  }
  return tagName;
}

export async function publishG1StagingTag(
  raw: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch
): Promise<string> {
  const repository = required(raw, "GITHUB_REPOSITORY");
  assertRepository(repository);
  const sourceSha = required(raw, "EXPECTED_STAGING_SHA").toLowerCase();
  const tagName = g1StagingTagName(sourceSha);
  if ((await existingTagTarget(repository, sourceSha, tagName, raw, request)) === "VERIFIED") {
    return tagName;
  }

  const runUrl = required(raw, "GITHUB_RUN_URL");
  const artifactName = required(raw, "G1_EVIDENCE_ARTIFACT_NAME");
  assertRunUrl(runUrl, repository);
  if (artifactName !== g1StagingArtifactName(sourceSha)) {
    throw new Error("G1 evidence artifact name must bind to the accepted source SHA.");
  }
  const tagObjectResponse = await github(
    "/repos/" + repository + "/git/tags",
    {
      method: "POST",
      body: JSON.stringify({
        tag: tagName,
        message:
          "NØX-OS G1 Staging acceptance\n\nSource: " +
          sourceSha +
          "\nActions: " +
          runUrl +
          "\nArtifact: " +
          artifactName,
        object: sourceSha,
        type: "commit"
      })
    },
    raw,
    request
  );
  if (!tagObjectResponse.ok) {
    throw new Error("Annotated G1 evidence tag creation failed.");
  }
  const tagObject = (await tagObjectResponse.json()) as { sha?: string };
  if (!tagObject.sha) {
    throw new Error("Annotated G1 evidence tag creation returned no object identity.");
  }
  const refResponse = await github(
    "/repos/" + repository + "/git/refs",
    {
      method: "POST",
      body: JSON.stringify({ ref: "refs/tags/" + tagName, sha: tagObject.sha })
    },
    raw,
    request
  );
  if (!refResponse.ok) {
    throw new Error("Annotated G1 evidence ref creation failed.");
  }
  return tagName;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tagName = await publishG1StagingTag();
  console.log("G1_EVIDENCE_TAG=" + tagName);
}
