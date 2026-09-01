export type ExactDecimal = { numerator: bigint; denominator: bigint };

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function normalized(value: ExactDecimal): ExactDecimal {
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

/** Parses a finite decimal without using binary floating-point arithmetic for comparison. */
export function exactDecimal(value: string | number): ExactDecimal {
  const raw = String(value).trim().toLowerCase();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error("INVALID_EXACT_DECIMAL");
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0") - fraction.length;
  const digits = BigInt(match[2] + fraction);
  return normalized(
    exponent >= 0
      ? { numerator: sign * digits * powerOfTen(exponent), denominator: 1n }
      : { numerator: sign * digits, denominator: powerOfTen(-exponent) }
  );
}

export function compareActiveExposureToLimit(input: {
  activeAromaticMassMg: string;
  referenceFormulaMassMg: string;
  dosagePct: number;
  limitPct: string | number;
}): { comparison: -1 | 0 | 1; exposure: ExactDecimal; limit: ExactDecimal } {
  const active = BigInt(input.activeAromaticMassMg);
  const reference = BigInt(input.referenceFormulaMassMg);
  if (active < 0n || reference <= 0n) throw new Error("INVALID_FORMULA_MASS");
  const dosage = exactDecimal(input.dosagePct);
  const limit = exactDecimal(input.limitPct);
  const exposure = normalized({
    numerator: active * dosage.numerator,
    denominator: reference * dosage.denominator
  });
  const left = exposure.numerator * limit.denominator;
  const right = limit.numerator * exposure.denominator;
  return { comparison: left < right ? -1 : left > right ? 1 : 0, exposure, limit };
}

export function exactDecimalText(value: ExactDecimal, fractionDigits = 12): string {
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  const whole = numerator / value.denominator;
  let remainder = numerator % value.denominator;
  let fraction = "";
  for (let index = 0; index < fractionDigits && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += String(remainder / value.denominator);
    remainder %= value.denominator;
  }
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
