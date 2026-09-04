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
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.design-studio",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.trial-sensory",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.release-readiness",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.inventory",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.procurement",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.production",
      enabled: true
    });
    await store.upsertTenantEntitlement({
      tenantId: tenant.id,
      key: "module.quality-control",
      enabled: true
    });
    return tenant;
  });

  const existing = await materials.searchMaterials(
    { query: materialName, limit: 20, offset: 0, view: "MY_TENANT" },
    { tenantId: tenant.id, platformAuthority: false }
  );
  await materials.transaction(async (store) => {
    let aggregate = existing.find((item) => item.material.displayName === materialName);
    if (!aggregate) {
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
      aggregate = await store.findMaterialAggregate(material.id);
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
    }
    if (!aggregate) throw new Error("Preview Material fixture could not be reconciled.");
    const now = new Date();
    await store.replaceOdorAssignments(aggregate.material.id, [
      {
        materialId: aggregate.material.id,
        taxonomyVersion: "1.2",
        assignmentType: "DESCRIPTOR",
        taxonomyTerm: "Jasminy",
        intensity: 7
      }
    ]);
    await store.replaceFormulationGuidance(aggregate.material.id, [
      {
        materialId: aggregate.material.id,
        applicationKey: "fine-fragrance",
        minFormulaPct: 0.01,
        recommendedFormulaPct: 100,
        maxFormulaPct: 100,
        impactClass: "MEDIUM",
        confidence: "CURATED",
        sourceReference: "nox-preview-g4-acceptance",
        createdAt: now,
        updatedAt: now
      }
    ]);
    await store.touchMaterial(aggregate.material.id);
  });

  console.log("PREVIEW_G3_G4_G5_ACCEPTANCE_FIXTURE=READY");
  console.log("PREVIEW_MATERIAL_ACCEPTANCE_TENANT=" + tenant.id);
} finally {
  await database.end({ timeout: 5 });
}
