const repository = process.env.GITHUB_REPOSITORY;
const pullRequestNumber = process.env.GITHUB_PR_NUMBER;
const token = process.env.GITHUB_TOKEN;

if (!repository || !pullRequestNumber || !token) {
  throw new Error("GitHub pull request context is required for frozen-control verification.");
}

const protectedPaths = new Set([
  "contracts/frozen-inputs.json",
  "scripts/contracts/check-frozen-inputs.mjs",
  "scripts/contracts/check-pr-frozen-controls.mjs",
  ".github/workflows/frozen-input-controls.yml"
]);
const protectedBasenames = new Set([
  "NOX_OS_GATE_0_ARCHITECTURE_v1.0.md",
  "NOX_OS_UXUI_GUIDELINE_v1.md"
]);

let next =
  "https://api.github.com/repos/" +
  repository +
  "/pulls/" +
  pullRequestNumber +
  "/files?per_page=100";
const changedFiles = [];

while (next) {
  const response = await fetch(next, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + token,
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error("Unable to read pull request file changes for frozen-control verification.");
  }
  const files = await response.json();
  if (!Array.isArray(files)) {
    throw new Error("GitHub returned an invalid pull request file list.");
  }
  changedFiles.push(...files.map((file) => file.filename));

  const link = response.headers.get("link") ?? "";
  const match = link.match(/<([^>]+)>; rel="next"/);
  next = match?.[1] ?? "";
}

const violations = changedFiles.filter((file) => {
  const basename = file.split("/").at(-1);
  return protectedPaths.has(file) || protectedBasenames.has(basename);
});

if (violations.length > 0) {
  throw new Error(
    "Frozen architecture controls changed by a normal pull request: " + violations.join(", ")
  );
}

console.log("FROZEN_INPUT_CONTROLS=PASS");
