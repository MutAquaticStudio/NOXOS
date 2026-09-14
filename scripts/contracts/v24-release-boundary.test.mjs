import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("v2.4 disables implicit Git deployments for every branch", () => {
  const config = JSON.parse(read("apps/nox-os/vercel.json"));
  assert.equal(config.git.deploymentEnabled, false);
});

test("all inherited Preview and legacy Staging jobs are explicitly retired", () => {
  for (const path of [".github/workflows/preview.yml", ".github/workflows/staging.yml"]) {
    const jobs = read(path).split(/^jobs:\s*$/m)[1];
    assert.ok(jobs, `${path}: missing jobs`);
    const blocks = jobs.split(/^  [\w-]+:\s*$/m).slice(1);
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      assert.match(block, /^    if: \$\{\{ false \}\}$/m, path);
      assert.equal((block.match(/^    if:/gm) ?? []).length, 1, path);
    }
  }
});
