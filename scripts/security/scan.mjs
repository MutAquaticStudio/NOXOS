import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";

const forbiddenFiles = fg.sync([".env", ".env.*"], {
  ignore: [".env.example", "node_modules/**"]
});
if (forbiddenFiles.length > 0) {
  throw new Error("Secret environment files must not be committed: " + forbiddenFiles.join(", "));
}

const artifactFiles = existsSync("apps/nox-os/dist")
  ? fg.sync(["apps/nox-os/dist/**"], { onlyFiles: true })
  : [];
const forbiddenBundleValues =
  /(SUPABASE_(SERVICE_ROLE_KEY|DB_PASSWORD|ACCESS_TOKEN)|NOX_(RUNTIME|WORKFLOW|MIGRATION)_DATABASE_URL|VERCEL_TOKEN|NOX_(WORKFLOW_PROBE|DIAGNOSTIC_PROBE)_TOKEN)/;

for (const file of artifactFiles) {
  if (forbiddenBundleValues.test(readFileSync(file, "utf8"))) {
    throw new Error("Server-only secret identifier found in browser artifact: " + file);
  }
}

console.log("SECRET_SCAN=PASS");
