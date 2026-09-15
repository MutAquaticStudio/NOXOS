import { expect, it } from "vitest";
import { compareCandidateLines } from "../../apps/nox-os/src/candidate-diff";

const line = {
  materialId: "material-a",
  normalizedMassMg: "1001",
  activeAromaticMassMg: "1000",
  carrierSolventMassMg: "1",
  materialSnapshot: { snapshotHash: "snapshot-a", material: { displayName: "Same name" } }
};

it("matches stable IDs, never merges Materials with the same name", () => {
  expect(
    compareCandidateLines([line], [{ ...line, materialId: "material-b" }]).map((row) => row.state)
  ).toEqual(["Removed", "Added"]);
  expect(
    compareCandidateLines(
      [line],
      [
        {
          ...line,
          materialSnapshot: { ...line.materialSnapshot, material: { displayName: "Renamed" } }
        }
      ]
    )[0]?.state
  ).toBe("Unchanged");
});
it("preserves one-mg differences beyond JS numeric precision and flags changed evidence", () => {
  const before = { ...line, normalizedMassMg: "9007199254740992" };
  const after = { ...before, normalizedMassMg: "9007199254740993" };
  const row = compareCandidateLines([before], [after])[0]!;
  expect(row.state).toBe("Changed");
  expect(row.before?.normalizedMassMg).toBe("9007199254740992");
  expect(row.after?.normalizedMassMg).toBe("9007199254740993");
  for (const changed of [
    { ...line, activeAromaticMassMg: "999" },
    { ...line, carrierSolventMassMg: "2" },
    { ...line, materialSnapshot: { ...line.materialSnapshot, snapshotHash: "new" } }
  ])
    expect(compareCandidateLines([line], [changed])[0]?.state).toBe("Changed");
});
it("does not mutate source arrays and treats a candidate compared with itself as unchanged", () => {
  const before = structuredClone(line);
  expect(compareCandidateLines([line], [line])[0]?.state).toBe("Unchanged");
  expect(line).toEqual(before);
  expect(compareCandidateLines([], [])).toEqual([]);
});
