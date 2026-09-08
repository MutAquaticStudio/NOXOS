import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFoundationApi, createPlatformCoreApi, createRequestContext } from "@nox-os/platform";
import { UnavailableScientificAdapter } from "@nox-os/scientific";
import { createPostgresPlatformStore, type PlatformStore } from "./platform-store.js";

// Only the disposable cloud-migration-replay database; never a hosted project.
const url = process.env.G2_REVISION_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
  throw new Error("G2 revision tests require disposable loopback PostgreSQL.");

describe.skipIf(!url)("G2 revision — real PostgreSQL API transactions", () => {
  let admin: Sql;
  let runtime: Sql;
  let store: PlatformStore;
  const fixtures: { actors: string[]; tenantId: string; requestId: string }[] = [];

  beforeAll(async () => {
    admin = postgres(url!, { prepare: false, max: 1 });
    runtime = postgres(url!, {
      prepare: false,
      max: 4,
      connection: { options: "-c role=nox_app_runtime" }
    });
    store = createPostgresPlatformStore(runtime);
    expect((await runtime`select current_user as role`)[0].role).toBe("nox_app_runtime");
  });

  afterAll(async () => {
    await runtime?.end();
    if (!admin) return;
    try {
      for (const fixture of fixtures) {
        await admin`delete from platform.audit_events where request_id = ${fixture.requestId}`;
        await admin`delete from platform.tenant_memberships where tenant_id = ${fixture.tenantId}`;
        await admin`delete from platform.tenants where id = ${fixture.tenantId}`;
        for (const actor of fixture.actors) {
          await admin`delete from platform.platform_users where id = ${actor}`;
          await admin`delete from auth.users where id = ${actor}`;
        }
      }
    } finally {
      await admin.end();
    }
  });

  it.each(["user", "tenant", "membership"] as const)(
    "%s preserves microsecond revision, serializes conflicting writes, replays no-op and rolls back audit failure",
    async (kind) => {
      const ownerId = randomUUID();
      const userId = randomUUID();
      const tenantId = randomUUID();
      const requestId = randomUUID();
      fixtures.push({ actors: [userId, ownerId], tenantId, requestId });
      for (const actor of [ownerId, userId]) {
        await admin`insert into auth.users (id) values (${actor})`;
        await admin`insert into platform.platform_users (id, status, platform_role_key, updated_at)
          values (${actor}, 'ACTIVE', ${actor === ownerId ? "PLATFORM_OWNER" : null}, '2099-01-01 00:00:00.123456+00')`;
      }
      await admin`insert into platform.tenants (id, name, slug, status, updated_at)
        values (${tenantId}, 'Revision fixture', ${"revision-" + tenantId}, 'ACTIVE', '2099-01-01 00:00:00.123456+00')`;
      for (const actor of [ownerId, userId])
        await admin`insert into platform.tenant_memberships (tenant_id, user_id, role_key, status, updated_at)
          values (${tenantId}, ${actor}, ${actor === ownerId ? "TENANT_OWNER" : "TENANT_MEMBER"}, 'ACTIVE', '2099-01-01 00:00:00.123456+00')`;

      let failAudit = false;
      // Fault injection changes only the audit input. The real SQL NOT NULL
      // constraint must fail AFTER the real UPDATE inside the real transaction.
      const faultStore = new Proxy(store, {
        get(target, key) {
          if (key === "transaction")
            return <T>(operation: (tx: PlatformStore) => Promise<T>) =>
              target.transaction((tx) =>
                operation(
                  new Proxy(tx, {
                    get(transaction, property) {
                      if (property === "insertAuditEvent")
                        return (input: Parameters<PlatformStore["insertAuditEvent"]>[0]) =>
                          transaction.insertAuditEvent(
                            failAudit ? { ...input, requestId: null as unknown as string } : input
                          );
                      const value = Reflect.get(transaction, property);
                      return typeof value === "function" ? value.bind(transaction) : value;
                    }
                  })
                )
              );
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      const api = createFoundationApi({
        modules: [],
        scientificGateway: new UnavailableScientificAdapter(),
        environment: { NOX_ENV: "test", VERCEL_GIT_COMMIT_SHA: "g2-revision-test" },
        platformCore: createPlatformCoreApi({
          store: faultStore,
          accessTokenVerifier: {
            async verifyAccessToken(token) {
              return token === ownerId
                ? { kind: "AUTHENTICATED", identity: { userId: ownerId } }
                : { kind: "AUTH_INVALID" };
            }
          }
        })
      });
      const path =
        kind === "user"
          ? `/platform/users/${userId}`
          : kind === "tenant"
            ? "/tenant"
            : `/platform/tenants/${tenantId}/members/${userId}`;
      const headers = {
        authorization: `Bearer ${ownerId}`,
        "x-nox-tenant-id": tenantId,
        "x-request-id": requestId
      };
      const dispatch = (method: string, targetPath: string, body?: unknown) =>
        api.dispatch({
          method,
          path: targetPath,
          headers,
          body,
          context: { ...createRequestContext(api.identity, headers), requestId }
        });
      const read = () =>
        kind === "user"
          ? store.findPlatformUser(userId)
          : kind === "tenant"
            ? store.findTenant(tenantId)
            : store.findTenantMembership(tenantId, userId);
      const auditCount = async () =>
        Number(
          (
            await admin`select count(*) from platform.audit_events where request_id = ${requestId}`
          )[0].count
        );
      const before = (await read())!;
      const initialRevision = "4070908800.123456";
      expect(before.revision).toBe(initialRevision);
      // The browser-facing read must carry the exact same token, not Date milliseconds.
      const listing = await dispatch(
        "GET",
        kind === "user"
          ? "/platform/users"
          : kind === "tenant"
            ? "/tenant"
            : `/platform/tenants/${tenantId}/members`
      );
      expect(listing.status).toBe(200);
      expect(JSON.stringify(listing.body)).toContain(`"revision":"${initialRevision}"`);
      const alternatives =
        kind === "user"
          ? [{ displayName: "First" }, { displayName: "Second" }]
          : kind === "tenant"
            ? [{ name: "First" }, { name: "Second" }]
            : [{ roleKey: "TENANT_ADMIN" }, { roleKey: "TENANT_OWNER" }];
      const responses = await Promise.all(
        alternatives.map((body) =>
          dispatch("PATCH", path, { ...body, expectedRevision: initialRevision })
        )
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
        error: { code: "PLATFORM_RESOURCE_STALE" }
      });
      const saved = (await read())!;
      // Future timestamp deliberately exercises the monotonic +1 microsecond path.
      expect(saved.revision).toBe("4070908800.123457");
      expect(await auditCount()).toBe(1);
      const winner = alternatives[responses.findIndex((response) => response.status === 200)]!;
      expect(
        (await dispatch("PATCH", path, { ...winner, expectedRevision: initialRevision })).status
      ).toBe(200);
      expect(await read()).toEqual(saved);
      expect(await auditCount()).toBe(1);

      const third =
        kind === "user"
          ? { displayName: "Third" }
          : kind === "tenant"
            ? { name: "Third" }
            : { roleKey: "TENANT_MEMBER" };
      failAudit = true;
      expect(
        (await dispatch("PATCH", path, { ...third, expectedRevision: saved.revision })).status
      ).toBe(500);
      expect(await read()).toEqual(saved);
      expect(await auditCount()).toBe(1);
      failAudit = false;
      expect(
        (await dispatch("PATCH", path, { ...third, expectedRevision: saved.revision })).status
      ).toBe(200);
      expect((await read())?.revision).toBe("4070908800.123458");
      expect(await auditCount()).toBe(2);
    }
  );
});
