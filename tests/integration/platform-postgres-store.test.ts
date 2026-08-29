import { describe, expect, it } from "vitest";
import { createPostgresPlatformStore } from "@nox-os/database";

describe("Postgres Platform ownership locks", () => {
  it("locks a deterministic UUID tenant set with an explicitly typed array", async () => {
    const queries: string[] = [];
    const arrays: string[][] = [];
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        queries.push(strings.join("?"));
        return [];
      },
      {
        array(values: readonly string[]) {
          arrays.push([...values]);
          return values;
        }
      }
    );
    const store = createPostgresPlatformStore(sql as never);

    await store.lockTenants([
      "b1111111-1111-1111-1111-111111111111",
      "a1111111-1111-1111-1111-111111111111",
      "b1111111-1111-1111-1111-111111111111"
    ]);

    expect(arrays).toEqual([
      ["a1111111-1111-1111-1111-111111111111", "b1111111-1111-1111-1111-111111111111"]
    ]);
    expect(queries[0]).toContain("::uuid[]");
  });
});
