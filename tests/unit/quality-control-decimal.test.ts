import { describe, expect, it } from "vitest";
import {
  compareExactDecimals,
  inspectionResultInputSchema,
  numericRangeJudgement,
  specificationItemInputSchema
} from "@nox-os/quality-control";

describe("G10 exact-decimal and result authority", () => {
  it.each([
    ["0.850", "PASS"],
    ["0.900", "PASS"],
    ["0.849999", "FAIL"],
    ["0.900001", "FAIL"]
  ] as const)("judges %s inclusively as %s", (observed, expected) => {
    expect(numericRangeJudgement({ observed, min: "0.850", max: "0.900" })).toBe(expected);
  });

  it("compares decimal strings without floating point", () => {
    expect(compareExactDecimals("9007199254740993.000000", "9007199254740992.999999")).toBe(1);
    expect(compareExactDecimals("-0.10", "-0.1")).toBe(0);
  });

  it("accepts integer decimal strings without coercing them through Number", () => {
    expect(numericRangeJudgement({ observed: "1", min: "0.850", max: "1.000" })).toBe("PASS");
  });

  it("enforces specification item shapes", () => {
    expect(
      specificationItemInputSchema.safeParse({
        itemOrder: 1,
        checkKey: "sg",
        name: "SG",
        checkType: "NUMERIC_RANGE",
        unitCode: "ratio"
      }).success
    ).toBe(false);
    expect(
      specificationItemInputSchema.safeParse({
        itemOrder: 1,
        checkKey: "clear",
        name: "Clear",
        checkType: "BOOLEAN",
        expectedBoolean: true,
        minValue: "0.1"
      }).success
    ).toBe(false);
    expect(
      specificationItemInputSchema.safeParse({
        itemOrder: 1,
        checkKey: "odor",
        name: "Odor",
        checkType: "QUALITATIVE",
        acceptanceCriteriaText: " "
      }).success
    ).toBe(false);
  });

  it("rejects browser-authored numeric and boolean judgement", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      inspectionResultInputSchema.safeParse({
        checkType: "NUMERIC_RANGE",
        specificationItemId: id,
        observedNumericValue: "0.875",
        judgement: "PASS"
      }).success
    ).toBe(false);
    expect(
      inspectionResultInputSchema.safeParse({
        checkType: "BOOLEAN",
        specificationItemId: id,
        observedBooleanValue: true,
        judgement: "PASS"
      }).success
    ).toBe(false);
    expect(
      inspectionResultInputSchema.safeParse({
        checkType: "QUALITATIVE",
        specificationItemId: id,
        observedText: "Conforms",
        judgement: "REVIEW_REQUIRED"
      }).success
    ).toBe(true);
  });
});
