import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  assertSha3Available,
  frameDigestPayload,
  issueSessionSecret,
  sessionSecretDigest,
  verifySessionSecret
} from "../../packages/auth/src/session-crypto.ts";

const key = { version: "test-1", environment: "staging", bytes: Buffer.alloc(32, 7) };

test("FIPS202 empty-message known-answer test and explicit byte-length framing", () => {
  assertSha3Available();
  assert.equal(
    createHash("sha3-256").update("").digest("hex"),
    "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
  );
  const bytes = frameDigestPayload("test", Buffer.from("é"));
  assert.equal(bytes.toString("hex"), "6e6f786f733a76313a74657374000000000000000002c3a9");
  for (const purpose of [undefined, null, 123, "", "a\0b", "é", "line\n", " "])
    assert.throws(() => frameDigestPayload(purpose, Buffer.alloc(0)));
});

test("session issuance has 256-bit opaque material and versioned keyed digest only", () => {
  const first = issueSessionSecret(key);
  const second = issueSessionSecret(key);
  assert.notEqual(first.secret, second.secret);
  assert.equal(Buffer.from(first.secret, "base64url").length, 32);
  assert.deepEqual(
    Object.keys(first.stored).sort(),
    ["environment", "keyVersion", "digest", "policy"].sort()
  );
  assert.equal(first.stored.policy, "HMAC-SHA3-256-KEYED-V1");
  assert.equal(verifySessionSecret(first.secret, first.stored, key), true);
  assert.equal(verifySessionSecret(second.secret, first.stored, key), false);
});

test("MAC matches independently assembled session frame", () => {
  const secret = Buffer.alloc(32, 1).toString("base64url");
  const expected = createHmac("sha3-256", key.bytes)
    .update(
      Buffer.concat([
        Buffer.from("noxos:v1:application-session\0"),
        Buffer.from("0000000000000020", "hex"),
        Buffer.alloc(32, 1)
      ])
    )
    .digest("hex");
  assert.equal(sessionSecretDigest(secret, key).digest, expected);
});

test("wrong environment, key/version, malformed token and unknown algorithm fail closed", () => {
  const value = issueSessionSecret(key);
  for (const changed of [
    { ...key, bytes: Buffer.alloc(32, 8) },
    { ...key, version: "test-2" },
    { ...key, environment: "production" }
  ]) {
    assert.equal(verifySessionSecret(value.secret, value.stored, changed), false);
  }
  for (const secret of ["", "short", value.secret + "=", " " + value.secret])
    assert.equal(verifySessionSecret(secret, value.stored, key), false);
  assert.equal(
    verifySessionSecret(value.secret, { ...value.stored, policy: "Keccak-256" }, key),
    false
  );
  assert.equal(verifySessionSecret(value.secret, { ...value.stored, digest: "bad" }, key), false);
  assert.throws(() => issueSessionSecret({ ...key, bytes: Buffer.alloc(1) }));
  assert.throws(() => issueSessionSecret({ ...key, version: "" }));
  assert.throws(() => issueSessionSecret({ ...key, version: undefined }));
});
