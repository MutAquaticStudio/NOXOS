import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FileAuthorization, FileReference, FileStore } from "@nox-os/contracts";
import { createOpaqueId } from "@nox-os/shared";

export type SupabaseStorageOptions = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

function assertFileAuthorization(
  reference: Pick<FileReference, "scope" | "tenantId" | "purpose">,
  authorization: FileAuthorization
): void {
  if (!authorization.allowedPurposes.includes(reference.purpose)) {
    throw new Error("File purpose is not authorized.");
  }
  if (reference.scope === "TENANT" && reference.tenantId !== authorization.tenant?.id) {
    throw new Error("Tenant scope is not authorized.");
  }
}

export class SupabasePrivateFileStore implements FileStore {
  private readonly client: SupabaseClient;

  constructor(private readonly options: SupabaseStorageOptions) {
    this.client = createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  async put(
    reference: Omit<FileReference, "id" | "storagePath">,
    contents: Uint8Array,
    authorization: FileAuthorization
  ): Promise<FileReference> {
    assertFileAuthorization(reference, authorization);
    const id = createOpaqueId("file");
    const scope = reference.scope === "TENANT" ? "tenant/" + reference.tenantId : "global";
    const storagePath = scope + "/" + id;
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
    const result = await this.client.storage
      .from(this.options.bucket)
      .createSignedUrl(reference.storagePath, 60);

    if (result.error || !result.data?.signedUrl) {
      throw new Error("Private storage download grant failed.");
    }

    return result.data.signedUrl;
  }
}
