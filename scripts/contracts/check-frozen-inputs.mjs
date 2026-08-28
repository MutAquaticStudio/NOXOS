import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const baseline = JSON.parse(
  readFileSync(new URL("../../contracts/frozen-inputs.json", import.meta.url), "utf8")
);
const configuredRoot = process.env.CANONICAL_CONTRACT_ROOT;
const requireExternal = process.env.REQUIRE_EXTERNAL_CONTRACTS === "true";
const unresolved = [];

for (const input of baseline.inputs) {
  const candidate = configuredRoot
    ? resolve(configuredRoot, basename(input.sourcePath))
    : input.sourcePath;
  if (!existsSync(candidate)) {
    unresolved.push(input.id);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(candidate)).digest("hex");
  if (actual !== input.sha256) {
    throw new Error("Frozen input checksum mismatch: " + input.id);
  }
}

if (unresolved.length > 0 && requireExternal) {
  throw new Error(
    "Canonical frozen inputs are unavailable to this runner: " + unresolved.join(", ")
  );
}

console.log(
  unresolved.length === 0
    ? "FROZEN_INPUTS_VERIFIED=YES"
    : "FROZEN_INPUTS_VERIFIED=BASELINE_ONLY; unavailable=" + unresolved.join(",")
);
