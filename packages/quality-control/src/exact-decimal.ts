const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export type ExactDecimal = {
  coefficient: bigint;
  scale: number;
};

export function parseExactDecimal(value: string): ExactDecimal {
  if (!decimalPattern.test(value)) {
    throw new Error("INVALID_DECIMAL");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  return {
    coefficient: BigInt((negative ? "-" : "") + whole + fraction),
    scale: fraction.length
  };
}

export function compareExactDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = parseExactDecimal(left);
  const b = parseExactDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * 10n ** BigInt(scale - a.scale);
  const bv = b.coefficient * 10n ** BigInt(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function numericRangeJudgement(input: {
  observed: string;
  min?: string | null;
  max?: string | null;
}): "PASS" | "FAIL" {
  parseExactDecimal(input.observed);
  if (input.min != null && compareExactDecimals(input.observed, input.min) < 0) return "FAIL";
  if (input.max != null && compareExactDecimals(input.observed, input.max) > 0) return "FAIL";
  return "PASS";
}
