import { createClient } from "@supabase/supabase-js";
import { requiredServerValue } from "@nox-os/config";

const raw = process.env;
const url = requiredServerValue(raw, "SUPABASE_URL");
const serviceRoleKey = requiredServerValue(raw, "SUPABASE_SERVICE_ROLE_KEY");
const bucket = raw.SUPABASE_STORAGE_BUCKET ?? "nox-private";
const client = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const listed = await client.storage.listBuckets();
if (listed.error) {
  throw new Error("Unable to list Supabase Storage buckets.");
}

const existing = listed.data.find((item) => item.name === bucket);
if (!existing) {
  const created = await client.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "52428800"
  });
  if (created.error) {
    throw new Error("Unable to create the private NØX-OS Storage bucket.");
  }
} else if (existing.public) {
  const updated = await client.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: "52428800"
  });
  if (updated.error) {
    throw new Error("Unable to make the NØX-OS Storage bucket private.");
  }
}

const verified = await client.storage.getBucket(bucket);
if (verified.error || verified.data.public) {
  throw new Error("Private-by-default Storage verification failed.");
}

console.log("SUPABASE_PRIVATE_STORAGE=PASS");
