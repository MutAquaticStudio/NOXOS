import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresProjectOperationsStore } from "./project-operations-store.js";

const url = process.env.G12_COMMAND_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
  throw new Error("G12 command probes require disposable loopback PostgreSQL.");

describe.skipIf(!url)("G12 command revision and replay — real PostgreSQL", () => {
  let admin: Sql, runtime: Sql;
  const tenantId = randomUUID(),
    actorUserId = randomUUID();
  const trace = {
    tenantId,
    actorUserId,
    requestId: "g12-command-probe",
    correlationId: "g12-command-probe"
  };
  beforeAll(async () => {
    admin = postgres(url!, { prepare: false });
    runtime = postgres(url!, {
      prepare: false,
      max: 4,
      connection: { options: "-c role=nox_app_runtime -c statement_timeout=5000" }
    });
    expect((await runtime`select current_user as role`)[0].role).toBe("nox_app_runtime");
    await admin`insert into auth.users (id) values (${actorUserId})`;
    await admin`insert into platform.platform_users (id,status) values (${actorUserId},'ACTIVE')`;
    await admin`insert into platform.tenants (id,name,slug,status) values (${tenantId},'G12 probe',${tenantId},'ACTIVE')`;
  });
  afterAll(async () => {
    await runtime?.end();
    await admin?.end();
  });
  // Append-only fixtures remain only until the disposable CI database is destroyed.
  async function fixture() {
    const id = randomUUID();
    await admin`insert into project_operations.projects (id,tenant_id,project_code,project_type,name,owner_user_id,created_by_user_id,status,updated_at)
      values (${id},${tenantId},${id},'INTERNAL','Replay probe',${actorUserId},${actorUserId},'ACTIVE','2099-01-01T00:00:00.123456Z')`;
    const store = createPostgresProjectOperationsStore(runtime);
    const detail = (await store.findProject(tenantId, id)) as any;
    return {
      store,
      input: {
        ...trace,
        projectId: id,
        expectedRevision: detail.project.revision,
        idempotencyKey: randomUUID()
      }
    };
  }
  it("deduplicates hold/resume and rejects a stale distinct command", async () => {
    const { store, input } = await fixture();
    expect(input.expectedRevision).toMatch(/\.123456$/);
    const command = { ...input, reason: "Evidence pending" };
    const [a, b] = (await Promise.all([
      store.holdProject(command),
      store.holdProject(command)
    ])) as any[];
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("ON_HOLD");
    await expect(
      store.holdProject({ ...command, reason: "Changed payload" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    await expect(
      store.resumeProject({ ...input, idempotencyKey: randomUUID() })
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    const detail = (await store.findProject(tenantId, input.projectId)) as any;
    const resume = {
      ...input,
      expectedRevision: detail.project.revision,
      idempotencyKey: randomUUID()
    };
    await Promise.all([store.resumeProject(resume), store.resumeProject(resume)]);
    expect(((await store.findProject(tenantId, input.projectId)) as any).project.status).toBe(
      "ACTIVE"
    );
    expect(((await store.holdProject(command)) as any).status).toBe("ON_HOLD"); // historical receipt, no new mutation
    expect(((await store.findProject(tenantId, input.projectId)) as any).project.status).toBe(
      "ACTIVE"
    );
    expect(
      await admin`select id from platform.audit_events where tenant_id=${tenantId} and resource_id=${input.projectId}`
    ).toHaveLength(2);
    await expect(store.holdProject({ ...command, tenantId: randomUUID() })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND"
    });
  });
  it("serializes different commands from one revision", async () => {
    const { store, input } = await fixture();
    const outcomes = await Promise.allSettled([
      store.holdProject({ ...input, reason: "First" }),
      store.holdProject({ ...input, idempotencyKey: randomUUID(), reason: "Second" })
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((x) => x.status === "rejected")).toMatchObject({
      reason: { code: "STALE_VERSION" }
    });
  });
  it("rolls back transition and receipt when audit fails", async () => {
    const { store, input } = await fixture();
    await expect(
      store.holdProject({ ...input, reason: "Hold", requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(((await store.findProject(tenantId, input.projectId)) as any).project.status).toBe(
      "ACTIVE"
    );
    expect(((await store.holdProject({ ...input, reason: "Hold" })) as any).status).toBe("ON_HOLD");
  });
  it("deduplicates internal updates and rolls back failed audit", async () => {
    const { store, input } = await fixture();
    const update = { ...input, updateType: "NOTE", summary: "Evidence note" };
    await expect(
      store.createUpdate({ ...update, requestId: null as unknown as string })
    ).rejects.toMatchObject({ code: "23502" });
    expect(((await store.findProject(tenantId, input.projectId)) as any).updates).toHaveLength(0);
    const [a, b] = (await Promise.all([
      store.createUpdate(update),
      store.createUpdate(update)
    ])) as any[];
    expect(a.id).toBe(b.id);
    await expect(store.createUpdate({ ...update, summary: "Changed" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT"
    });
    expect(((await store.findProject(tenantId, input.projectId)) as any).updates).toHaveLength(1);
  });
});
