import { readFileSync } from "node:fs";

const baseline = JSON.parse(
  readFileSync(new URL("../../contracts/frozen-inputs.json", import.meta.url), "utf8")
);
if (
  baseline.schemaVersion !== 1 ||
  !Array.isArray(baseline.inputs) ||
  baseline.inputs.length !== 2
) {
  throw new Error("Frozen input checksum baseline has an invalid shape.");
}

for (const input of baseline.inputs) {
  if (
    typeof input.id !== "string" ||
    typeof input.sourcePath !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.sha256 ?? "")
  ) {
    throw new Error("Frozen input checksum baseline contains an invalid identity.");
  }
}

console.log("FROZEN_INPUTS_VERIFIED=COMMITTED_BASELINE");
