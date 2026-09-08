import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DesignStudioStore } from "@nox-os/design-studio";
import { createPostgresDesignStudioStore } from "./design-studio-store.js";

// Executed in the existing cloud-migration-replay job after Supabase db reset.
// Never accept a provider/project URL for this disposable integration test.
const url = process.env.G4_CREATION_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
    throw new Error("G4 creation database tests require disposable loopback PostgreSQL.");
}

describe.skipIf(!url)("G4 creation — real PostgreSQL transaction/replay", () => {
  let admin: Sql;
  let runtime: Sql;
  let store: DesignStudioStore;
  const tenants = [randomUUID(), randomUUID()];
  const actors = [randomUUID(), randomUUID()];
  const command = () => ({
    tenantId: tenants[0],
    actorUserId: actors[0],
    name: "Replay test",
    description: null,
    operationKey: randomUUID(),
    requestId: "g4-creation-test",
    correlationId: "g4-creation-test"
  });
  const briefCommand = (projectId: string): Parameters<DesignStudioStore["createBrief"]>[0] => ({
    ...command(),
    projectId,
    workflowMode: "FORMULA_GENERATION",
    rawBrief: "Quiet citrus",
    briefPayload: { signals: [], assetReferences: [] },
    // Store-level JSON persistence fixture; HTTP/domain validation is separately tested.
    normalizedIntent: {} as Parameters<DesignStudioStore["createBrief"]>[0]["normalizedIntent"]
  });

  beforeAll(async () => {
    admin = postgres(url!, { prepare: false, max: 1 });
    runtime = postgres(url!, {
      prepare: false,
      max: 4,
      connection: { options: "-c role=nox_app_runtime" }
    });
    store = createPostgresDesignStudioStore(runtime);
    expect((await runtime`select current_user as role`)[0].role).toBe("nox_app_runtime");
    for (const actor of actors) {
      await admin`insert into auth.users (id) values (${actor})`;
      await admin`insert into platform.platform_users (id, status) values (${actor}, 'ACTIVE')`;
    }
    for (const tenant of tenants)
      await admin`insert into platform.tenants (id, name, slug, status) values (${tenant}, 'G4 creation fixture', ${"g4-" + tenant}, 'ACTIVE')`;
  });

  afterAll(async () => {
    await runtime?.end();
    if (!admin) return;
    try {
      for (const tenant of tenants) {
        await admin`delete from design_studio.design_briefs where tenant_id = ${tenant}`;
        await admin`delete from design_studio.projects where tenant_id = ${tenant}`;
        await admin`delete from platform.audit_events where tenant_id = ${tenant}`;
        await admin`delete from platform.tenants where id = ${tenant}`;
      }
      for (const actor of actors) {
        await admin`delete from platform.platform_users where id = ${actor}`;
        await admin`delete from auth.users where id = ${actor}`;
      }
    } finally {
      await admin.end();
    }
  });

  it("concurrent Project retries commit one entity and one audit; altered intent conflicts", async () => {
    const input = command();
    const [a, b] = await Promise.all([
      store.createProject(input),
      store.createProject({ ...input, requestId: "retry-trace" })
    ]);
    expect(a.id).toBe(b.id);
    expect(
      Number(
        (
          await admin`select count(*) from platform.audit_events where tenant_id = ${input.tenantId} and resource_id = ${a.id} and action = 'project.created'`
        )[0].count
      )
    ).toBe(1);
    await expect(store.createProject({ ...input, name: "Different" })).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_CONFLICT"
    });
    // Same key is never authority over another tenant or another actor's entity.
    expect((await store.createProject({ ...input, tenantId: tenants[1] })).id).not.toBe(a.id);
    expect((await store.createProject({ ...input, actorUserId: actors[1] })).id).not.toBe(a.id);
    expect((await store.createProject(input)).id).toBe(a.id);
  });

  it("concurrent Brief retries commit one entity/audit and preserve object-key ordering semantics", async () => {
    const project = await store.createProject(command());
    const input = briefCommand(project.id);
    const [a, b] = await Promise.all([
      store.createBrief(input),
      store.createBrief({
        ...input,
        briefPayload: { assetReferences: [], signals: [] },
        requestId: "retry-trace"
      })
    ]);
    expect(a.id).toBe(b.id);
    expect(
      Number(
        (
          await admin`select count(*) from platform.audit_events where tenant_id = ${input.tenantId} and resource_id = ${a.id} and action = 'brief.updated'`
        )[0].count
      )
    ).toBe(1);
    await expect(store.createBrief({ ...input, rawBrief: "Changed" })).rejects.toMatchObject({
      status: 409
    });
    const other = await store.createProject(command());
    await expect(store.createBrief({ ...input, projectId: other.id })).rejects.toMatchObject({
      status: 409
    });
    await expect(
      store.createBrief({ ...input, operationKey: randomUUID(), tenantId: tenants[1] })
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("audit insert failure rolls back each creation and releases the key for retry", async () => {
    const input = command();
    // Controlled fault at the audit-only NOT NULL field, after entity INSERT.
    await expect(
      store.createProject({ ...input, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(
      Number(
        (
          await admin`select count(*) from design_studio.projects where creation_key = ${input.operationKey}`
        )[0].count
      )
    ).toBe(0);
    const project = await store.createProject(input);
    const brief = briefCommand(project.id);
    await expect(
      store.createBrief({ ...brief, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(
      Number(
        (
          await admin`select count(*) from design_studio.design_briefs where creation_key = ${brief.operationKey!}`
        )[0].count
      )
    ).toBe(0);
    expect((await store.createBrief(brief)).id).toBeTruthy();
    expect(
      Number(
        (
          await admin`select count(*) from platform.audit_events where tenant_id = ${input.tenantId} and resource_id = ${project.id}`
        )[0].count
      )
    ).toBe(1);
  });
});
