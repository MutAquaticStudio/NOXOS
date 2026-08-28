import { describe, expect, it, vi } from "vitest";
import { reconcileVercelProjectRoot } from "../../scripts/infra/vercel-project-root";

function json(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

const input = {
  token: "test-token",
  organizationId: "team_123",
  projectId: "prj_456",
  rootDirectory: "apps/nox-os"
};

describe("Vercel project-root reconciliation", () => {
  it("keeps the canonical project root without mutation when provider state already matches", async () => {
    const fetchImplementation = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ id: "prj_456", rootDirectory: "apps/nox-os" })
    );

    const result = await reconcileVercelProjectRoot({ ...input, fetchImplementation });

    expect(result.updated).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "https://api.vercel.com/v9/projects/prj_456?teamId=team_123"
    );
  });

  it("updates a mismatched root exactly once and requires matching provider read-back", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: null }))
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: "apps/nox-os" }))
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: "apps/nox-os" }));

    const result = await reconcileVercelProjectRoot({ ...input, fetchImplementation });

    expect(result.updated).toBe(true);
    expect(fetchImplementation.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ rootDirectory: "apps/nox-os" })
    });
  });

  it("fails closed when Vercel does not report the requested root after an update", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: null }))
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: "apps/nox-os" }))
      .mockResolvedValueOnce(json({ id: "prj_456", rootDirectory: "unexpected" }));

    await expect(reconcileVercelProjectRoot({ ...input, fetchImplementation })).rejects.toThrow(
      /root-directory read-back/
    );
  });
});
