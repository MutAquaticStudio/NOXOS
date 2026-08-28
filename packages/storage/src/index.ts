import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FileAuthorization, FileReference, FileStore } from "@nox-os/contracts";
import { createOpaqueId } from "@nox-os/shared";

export type SupabaseStorageOptions = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

const storagePathSegment = /^[a-zA-Z0-9_-]{1,128}$/;

function assertStoragePathSegment(value: string, label: string): void {
  if (!storagePathSegment.test(value)) {
    throw new Error(label + " must be a safe storage-path segment.");
  }
}

function deriveStoragePath(reference: Pick<FileReference, "id" | "scope" | "tenantId">): string {
  assertStoragePathSegment(reference.id, "File identifier");
  if (reference.scope === "TENANT") {
    if (!reference.tenantId) {
      throw new Error("Tenant scope requires an explicit tenant identity.");
    }
    assertStoragePathSegment(reference.tenantId, "Tenant identifier");
    return "tenant/" + reference.tenantId + "/" + reference.id;
  }
  return "global/" + reference.id;
}

function assertFileAuthorization(
  reference: Pick<FileReference, "scope" | "tenantId" | "purpose">,
  authorization: FileAuthorization
): void {
  if (!authorization.allowedPurposes.includes(reference.purpose)) {
    throw new Error("File purpose is not authorized.");
  }
  if (reference.scope === "TENANT") {
    if (!reference.tenantId || !authorization.tenant?.id) {
      throw new Error("Tenant scope requires an explicit tenant identity.");
    }
    assertStoragePathSegment(reference.tenantId, "Tenant identifier");
    assertStoragePathSegment(authorization.tenant.id, "Authorized tenant identifier");
    if (reference.tenantId !== authorization.tenant.id) {
      throw new Error("Tenant scope is not authorized.");
    }
  }
  if (reference.scope === "GLOBAL" && reference.tenantId) {
    throw new Error("Global file references cannot contain a tenant identity.");
  }
}

function assertStoredReferenceIntegrity(reference: FileReference): void {
  if (reference.storagePath !== deriveStoragePath(reference)) {
    throw new Error("Storage path does not match the authorized file reference.");
  }
}

function createStorageClient(options: SupabaseStorageOptions): SupabaseClient {
  return createClient(options.url, options.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function ensurePrivateStorageBucket(options: SupabaseStorageOptions): Promise<void> {
  const client = createStorageClient(options);
  const listed = await client.storage.listBuckets();
  if (listed.error) {
    throw new Error("Unable to list Supabase Storage buckets.");
  }

  const existing = listed.data.find((item) => item.name === options.bucket);
  if (!existing) {
    const created = await client.storage.createBucket(options.bucket, {
      public: false,
      fileSizeLimit: "52428800"
    });
    if (created.error) {
      throw new Error("Unable to create the private NØX-OS Storage bucket.");
    }
  } else if (existing.public) {
    const updated = await client.storage.updateBucket(options.bucket, {
      public: false,
      fileSizeLimit: "52428800"
    });
    if (updated.error) {
      throw new Error("Unable to make the NØX-OS Storage bucket private.");
    }
  }

  const verified = await client.storage.getBucket(options.bucket);
  if (verified.error || verified.data.public) {
    throw new Error("Private-by-default Storage verification failed.");
  }
}

export class SupabasePrivateFileStore implements FileStore {
  private readonly client: SupabaseClient;

  constructor(private readonly options: SupabaseStorageOptions) {
    this.client = createStorageClient(options);
  }

  async put(
    reference: Omit<FileReference, "id" | "storagePath">,
    contents: Uint8Array,
    authorization: FileAuthorization
  ): Promise<FileReference> {
    assertFileAuthorization(reference, authorization);
    const id = createOpaqueId("file");
    const storagePath = deriveStoragePath({
      id,
      scope: reference.scope,
      tenantId: reference.tenantId
    });
    const result = await this.client.storage
      .from(this.options.bucket)
      .upload(storagePath, contents, {
        contentType: reference.mimeType,
        upsert: false
      });

    if (result.error) {
      throw new Error("Private storage upload failed.");
    }

    return { ...reference, id, storagePath };
  }

  async stat(reference: FileReference, authorization: FileAuthorization): Promise<FileReference> {
    assertFileAuthorization(reference, authorization);
    assertStoredReferenceIntegrity(reference);
    const result = await this.client.storage
      .from(this.options.bucket)
      .list(reference.storagePath.split("/").slice(0, -1).join("/"), {
        search: reference.storagePath.split("/").at(-1)
      });

    if (result.error || result.data.length !== 1) {
      throw new Error("Private storage object was not found.");
    }

    return reference;
  }

  async delete(reference: FileReference, authorization: FileAuthorization): Promise<void> {
    assertFileAuthorization(reference, authorization);
    assertStoredReferenceIntegrity(reference);
    const result = await this.client.storage
      .from(this.options.bucket)
      .remove([reference.storagePath]);

    if (result.error) {
      throw new Error("Private storage deletion failed.");
    }
  }

  async createDownloadGrant(
    reference: FileReference,
    authorization: FileAuthorization
  ): Promise<string> {
    assertFileAuthorization(reference, authorization);
    assertStoredReferenceIntegrity(reference);
    const result = await this.client.storage
      .from(this.options.bucket)
      .createSignedUrl(reference.storagePath, 60);

    if (result.error || !result.data?.signedUrl) {
      throw new Error("Private storage download grant failed.");
    }

    return result.data.signedUrl;
  }
}
