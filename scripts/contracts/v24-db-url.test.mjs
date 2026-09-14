import test from "node:test";
import assert from "node:assert/strict";
import { parseStagingRuntimeUrl } from "../../packages/database/test/staging-connection.mjs";
const base =
  "postgresql://nox_app_runtime.uyfddpmbszjkhdkqvncz:synthetic-test-only@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";
test("approved TLS query options are normalized without weakening endpoint identity", () => {
  for (const query of ["", "?sslmode=require", "?sslmode=verify-full"]) {
    assert.equal(parseStagingRuntimeUrl(base + query).toString(), base);
  }
  for (const query of [
    "?sslmode=disable",
    "?sslmode=prefer",
    "?ssl=false",
    "?host=evil.test",
    "?sslmode=require&sslmode=disable",
    "?sslmode=require&options=x",
    "#fragment"
  ]) {
    assert.throws(() => parseStagingRuntimeUrl(base + query), /STAGING_CONNECTION_CONFIG_FAILED/);
  }
  assert.throws(
    () => parseStagingRuntimeUrl(base.replace("uyfddpmbszjkhdkqvncz", "soioshmcdwxhlgrjzkoc")),
    /STAGING_RUNTIME_USER/
  );
  assert.throws(
    () => parseStagingRuntimeUrl(base.replace(":6543/", ":5432/")),
    /TRANSACTION_POOL_PORT/
  );
});
