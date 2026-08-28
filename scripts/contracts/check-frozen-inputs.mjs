import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const baseline = JSON.parse(
  readFileSync(new URL("../../contracts/frozen-inputs.json", import.meta.url), "utf8")
);
const configuredRoot = process.env.CANONICAL_CONTRACT_ROOT;
const requireExternal = process.env.REQUIRE_EXTERNAL_CONTRACTS === "true";
const unresolved = [];
const verifiedSources = new Set();

for (const input of baseline.inputs) {
  let contents;
  const encryptedCiMirror = process.env[input.ciSecretName];
  if (encryptedCiMirror) {
    try {
      contents = gunzipSync(Buffer.from(encryptedCiMirror, "base64"));
    } catch {
      throw new Error("Encrypted frozen input mirror is invalid: " + input.id);
    }
    verifiedSources.add("ENCRYPTED_CI_MIRROR");
  } else if (!requireExternal) {
    const candidate = configuredRoot
      ? resolve(configuredRoot, basename(input.sourcePath))
      : input.sourcePath;
    if (existsSync(candidate)) {
      contents = readFileSync(candidate);
      verifiedSources.add("LOCAL_CANONICAL_MIRROR");
    }
  }

  if (!contents) {
    unresolved.push(input.id);
    continue;
  }
  const actual = createHash("sha256").update(contents).digest("hex");
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
    ? "FROZEN_INPUTS_VERIFIED=YES; sources=" + [...verifiedSources].sort().join(",")
    : "FROZEN_INPUTS_VERIFIED=BASELINE_ONLY; unavailable=" + unresolved.join(",")
);
