export const BASIS_POINTS = 10_000;

const assertSafeInteger = (value: number, field: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer.`);
  return value;
};

export const assertPaise = (value: number) => assertSafeInteger(value, "paise");

export const assertBps = (value: number) => {
  assertSafeInteger(value, "basis points");
  if (value < 0 || value > BASIS_POINTS) throw new Error("basis points must be between 0 and 10000.");
  return value;
};

export function percentageToBps(value: number | string) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`Invalid percentage: ${text}`);
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return assertBps(bps);
}

export function bpsToPercentageString(value: number) {
  assertBps(value);
  return `${Math.floor(value / 100)}${value % 100 ? `.${String(value % 100).padStart(2, "0").replace(/0+$/, "")}` : ""}%`;
}

export function paiseFromRupees(value: number | string) {
  const text = String(value).trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`Invalid rupee amount: ${text}`);
  const [whole, fraction = ""] = text.split(".");
  return assertPaise(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

export function calculatePriceAfterDiscount(listPricePaise: number, discountBps: number) {
  assertPaise(listPricePaise);
  assertBps(discountBps);
  const numerator = BigInt(listPricePaise) * BigInt(BASIS_POINTS - discountBps);
  const price = (numerator + BigInt(BASIS_POINTS - 1)) / BigInt(BASIS_POINTS);
  return assertPaise(Number(price));
}

export function calculateDiscountBps(listPricePaise: number, requestedPricePaise: number) {
  assertPaise(listPricePaise);
  assertPaise(requestedPricePaise);
  if (requestedPricePaise >= listPricePaise) return 0;
  const discount = (BigInt(listPricePaise - requestedPricePaise) * BigInt(BASIS_POINTS)) / BigInt(listPricePaise);
  return assertBps(Math.min(BASIS_POINTS, Number(discount)));
}

export function calculateGrossMarginBps(salePricePaise: number, costPaise: number) {
  assertPaise(salePricePaise);
  assertPaise(costPaise);
  if (salePricePaise <= 0 || costPaise > salePricePaise) return 0;
  return Math.max(0, Math.min(BASIS_POINTS, Number((BigInt(salePricePaise - costPaise) * BigInt(BASIS_POINTS)) / BigInt(salePricePaise))));
}

export function calculateMinimumAllowedPriceFromMargin(costPaise: number, minimumMarginBps: number) {
  assertPaise(costPaise);
  assertBps(minimumMarginBps);
  if (minimumMarginBps >= BASIS_POINTS) throw new Error("A 100% margin floor cannot be satisfied by a finite price.");
  const numerator = BigInt(costPaise) * BigInt(BASIS_POINTS);
  const denominator = BigInt(BASIS_POINTS - minimumMarginBps);
  return assertPaise(Number((numerator + denominator - BigInt(1)) / denominator));
}

export function calculateMaximumSafeDiscountBps(listPricePaise: number, costPaise: number, minimumMarginBps: number) {
  const minimumPrice = calculateMinimumAllowedPriceFromMargin(costPaise, minimumMarginBps);
  if (minimumPrice >= listPricePaise) return 0;
  return calculateDiscountBps(listPricePaise, minimumPrice);
}

export function multiplyPaise(amountPaise: number, quantity: number) {
  assertPaise(amountPaise);
  assertSafeInteger(quantity, "quantity");
  if (quantity < 0) throw new Error("quantity cannot be negative.");
  return assertPaise(Number(BigInt(amountPaise) * BigInt(quantity)));
}
