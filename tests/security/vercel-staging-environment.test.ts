import { describe, expect, it, vi } from "vitest";
import {
  reconcileVercelCustomEnvironment,
  selectCustomEnvironment,
  type VercelCustomEnvironment
} from "../../scripts/infra/vercel-custom-environment";

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
  slug: "staging",
  description: "Persistent acceptance"
};

describe("Vercel staging custom environment reconciliation", () => {
  it("reuses exactly one existing staging environment without mutation", async () => {
    const fetchImplementation = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ environments: [{ id: "env_1", slug: "staging" }] })
    );

    const result = await reconcileVercelCustomEnvironment({ ...input, fetchImplementation });

    expect(result).toEqual({ created: false, environment: { id: "env_1", slug: "staging" } });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0]?.[0]).toContain(
      "/v9/projects/prj_456/custom-environments?teamId=team_123"
    );
  });

  it("creates a missing staging environment once and verifies it by read-back", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(json({ environments: [] }))
      .mockResolvedValueOnce(json({ id: "env_1", slug: "staging" }, 201))
      .mockResolvedValueOnce(json({ environments: [{ id: "env_1", slug: "staging" }] }));

    const result = await reconcileVercelCustomEnvironment({ ...input, fetchImplementation });

    expect(result).toEqual({ created: true, environment: { id: "env_1", slug: "staging" } });
    expect(fetchImplementation.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ slug: "staging", description: "Persistent acceptance" })
    });
  });

  it("fails closed instead of choosing between duplicate environments", () => {
    const environments: VercelCustomEnvironment[] = [
      { id: "env_1", slug: "staging" },
      { id: "env_2", slug: "staging" }
    ];
    expect(() => selectCustomEnvironment(environments, "staging")).toThrow(/ambiguous/);
  });
});
