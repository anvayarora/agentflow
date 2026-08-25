import { createHash } from "node:crypto";

export type CanonicalCartLine = {
  productId?: string;
  variantId: string;
  lineItemId?: string;
  sku?: string;
  quantity: number;
  unitPricePaise?: number;
};

export type CanonicalCart = {
  shopDomain?: string;
  currency: string;
  lines: CanonicalCartLine[];
};

export function canonicalizeCart(cart: CanonicalCart): CanonicalCart {
  const lines = cart.lines.map((line) => ({
    ...(line.productId ? { productId: line.productId } : {}),
    variantId: line.variantId,
    ...(line.lineItemId ? { lineItemId: line.lineItemId } : {}),
    ...(line.sku ? { sku: line.sku } : {}),
    quantity: line.quantity,
    ...(line.unitPricePaise === undefined ? {} : { unitPricePaise: line.unitPricePaise }),
  })).sort((a, b) => `${a.variantId}:${a.lineItemId || ""}`.localeCompare(`${b.variantId}:${b.lineItemId || ""}`));
  return { ...(cart.shopDomain ? { shopDomain: cart.shopDomain } : {}), currency: cart.currency.toUpperCase(), lines };
}

export function hashCart(cart: CanonicalCart) {
  return createHash("sha256").update(JSON.stringify(canonicalizeCart(cart))).digest("hex");
}

export function paiseFromMinorUnits(currency: string, amount: number) {
  if (currency.toUpperCase() !== "INR") return null;
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return amount;
}
