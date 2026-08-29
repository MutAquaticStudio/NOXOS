import { randomUUID } from "node:crypto";
import {
  createPostgresMaterialStore,
  createPostgresPlatformStore,
  createRuntimeDatabase
} from "@nox-os/database";
import { requiredServerValue } from "@nox-os/config";

const userId = requiredServerValue(process.env, "NOX_PREVIEW_MATERIAL_USER_ID");
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("NOX_PREVIEW_MATERIAL_USER_ID must be an existing Supabase Auth UUID.");
}

const database = createRuntimeDatabase({
  connectionUrl: requiredServerValue(process.env, "NOX_RUNTIME_DATABASE_URL"),
  applicationName: "nox-os-preview-material-acceptance",
  expectedRole: "nox_app_runtime"
});
const platform = createPostgresPlatformStore(database);
const materials = createPostgresMaterialStore(database);
const requestId = `preview-bootstrap-${randomUUID()}`;
const tenantSlug = "nox-preview-acceptance";
const materialName = "Preview Reference Material";

try {
  const tenant = await platform.transaction(async (store) => {
    const existingUser = await store.findPlatformUser(userId);
    if (!existingUser) {
      await store.insertPlatformUser({
        id: userId,
        displayName: "Preview acceptance owner",
        status: "ACTIVE",
        platformRoleKey: "PLATFORM_OWNER"
      });
      await store.insertAuditEvent({
        actorUserId: null,
        action: "platform.owner.bootstrap",
        resourceType: "platform_user",
        resourceId: userId,
        requestId,
        correlationId: requestId,
        metadata: { actor: "SYSTEM", environment: "preview" }
      });
    } else if (
      existingUser.status !== "ACTIVE" ||
      existingUser.platformRoleKey !== "PLATFORM_OWNER"
    ) {
      await store.updatePlatformUser(userId, {
        status: "ACTIVE",
        platformRoleKey: "PLATFORM_OWNER"
      });
    }

    const tenant =
      (await store.findTenantBySlug(tenantSlug)) ??
      (await store.insertTenant({
        name: "NØX Preview Acceptance",
        slug: tenantSlug,
        status: "ACTIVE"
      }));
    const membership = await store.findTenantMembership(tenant.id, userId);
    if (!membership) {
      await store.insertTenantMembership({
        tenantId: tenant.id,
        userId,
        roleKey: "TENANT_OWNER",
        status: "ACTIVE"
      });
    } else if (membership.status !== "ACTIVE" || membership.roleKey !== "TENANT_OWNER") {
      await store.updateTenantMembership(tenant.id, userId, {
        status: "ACTIVE",
        roleKey: "TENANT_OWNER"
      });
    }
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.material-intelligence",
      enabled: true
    });
    return tenant;
  });

  const existing = await materials.searchMaterials(
    { query: materialName, limit: 20, offset: 0, view: "MY_TENANT" },
    { tenantId: tenant.id, platformAuthority: false }
  );
  if (!existing.some((item) => item.material.displayName === materialName)) {
    await materials.transaction(async (store) => {
      const material = await store.insertMaterial({
        tenantId: tenant.id,
        scope: "TENANT",
        visibility: "PRIVATE",
        displayName: materialName,
        normalizedDisplayName: materialName.toLowerCase(),
        materialType: "NATURAL",
        approvalStatus: "APPROVED",
        noteClassification: "MID",
        chemicalEntityId: null,
        contributorUserId: userId,
        approvedByUserId: userId,
        approvedByAuthority: "TENANT"
      });
      await store.insertAuditEvent({
        tenantId: tenant.id,
        actorUserId: userId,
        action: "module.material-intelligence.preview.acceptance.seed",
        resourceType: "material",
        resourceId: material.id,
        requestId,
        correlationId: requestId,
        metadata: { environment: "preview", fixture: true }
      });
    });
  }

  console.log("PREVIEW_MATERIAL_ACCEPTANCE_FIXTURE=READY");
  console.log("PREVIEW_MATERIAL_ACCEPTANCE_TENANT=" + tenant.id);
} finally {
  await database.end({ timeout: 5 });
}
