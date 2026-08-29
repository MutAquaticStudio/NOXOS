import { randomUUID } from "node:crypto";
import { SupabaseAccessTokenVerifier } from "@nox-os/auth";
import { requiredServerValue } from "@nox-os/config";
import { createPostgresPlatformStore, createRuntimeDatabase } from "@nox-os/database";
import { createPlatformCoreApi } from "@nox-os/platform";

const userId = requiredServerValue(process.env, "NOX_PLATFORM_OWNER_BOOTSTRAP_USER_ID");
const database = createRuntimeDatabase({
  connectionUrl: requiredServerValue(process.env, "NOX_RUNTIME_DATABASE_URL"),
  applicationName: "nox-os-platform-owner-bootstrap",
  expectedRole: "nox_app_runtime"
});

try {
  const core = createPlatformCoreApi({
    store: createPostgresPlatformStore(database),
    // The trusted bootstrap is not an HTTP authentication path. This verifier
    // exists only to satisfy the service boundary and is never called here.
    accessTokenVerifier: new SupabaseAccessTokenVerifier({
      url: requiredServerValue(process.env, "SUPABASE_URL"),
      publishableKey: requiredServerValue(process.env, "SUPABASE_PUBLISHABLE_KEY")
    })
  });
  const user = await core.bootstrapPlatformOwner({
    userId,
    requestId: `bootstrap_${randomUUID()}`,
    correlationId: `bootstrap_${randomUUID()}`
  });
  console.log(`PLATFORM_OWNER_BOOTSTRAP=PASS userId=${user.id}`);
} finally {
  await database.end({ timeout: 5 });
}
