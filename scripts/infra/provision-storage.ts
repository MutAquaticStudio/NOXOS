import { requiredServerValue } from "@nox-os/config";
import { ensurePrivateStorageBucket } from "@nox-os/storage";

const raw = process.env;
const url = requiredServerValue(raw, "SUPABASE_URL");
const serviceRoleKey = requiredServerValue(raw, "SUPABASE_SERVICE_ROLE_KEY");
const bucket = raw.SUPABASE_STORAGE_BUCKET ?? "nox-private";
await ensurePrivateStorageBucket({ url, serviceRoleKey, bucket });

console.log("SUPABASE_PRIVATE_STORAGE=PASS");
