import { describe, expect, it } from "vitest";
import {
  clampInspectorWidth,
  parseShellPreferences
} from "../../packages/ui/src/shell-preferences";

describe("presentation preference contract", () => {
  it("defaults safely for corrupt and unknown versions", () => {
    for (const raw of [null, "{", '{"schemaVersion":2,"inspectorOpen":true}']) {
      expect(parseShellPreferences(raw)).toEqual({
        inspectorOpen: false,
        inspectorWidth: 320,
        density: "MODULE",
        interaction: "AUTO"
      });
    }
  });
  it("bounds widths and separates interaction from density without preserving extra data", () => {
    expect([100, 280, 320, 420, 999, NaN].map(clampInspectorWidth)).toEqual([
      280, 280, 320, 420, 420, 320
    ]);
    expect(
      parseShellPreferences(
        JSON.stringify({
          schemaVersion: 1,
          inspectorOpen: true,
          inspectorWidth: 999,
          density: "COMPACT",
          interaction: "TOUCH",
          permissions: ["admin"],
          rawBrief: "private"
        })
      )
    ).toEqual({
      inspectorOpen: true,
      inspectorWidth: 420,
      density: "COMPACT",
      interaction: "TOUCH"
    });
    expect(
      parseShellPreferences('{"schemaVersion":1,"density":"huge","interaction":"admin"}').density
    ).toBe("MODULE");
  });
});
