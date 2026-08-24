import type { CommerceEvaluation } from "./policy/evaluator";
import type { PolicyVersionIR } from "./policy/schema";

/**
 * Temporary read-only shape for existing merchant copy. It is derived from a
 * PolicyVersionIR and is never accepted by the authoritative evaluator.
 */
export type CommercePolicy = {
  version: number;
  standardMaxDiscount: number;
  repeatMaxDiscount: number;
  minimumMargin: number;
  lowStockThreshold: number;
  approvalThreshold: number;
};

export type PolicyDecision = CommerceEvaluation;

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number | null;
  stock: number;
  finish: string;
  material: string;
  width: number;
  description: string;
  art: string;
  tag?: string;
};

export function policyToLegacyView(policy: PolicyVersionIR): CommercePolicy {
  const global = policy.rules.find((rule) => rule.id === "global-max-discount" && rule.effect.type === "SET_MAX_DISCOUNT_BPS");
  const repeat = policy.rules.find((rule) => rule.id === "repeat-customer-ceiling" && rule.effect.type === "SET_MAX_DISCOUNT_BPS");
  const margin = policy.rules.find((rule) => rule.effect.type === "SET_MIN_MARGIN_BPS");
  const lowStock = policy.rules.find((rule) => rule.id === "low-stock-safety");
  const approval = policy.rules.find((rule) => rule.id === "high-value-approval");
  const lowStockValue = lowStock?.conditions.find((condition) => condition.field === "product.stock")?.value;
  const approvalValue = approval?.conditions.find((condition) => condition.field === "cart.totalPaise")?.value;
  return {
    version: policy.version,
    standardMaxDiscount: global?.effect.type === "SET_MAX_DISCOUNT_BPS" ? global.effect.valueBps / 100 : 0,
    repeatMaxDiscount: repeat?.effect.type === "SET_MAX_DISCOUNT_BPS" ? repeat.effect.valueBps / 100 : 0,
    minimumMargin: margin?.effect.type === "SET_MIN_MARGIN_BPS" ? margin.effect.valueBps / 100 : 0,
    lowStockThreshold: typeof lowStockValue === "number" ? lowStockValue : 0,
    approvalThreshold: typeof approvalValue === "number" ? approvalValue / 100 : 0,
  };
}
