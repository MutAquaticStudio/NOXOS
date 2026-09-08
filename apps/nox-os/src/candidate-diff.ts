type Line = {
  materialId: string;
  normalizedMassMg: string;
  activeAromaticMassMg: string;
  carrierSolventMassMg: string;
  materialSnapshot: { snapshotHash: string; material: { displayName: string } };
};
/** Presentation only: stable Material IDs and exact integer masses, never name matching. */
export function compareCandidateLines(before: readonly Line[], after: readonly Line[]) {
  const previous = new Map(before.map((line) => [line.materialId, line]));
  const next = new Map(after.map((line) => [line.materialId, line]));
  return [...new Set([...previous.keys(), ...next.keys()])].map((materialId) => {
    const a = previous.get(materialId),
      b = next.get(materialId);
    const state = !a
      ? "Added"
      : !b
        ? "Removed"
        : a.normalizedMassMg !== b.normalizedMassMg ||
            a.activeAromaticMassMg !== b.activeAromaticMassMg ||
            a.carrierSolventMassMg !== b.carrierSolventMassMg ||
            a.materialSnapshot.snapshotHash !== b.materialSnapshot.snapshotHash
          ? "Changed"
          : "Unchanged";
    return { materialId, before: a, after: b, state };
  });
}
