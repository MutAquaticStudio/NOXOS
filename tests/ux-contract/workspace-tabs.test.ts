import { describe, expect, it } from "vitest";
import {
  restoreWorkspaceTabs,
  serializeWorkspaceTabs,
  workspaceStorageKey
} from "../../packages/ui/src/workspace-tabs";

const scope = { userId: "user-a", tenantId: "tenant-a" };
const resolveRoute = (type: string, id: string) =>
  type === "Material" && /^[0-9a-f-]{36}$/.test(id) ? `/materials/${id}` : undefined;
const objectId = "11111111-1111-4111-8111-111111111111";
const tab = {
  objectType: "Material",
  objectId,
  pinned: true,
  route: `/materials/${objectId}`,
  title: "Private material name"
};

describe("workspace preference boundary", () => {
  it("persists only scoped, versioned identity metadata", () => {
    const raw = serializeWorkspaceTabs(scope, [tab]);
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      ...scope,
      tabs: [{ objectType: "Material", objectId, pinned: true }]
    });
    expect(raw).not.toContain("Private material name");
    expect(raw).not.toContain("/materials/");
    expect(restoreWorkspaceTabs(raw, scope, resolveRoute)).toEqual([
      { objectType: "Material", objectId, pinned: true, route: tab.route }
    ]);
  });
  it("rejects cross-user, cross-tenant, invalid version and malformed preferences", () => {
    const raw = serializeWorkspaceTabs(scope, [tab]);
    expect(restoreWorkspaceTabs(raw, { ...scope, tenantId: "tenant-b" }, resolveRoute)).toEqual([]);
    expect(restoreWorkspaceTabs(raw, { ...scope, userId: "user-b" }, resolveRoute)).toEqual([]);
    expect(
      restoreWorkspaceTabs(
        raw.replace('"schemaVersion":1', '"schemaVersion":2'),
        scope,
        resolveRoute
      )
    ).toEqual([]);
    expect(restoreWorkspaceTabs("{", scope, resolveRoute)).toEqual([]);
    expect(workspaceStorageKey(scope)).not.toBe(
      workspaceStorageKey({ ...scope, tenantId: "tenant-b" })
    );
  });
  it("does not trust stored routes, labels, unauthorized objects, or duplicate references", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      ...scope,
      tabs: [
        { ...tab, route: "https://attacker.invalid", title: "Administrator" },
        tab,
        { ...tab, objectType: "Unknown" },
        { ...tab, objectId: "../../platform/users" },
        { ...tab, pinned: "true" }
      ]
    });
    expect(restoreWorkspaceTabs(raw, scope, resolveRoute)).toEqual([
      { objectType: "Material", objectId, pinned: true, route: tab.route }
    ]);
    expect(restoreWorkspaceTabs(raw, scope, () => undefined)).toEqual([]);
  });
});
