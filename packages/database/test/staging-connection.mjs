export function safeDatabaseFailureCode(error) {
  const allowed = new Set([
    "28P01",
    "28000",
    "42501",
    "42P01",
    "42703",
    "23503",
    "23505",
    "23514",
    "55P03",
    "40001",
    "40P01",
    "ERR_ASSERTION",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "CONNECT_TIMEOUT",
    "ENOTFOUND",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID"
  ]);
  return allowed.has(error?.code) ? error.code : "UNCLASSIFIED";
}

export function parseStagingRuntimeUrl(raw) {
  if (!raw) throw Error("Missing protected staging value: NOX_RUNTIME_DATABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error("Invalid protected database URL.");
  }
  const options = [...url.searchParams];
  const checks = {
    PROTOCOL: ["postgres:", "postgresql:"].includes(url.protocol),
    SYDNEY_POOL_HOST: /^aws-[0-9]+-ap-southeast-2\.pooler\.supabase\.com$/.test(url.hostname),
    TRANSACTION_POOL_PORT: url.port === "6543",
    STAGING_RUNTIME_USER:
      decodeURIComponent(url.username) === "nox_app_runtime.uyfddpmbszjkhdkqvncz",
    DATABASE_NAME: url.pathname === "/postgres",
    PASSWORD_PRESENT: Boolean(url.password),
    TLS_OPTIONS:
      options.length === 0 ||
      (options.length === 1 &&
        options[0][0] === "sslmode" &&
        ["require", "verify-full"].includes(options[0][1])),
    NO_FRAGMENT: url.hash === ""
  };
  const failed = Object.entries(checks)
    .filter(([, pass]) => !pass)
    .map(([name]) => name);
  if (failed.length) throw Error(`STAGING_CONNECTION_CONFIG_FAILED:${failed.join(",")}`);
  // postgres.js parses sslmode into ssl. Drop only validated TLS options so the
  // explicit rejectUnauthorized:true object remains the sole TLS authority.
  url.search = "";
  return url;
}
