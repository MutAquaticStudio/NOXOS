export type ExactDecimal = { numerator: bigint; denominator: bigint };

const decimalPattern = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

export function parseNonNegativeDecimal(value: string): ExactDecimal {
  const match = decimalPattern.exec(value);
  if (!match) throw new Error("INVALID_PRICE");
  const fraction = match[2] ?? "";
  return {
    numerator: BigInt(match[1] + fraction),
    denominator: powerOfTen(fraction.length)
  };
}

export function canonicalDecimal(value: string): string {
  const parsed = parseNonNegativeDecimal(value);
  if (parsed.denominator === 1n) return parsed.numerator.toString();
  const scale = parsed.denominator.toString().length - 1;
  const digits = parsed.numerator.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function multiplyPricePerKgByMassMg(pricePerKg: string, quantityMg: string): string {
  const price = parseNonNegativeDecimal(pricePerKg);
  const quantity = BigInt(quantityMg);
  if (quantity <= 0n) throw new Error("INVALID_QUANTITY");
  const numerator = price.numerator * quantity;
  const denominator = price.denominator * 1_000_000n;
  const scale = denominator.toString().length - 1;
  const digits = numerator.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
